# Stripe Checkout integration — remaining steps

This file is the single source of truth for what is left to do after the
Checkout Studio parameters were applied to the existing Hosted Checkout
integration. Nothing new was added: the app already had a checkout route, a
webhook, a customer-portal route and billing tables. Only the parameters of the
two existing `stripe.checkout.sessions.create(...)` calls changed.

## Values to Replace

The checkout call itself contains **no placeholder values**. The `mode`,
`success_url`, `cancel_url` and `line_items` parameters already carry real
values, so they were preserved as-is:

| Field | Current value | Status |
|-------|---------------|--------|
| mode | `"payment"` (credit packs) / `"subscription"` (plans) | Real. Matches the product type per call. |
| success_url | `${origin}/dashboard?credits=1` / `${origin}/dashboard?upgraded=1` | Real. Derived from the request origin. |
| cancel_url | `${origin}/dashboard` | Real. |
| line_items[].price | `priceId` resolved from the `STRIPE_PRICES` env var | Real in code. **The env var must hold real Price IDs** (see below). |

The Price IDs live in configuration, not code. Make sure the `STRIPE_PRICES`
JSON blob in your environment maps every plan and credit pack to a real
`price_…` id from https://dashboard.stripe.com/prices. The sample in
[.env.local.example](.env.local.example) still shows `price_...` placeholders:

**Files containing placeholders:**
- [.env.local.example](.env.local.example) (sample values only; the real ids go in `.env.local` and Vercel)

| Field | Current Value | What to Set |
|-------|--------------|-------------|
| STRIPE_PRICES.growth | price_... | Recurring Price ID for the Growth plan. |
| STRIPE_PRICES.scale | price_... | Recurring Price ID for the Scale plan. |
| STRIPE_PRICES.unlimited | price_... | Recurring Price ID for the Unlimited plan. |
| STRIPE_PRICES.credits_small / credits_medium / credits_large | (unset in the sample) | One-time Price IDs for the credit packs (keys per `lib/billing/plans.ts`). |

## Configured Parameters

These parameters were configured in Checkout Studio and are already set
correctly in the code.

**Files containing these parameters:**
- [app/api/stripe/checkout/route.ts](app/api/stripe/checkout/route.ts)

| Parameter | Value | Applied to |
|-----------|-------|------------|
| ui_mode | hosted_page | both calls (SDK is `stripe@22.3.0`, ≥ 21.0.0, so `hosted_page` is the correct value) |
| billing_address_collection | auto | both calls |
| phone_number_collection | `{ enabled: false }` | both calls |
| automatic_tax | `{ enabled: false }` | both calls |
| allow_promotion_codes | false | both calls |
| payment_method_collection | always | subscription call only (only valid in `subscription` mode) |
| submit_type | auto | both calls |
| integration_identifier | hosted_web_0001 | both calls |
| origin_context | web | both calls |

⚠️ Behaviour change to be aware of: the subscription call previously had
`allow_promotion_codes: true`. Checkout Studio set it to `false`, so the
promotion-code field no longer appears on the hosted page. Flip it back in
Checkout Studio (and here) if you still want coupon entry at checkout.

Parameters the app relies on that are **not** Checkout Studio settings were
kept untouched: `customer`, `client_reference_id` and `metadata`. The webhook
in [app/api/stripe/webhook/route.ts](app/api/stripe/webhook/route.ts) reads
`client_reference_id` and `metadata.credits` to grant credits, and matches
subscriptions by customer id. Removing them would break fulfilment.

## Setup

### Environment variables (server-only, never `NEXT_PUBLIC_`)

| Variable | Where to get it |
|----------|-----------------|
| `STRIPE_SECRET_KEY` | https://dashboard.stripe.com/test/apikeys (`sk_test_…` in sandbox, `sk_live_…` in production) |
| `STRIPE_WEBHOOK_SECRET` | https://dashboard.stripe.com/workbench/webhooks for production; the value printed by `stripe listen` locally (they differ) |
| `STRIPE_PRICES` | One JSON blob mapping plan / credit-pack ids → Price IDs, e.g. `{"growth":"price_…","scale":"price_…","unlimited":"price_…","credits_small":"price_…"}` |

