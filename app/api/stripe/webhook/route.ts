import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { getStripe } from "@/lib/stripe";
import { createAdminClient } from "@/utils/supabase/admin";
import { PLANS, planForPrice } from "@/lib/billing/plans";

// Stripe webhook: the source of truth for billing state. Verifies the signature,
// then writes plan / quota / credits to profiles via the service-role admin client
// (no user session here, so RLS is intentionally bypassed). The raw request body
// is required for signature verification — read it as text, never parse it first.
export const runtime = "nodejs";

// current_period_end moved around across Stripe API versions (top-level vs per
// subscription item). Read whichever exists; null falls back to the lazy monthly
// reset in lib/billing/usage.
function subPeriodEnd(sub: Stripe.Subscription): string | null {
  const top = (sub as unknown as { current_period_end?: number })
    .current_period_end;
  const item = sub.items?.data?.[0] as unknown as {
    current_period_end?: number;
  };
  const secs = top ?? item?.current_period_end;
  return secs ? new Date(secs * 1000).toISOString() : null;
}

export async function POST(request: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  const sig = request.headers.get("stripe-signature");
  if (!secret || !sig) {
    return NextResponse.json(
      { error: "Webhook not configured." },
      { status: 400 },
    );
  }

  const stripe = getStripe();
  const body = await request.text();
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, sig, secret);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Invalid signature";
    return NextResponse.json(
      { error: `Webhook signature verification failed: ${msg}` },
      { status: 400 },
    );
  }

  const admin = createAdminClient();

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        const userId = session.client_reference_id;
        if (!userId) break;

        // One-time credit purchase — top up the never-expiring balance.
        if (session.mode === "payment") {
          const add = parseInt(session.metadata?.credits ?? "0", 10);
          if (add > 0) {
            const { data } = await admin
              .from("profiles")
              .select("credits")
              .eq("id", userId)
              .maybeSingle();
            const current = (data?.credits as number | undefined) ?? 0;
            await admin
              .from("profiles")
              .upsert(
                { id: userId, credits: current + add },
                { onConflict: "id" },
              );
          }
          break;
        }

        // New/renewed subscription — set the tier, its quota, and reset usage.
        const subscriptionId = session.subscription as string | null;
        if (subscriptionId) {
          const sub = await stripe.subscriptions.retrieve(subscriptionId);
          const priceId = sub.items.data[0]?.price.id ?? "";
          const plan = planForPrice(priceId);
          if (plan) {
            await admin
              .from("profiles")
              .upsert(
                {
                  id: userId,
                  plan,
                  plan_quota: PLANS[plan].quota,
                  slideshows_used: 0,
                  period_end: subPeriodEnd(sub),
                  subscription_status: sub.status,
                  stripe_customer_id: sub.customer as string,
                  stripe_subscription_id: sub.id,
                },
                { onConflict: "id" },
              );
          }
        }
        break;
      }

      // Renewals, upgrades/downgrades, cancellations — keep the tier in sync with
      // the live subscription's current price. Matched by customer id.
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        const sub = event.data.object as Stripe.Subscription;
        const priceId = sub.items.data[0]?.price.id ?? "";
        const plan = planForPrice(priceId);
        const active = sub.status === "active" || sub.status === "trialing";
        const effective = active && plan ? plan : "free";
        await admin
          .from("profiles")
          .update({
            plan: effective,
            plan_quota: PLANS[effective].quota,
            subscription_status: sub.status,
            stripe_subscription_id: sub.id,
            period_end: subPeriodEnd(sub),
          })
          .eq("stripe_customer_id", sub.customer as string);
        break;
      }

      default:
        break;
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : "handler error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
