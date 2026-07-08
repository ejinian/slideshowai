import Stripe from "stripe";

// Server-only Stripe client. STRIPE_SECRET_KEY is the sandbox/live secret key
// (sk_test_… in the Stripe sandbox). NEVER expose it to client code or prefix it
// with NEXT_PUBLIC_.
//
// Lazily constructed: the Stripe constructor throws on an empty key, and route
// modules are evaluated at build time (page-data collection) where the key is
// absent — so we build the client on first use inside a request instead.
let cached: Stripe | null = null;

export function getStripe(): Stripe {
  if (!cached) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) throw new Error("STRIPE_SECRET_KEY is not set.");
    cached = new Stripe(key);
  }
  return cached;
}