Set all three in `.env.local` for local dev and in the Vercel project for
production. The Stripe client in [lib/stripe.ts](lib/stripe.ts) is constructed
without an explicit API version, so it uses your account's default version;
leave it that way.

No publishable key is needed: Hosted Checkout redirects the browser to
`session.url`, so nothing Stripe-related runs client-side.

### Dependencies

`stripe@22.3.0` is already in `package.json` and the lockfile. Nothing to
install.

### Files touched

- [app/api/stripe/checkout/route.ts](app/api/stripe/checkout/route.ts) — parameters of the two Checkout Session calls.
- [STRIPE_INTEGRATION_TODO.md](STRIPE_INTEGRATION_TODO.md) — this file.

No new routes, files or infrastructure were created; the webhook, portal
route, env loading and auth already existed.

## How the integration works

1. The client (`components/dashboard/BillingModal.tsx`) POSTs
   `{ kind: "subscription" | "credits", id }` to `POST /api/stripe/checkout`.
2. The route requires a signed-in Supabase user, resolves the Price ID from
   `STRIPE_PRICES`, and reuses or creates the user's Stripe Customer (id
   persisted on `profiles.stripe_customer_id` via the service role).
3. It creates a Hosted Checkout Session (`ui_mode: "hosted_page"`) in
   `payment` mode for credit packs or `subscription` mode for plans, and
   returns `session.url`.
4. The browser redirects to the Stripe-hosted page. On success Stripe sends
   the customer back to `/dashboard?credits=1` or `/dashboard?upgraded=1`;
   on cancel, to `/dashboard`.
5. Stripe fires `checkout.session.completed` (and the subscription lifecycle
   events) to `POST /api/stripe/webhook`. The webhook is the source of truth:
   it verifies the signature with `STRIPE_WEBHOOK_SECRET`, then adds credits
   (from `metadata.credits`, keyed by `client_reference_id`) or updates the
   plan on `profiles`.
6. `POST /api/stripe/portal` opens the Customer Portal for managing an
   existing subscription.

## Testing

Forward webhooks to your dev server while testing locally:

```bash
stripe listen --forward-to localhost:3000/api/stripe/webhook
```

Copy the `whsec_…` it prints into `STRIPE_WEBHOOK_SECRET` in `.env.local`.

Test cards (any future expiry, any CVC, any postal code):

| Card number | Result |
|-------------|--------|
| 4242 4242 4242 4242 | Succeeds |
| 4000 0025 0000 3155 | Requires 3D Secure authentication |
| 4000 0000 0000 9995 | Declined (insufficient funds) |
| 4000 0000 0000 0002 | Declined (generic) |

Full list: https://docs.stripe.com/testing

Test-mode and live-mode objects are separate. Price IDs created in test mode
will not work with a live secret key, so `STRIPE_PRICES` needs a live set when
you switch keys.

## Next steps

- Fill `STRIPE_PRICES` with real Price IDs for every plan and credit pack in
  both test and live mode.
- Register the production webhook endpoint
  (`https://www.slidelabs.ai/api/stripe/webhook`) in the Dashboard with the
  events the webhook route handles, and set its signing secret in Vercel.
- Decide whether promotion codes should stay off (see the behaviour note
  above).
- Run a test checkout end to end: start checkout from the Billing modal, pay
  with `4242 4242 4242 4242`, confirm the webhook fires and `profiles` updates.
- Order tracking is already handled by the webhook writing to `profiles`; if
  you want a per-purchase ledger, add a table keyed by `session.id` in the
  `checkout.session.completed` handler.

## Resources

- Stripe support: https://support.stripe.com
- Stripe docs via MCP: https://docs.stripe.com/mcp
- Checkout Sessions API: https://docs.stripe.com/api/checkout/sessions/create
- Hosted Checkout quickstart: https://docs.stripe.com/checkout/quickstart
