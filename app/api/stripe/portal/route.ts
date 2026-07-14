import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { getStripe } from "@/lib/stripe";

// Opens the Stripe Billing Portal so a subscribed user can update/cancel their
// plan. Returns the portal URL for the client to redirect to.
export const runtime = "nodejs";

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("stripe_customer_id")
    .eq("id", user.id)
    .maybeSingle();

  const customerId = (profile?.stripe_customer_id as string | null) ?? null;
  if (!customerId) {
    return NextResponse.json(
      { error: "No billing account yet — subscribe first." },
      { status: 400 },
    );
  }

  const origin = new URL(request.url).origin;
  try {
    const session = await getStripe().billingPortal.sessions.create({
      customer: customerId,
      return_url: `${origin}/dashboard`,
    });
    return NextResponse.json({ url: session.url });
  } catch (e) {
    // Most common cause: the Customer Portal isn't activated in this Stripe
    // account (Settings → Billing → Customer portal). Surface it as JSON so the
    // client doesn't choke parsing a 500 HTML page.
    const msg = e instanceof Error ? e.message : "Could not open billing portal.";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
