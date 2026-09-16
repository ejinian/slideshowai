// SERVER-ONLY. One customer's Stripe payment history, and the admin refund.
//
// Same security boundary as lib/admin/users.ts: everything here runs with the
// service-role Supabase client and the live Stripe key, so the ONLY gate is the
// isAdminEmail() check in the page / route that calls it. Never import this from
// a client component (a type-only import is fine — it is erased).
//
// A refund reverses what the purchase granted, so the app matches Stripe: a
// credit-pack refund removes the pack's credits (floored at zero — they may have
// spent some), a subscription refund cancels the subscription immediately and
// drops the plan to free. The webhook's customer.subscription.deleted lands a
// moment later and writes the same thing; both writes are idempotent.

import type Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";
import { PLANS, planForPrice } from "@/lib/billing/plans";

export interface AdminPayment {
  chargeId: string;
  /** Minor units (cents). */
  amount: number;
  amountRefunded: number;
  currency: string;
  createdAt: string;
  status: "succeeded" | "pending" | "failed";
  refunded: boolean;
  kind: "credits" | "subscription" | "other";
  /** "25 credits" · "Growth plan" · "One-time payment". */
  label: string;
  /** What a refund removes from the balance (credit packs only). */
  credits: number | null;
  subscriptionId: string | null;
  receiptUrl: string | null;
}

export interface RefundResult {
  refundId: string;
  amount: number;
  currency: string;
  /** What was taken back in the app, in words, for the admin to read. */
  reversed: string;
}

/** A refund the admin can act on (wrong user, already refunded…) vs a crash. */
export class RefundError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}

type Ref = string | { id: string } | null | undefined;
function refId(ref: Ref): string | null {
  if (!ref) return null;
  return typeof ref === "string" ? ref : ref.id;
}

/**
 * Which subscription each payment belongs to, keyed by BOTH the payment intent
 * id and the charge id. A Charge no longer links to its invoice on this API
 * version; the invoice links to its payments instead, so the map is built
 * from the customer's invoices.
 */
async function subscriptionByPayment(
  stripe: Stripe,
  customerId: string,
): Promise<Map<string, string>> {
  const invoices = await stripe.invoices.list({
    customer: customerId,
    limit: 100,
    expand: ["data.payments"],
  });
  const map = new Map<string, string>();
  for (const inv of invoices.data) {
    const subId = refId(inv.parent?.subscription_details?.subscription);
    if (!subId) continue;
    for (const p of inv.payments?.data ?? []) {
      const pi = refId(p.payment.payment_intent);
      const ch = refId(p.payment.charge);
      if (pi) map.set(pi, subId);
      if (ch) map.set(ch, subId);
    }
  }
  return map;
}

interface ChargeContext {
  kind: AdminPayment["kind"];
  label: string;
  credits: number | null;
  subscriptionId: string | null;
}

/** Checkout sessions keyed by the payment intent they produced. */
async function sessionsByIntent(
  stripe: Stripe,
  customerId: string,
): Promise<Map<string, Stripe.Checkout.Session>> {
  const sessions = await stripe.checkout.sessions.list({
    customer: customerId,
    limit: 100,
  });
  const map = new Map<string, Stripe.Checkout.Session>();
  for (const s of sessions.data) {
    const pi = refId(s.payment_intent);
    if (pi) map.set(pi, s);
  }
  return map;
}

/**
 * Where a charge came from. A credit pack is identified by the checkout
 * session's metadata (the same field the webhook granted from), a subscription
 * charge by its invoice's subscription, whose price names the plan.
 */
async function classify(
  stripe: Stripe,
  charge: Stripe.Charge,
  byIntent: Map<string, Stripe.Checkout.Session>,
  subByPayment: Map<string, string>,
  planNameBySub: Map<string, string | null>,
): Promise<ChargeContext> {
  const intent = refId(charge.payment_intent);
  const subId = subByPayment.get(charge.id) ?? (intent ? subByPayment.get(intent) : null);
  if (subId) {
    if (!planNameBySub.has(subId)) {
      try {
        const sub = await stripe.subscriptions.retrieve(subId);
        const plan = planForPrice(sub.items.data[0]?.price.id ?? "");
        planNameBySub.set(subId, plan ? PLANS[plan].name : null);
      } catch {
        planNameBySub.set(subId, null);
      }
    }
    const planName = planNameBySub.get(subId);
    return {
      kind: "subscription",
      label: planName ? `${planName} plan` : "Subscription",
      credits: null,
      subscriptionId: subId,
    };
  }

  const session = intent ? byIntent.get(intent) : undefined;
  const credits = parseInt(session?.metadata?.credits ?? "", 10);
  if (session?.metadata?.kind === "credits" && credits > 0) {
    return {
      kind: "credits",
      label: `${credits} credits`,
      credits,
      subscriptionId: null,
    };
  }
  return {
    kind: "other",
    label: charge.description ?? "One-time payment",
    credits: null,
    subscriptionId: null,
  };
}

