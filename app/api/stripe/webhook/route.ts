import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { getStripe } from "@/lib/stripe";
import { createAdminClient } from "@/utils/supabase/admin";

// Stripe webhook: the source of truth for subscription state. Verifies the
// signature, then writes the user's plan/status to profiles via the service-role
// admin client (no user session here, so RLS is intentionally bypassed).
// The raw request body is required for signature verification — read it as text
// and never parse it before constructEvent.
export const runtime = "nodejs";

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
      // First successful checkout — link the customer/subscription to the user
      // (matched via client_reference_id) and mark them Pro.
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        const userId = session.client_reference_id;
        const customerId = session.customer as string | null;
        const subscriptionId = session.subscription as string | null;
        if (userId) {
          let status = "active";
          if (subscriptionId) {
            const sub = await stripe.subscriptions.retrieve(subscriptionId);
            status = sub.status;
          }
          await admin
            .from("profiles")
            .update({
              stripe_customer_id: customerId,
              stripe_subscription_id: subscriptionId,
              subscription_status: status,
              plan: "pro",
            })
            .eq("id", userId);
        }
        break;
      }

      // Renewals, cancellations, payment failures — keep plan in sync with the
      // live subscription status. Matched by customer id (no session here).
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        const sub = event.data.object as Stripe.Subscription;
        const active = sub.status === "active" || sub.status === "trialing";
        await admin
          .from("profiles")
          .update({
            stripe_subscription_id: sub.id,
            subscription_status: sub.status,
            plan: active ? "pro" : "free",
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
