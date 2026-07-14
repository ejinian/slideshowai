import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { createAdminClient } from "@/utils/supabase/admin";
import { getStripe } from "@/lib/stripe";
import {
  CREDIT_PACKS,
  creditPriceId,
  isPlanId,
  planPriceId,
} from "@/lib/billing/plans";

// Creates a Stripe Checkout Session and returns its URL for the client to
// redirect to. Two kinds:
//   { kind: "subscription", id: "growth"|"scale"|"unlimited" }  -> recurring plan
//   { kind: "credits",      id: "small"|"medium"|"large" }      -> one-time top-up
// On success Stripe fires the webhook (app/api/stripe/webhook), which is the
// source of truth that flips the plan / adds credits.
export const runtime = "nodejs";

interface CheckoutBody {
  kind?: "subscription" | "credits";
  id?: string;
}

export async function POST(request: Request) {
  if (!process.env.STRIPE_SECRET_KEY) {
    return NextResponse.json(
      { error: "Stripe is not configured." },
      { status: 500 },
    );
  }

  const stripe = getStripe();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as CheckoutBody;
  const kind = body.kind === "credits" ? "credits" : "subscription";
  const id = String(body.id ?? "");

  // Resolve the Stripe price for the chosen tier or credit pack.
  const priceId =
    kind === "credits"
      ? creditPriceId(id)
      : isPlanId(id)
        ? planPriceId(id)
        : undefined;
  if (!priceId) {
    return NextResponse.json(
      {
        error: `Unknown ${kind === "credits" ? "credit pack" : "plan"} "${id}", or its price isn't configured (STRIPE_PRICES).`,
      },
      { status: 400 },
    );
  }

  // Reuse the user's Stripe customer if we have one; otherwise create it and
  // persist the id (via the admin client — billing columns aren't user-writable).
  const admin = createAdminClient();
  const { data: profile } = await admin
    .from("profiles")
    .select("stripe_customer_id")
    .eq("id", user.id)
    .maybeSingle();

  let customerId = (profile?.stripe_customer_id as string | null) ?? null;
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: user.email ?? undefined,
      metadata: { supabase_user_id: user.id },
    });
    customerId = customer.id;
    await admin
      .from("profiles")
      .upsert(
        { id: user.id, email: user.email, stripe_customer_id: customerId },
        { onConflict: "id" },
      );
  }

  const origin = new URL(request.url).origin;

  try {
    const session =
      kind === "credits"
        ? await stripe.checkout.sessions.create({
            mode: "payment",
            customer: customerId,
            client_reference_id: user.id,
            line_items: [{ price: priceId, quantity: 1 }],
            // The webhook reads credits from here to top up the balance.
            metadata: {
              kind: "credits",
              credits: String(CREDIT_PACKS[id]?.credits ?? 0),
            },
            success_url: `${origin}/dashboard?credits=1`,
            cancel_url: `${origin}/dashboard`,
          })
        : await stripe.checkout.sessions.create({
            mode: "subscription",
            customer: customerId,
            client_reference_id: user.id,
            line_items: [{ price: priceId, quantity: 1 }],
            allow_promotion_codes: true,
            success_url: `${origin}/dashboard?upgraded=1`,
            cancel_url: `${origin}/dashboard`,
          });

    return NextResponse.json({ url: session.url });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Could not start checkout.";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