/** Every charge on the customer, newest first (Stripe's order). */
export async function listPayments(stripe: Stripe, customerId: string): Promise<AdminPayment[]> {
  const [charges, byIntent, subByPayment] = await Promise.all([
    stripe.charges.list({ customer: customerId, limit: 50 }),
    sessionsByIntent(stripe, customerId),
    subscriptionByPayment(stripe, customerId),
  ]);
  const planNameBySub = new Map<string, string | null>();
  const out: AdminPayment[] = [];
  for (const c of charges.data) {
    const ctx = await classify(stripe, c, byIntent, subByPayment, planNameBySub);
    out.push({
      chargeId: c.id,
      amount: c.amount,
      amountRefunded: c.amount_refunded,
      currency: c.currency,
      createdAt: new Date(c.created * 1000).toISOString(),
      status: c.status,
      refunded: c.refunded,
      ...ctx,
      receiptUrl: c.receipt_url,
    });
  }
  return out;
}

/**
 * Refund one charge in full and reverse what it granted.
 *
 * Stripe first, then the app: if the profile write fails the money is back and
 * the admin sees an error naming the manual fix — better than the reverse,
 * where credits vanish and the customer keeps paying. The idempotency key makes
 * a double-click return the same refund instead of creating a second one.
 */
export async function refundPayment(
  stripe: Stripe,
  admin: SupabaseClient,
  opts: { userId: string; chargeId: string },
): Promise<RefundResult> {
  const { data: profile } = await admin
    .from("profiles")
    .select("stripe_customer_id, credits, stripe_subscription_id")
    .eq("id", opts.userId)
    .maybeSingle();
  const customerId = (profile?.stripe_customer_id as string | null) ?? null;
  if (!customerId) {
    throw new RefundError("This user has no Stripe customer.", 400);
  }

  const charge = await stripe.charges.retrieve(opts.chargeId);
  // The charge id comes from the client — it must belong to THIS customer.
  if (refId(charge.customer) !== customerId) {
    throw new RefundError("That payment doesn't belong to this user.", 400);
  }
  if (charge.status !== "succeeded") {
    throw new RefundError("Only successful payments can be refunded.", 400);
  }
  if (charge.refunded) {
    throw new RefundError(
      "Already refunded in Stripe. If the app still shows the credits or plan, adjust them by hand.",
      409,
    );
  }

  const [byIntent, subByPayment] = await Promise.all([
    sessionsByIntent(stripe, customerId),
    subscriptionByPayment(stripe, customerId),
  ]);
  const ctx = await classify(stripe, charge, byIntent, subByPayment, new Map());

  const refund = await stripe.refunds.create(
    { charge: charge.id },
    { idempotencyKey: `admin-refund-${charge.id}` },
  );

  let reversed = "nothing to reverse in the app";
  if (ctx.kind === "credits" && ctx.credits) {
    const current = (profile?.credits as number | null) ?? 0;
    const removed = Math.min(current, ctx.credits);
    const { error } = await admin
      .from("profiles")
      .update({ credits: current - removed })
      .eq("id", opts.userId);
    if (error) {
      throw new RefundError(
        `Refunded in Stripe, but removing the credits failed (${error.message}). Take ${ctx.credits} credits off by hand.`,
        500,
      );
    }
    reversed =
      removed === ctx.credits
        ? `${removed} credits removed`
        : `${removed} of ${ctx.credits} credits removed (the rest were already spent)`;
  } else if (ctx.kind === "subscription" && ctx.subscriptionId) {
    try {
      await stripe.subscriptions.cancel(ctx.subscriptionId);
    } catch (e) {
      // Already cancelled is fine; anything else the admin should hear about.
      const msg = e instanceof Error ? e.message : "";
      if (!/cancel/i.test(msg) && !/No such subscription/i.test(msg)) throw e;
    }
    const currentSub = (profile?.stripe_subscription_id as string | null) ?? null;
    if (!currentSub || currentSub === ctx.subscriptionId) {
      const { error } = await admin
        .from("profiles")
        .update({
          plan: "free",
          plan_quota: PLANS.free.quota,
          subscription_status: "canceled",
        })
        .eq("id", opts.userId);
      if (error) {
        throw new RefundError(
          `Refunded and cancelled in Stripe, but the plan write failed (${error.message}). Set the plan to free by hand.`,
          500,
        );
      }
      reversed = "subscription cancelled, plan set to free";
    } else {
      reversed =
        "subscription cancelled; the user has a newer subscription, so the plan was left alone";
    }
  }

  return {
    refundId: refund.id,
    amount: refund.amount,
    currency: refund.currency,
    reversed,
  };
}
