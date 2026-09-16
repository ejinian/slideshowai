import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { createAdminClient } from "@/utils/supabase/admin";
import { isAdminEmail } from "@/lib/admins";
import { getStripe } from "@/lib/stripe";
import { RefundError, refundPayment } from "@/lib/admin/payments";

// Admin-only: refund one Stripe charge for a customer and reverse what it
// granted. The email allow-list is the whole gate — the same one the admin
// pages use — checked against the session, never against anything in the body.
// Refunds are irreversible, so the client confirms before calling this.
export const runtime = "nodejs";

const CHARGE_RE = /^ch_[A-Za-z0-9]+$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  // Non-admins get the same 404 the admin pages give, so the route's existence
  // leaks nothing.
  if (!user || !isAdminEmail(user.email)) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }
  if (!process.env.STRIPE_SECRET_KEY) {
    return NextResponse.json({ error: "Stripe is not configured." }, { status: 500 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    userId?: unknown;
    chargeId?: unknown;
  };
  const userId = typeof body.userId === "string" ? body.userId : "";
  const chargeId = typeof body.chargeId === "string" ? body.chargeId : "";
  if (!UUID_RE.test(userId) || !CHARGE_RE.test(chargeId)) {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }

  try {
    const result = await refundPayment(getStripe(), createAdminClient(), {
      userId,
      chargeId,
    });
    console.log(
      `[admin/refund] ${user.email} refunded ${chargeId} for ${userId}: ${result.reversed}`,
    );
    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof RefundError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    const msg = e instanceof Error ? e.message : "Refund failed.";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
