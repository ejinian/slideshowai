// Billing config: subscription tiers + one-time credit packs. Prices are display
// values; the real Stripe price ids come from a single env var STRIPE_PRICES (a
// JSON map) so you set one variable per environment instead of one per price.
//
//   STRIPE_PRICES = {
//     "growth":         "price_…",   "scale":          "price_…",
//     "unlimited":      "price_…",   "credits_small":  "price_…",
//     "credits_medium": "price_…",   "credits_large":  "price_…"
//   }
//
// A "slideshow" = one generated slideshow (the generator can make several per run).
// plan_quota is the monthly allowance; credits are a never-expiring overflow that
// is consumed only after the allowance runs out. 1 credit = 1 slideshow.

// "Unlimited" is unlimited within fair use: the tier displays as unlimited
// (quota: null) but generation is capped at this hidden ceiling to bound cost and
// Supabase storage against scripted abuse. Real users never approach it; past it
// they hit a fair-use block (or extend with credits). Industry-standard practice.
export const FAIR_USE_CAP = 2000;

export type PlanId = "free" | "growth" | "scale" | "unlimited";

export interface Plan {
  id: PlanId;
  name: string;
  price: number; // USD / month (display)
  quota: number | null; // slideshows / month; null = unlimited
  /** Connected TikTok accounts this plan allows (enforced in the OAuth callback). */
  tiktokAccounts: number;
  tagline: string;
  /** The recommended middle tier — indigo highlight. */
  popular?: boolean;
  /** Most slideshows per dollar — green highlight. */
  bestValue?: boolean;
}

export const PLANS: Record<PlanId, Plan> = {
  free: {
    id: "free",
    name: "Free",
    price: 0,
    quota: 5,
    tiktokAccounts: 1,
    tagline: "Try it out",
  },
  growth: {
    id: "growth",
    name: "Growth",
    price: 19,
    quota: 150,
    tiktokAccounts: 1,
    tagline: "For creators shipping daily",
  },
  scale: {
    id: "scale",
    name: "Scale",
    price: 29,
    quota: 400,
    tiktokAccounts: 3,
    tagline: "For agencies & power users",
    popular: true,
  },
  unlimited: {
    id: "unlimited",
    name: "Unlimited",
    price: 79,
    quota: null,
    tiktokAccounts: 10,
    tagline: "No limits, ever",
    bestValue: true,
  },
};

// Admins are capped too — a runaway-loop backstop, not a product tier.
export const ADMIN_TIKTOK_ACCOUNTS = 100;

/** How many TikTok accounts this user may have connected at once. */
export function tiktokAccountLimit(plan: PlanId, isAdmin: boolean): number {
  return isAdmin ? ADMIN_TIKTOK_ACCOUNTS : PLANS[plan].tiktokAccounts;
}

// Ordered for display (Free is the implicit baseline, not shown as a purchasable card).
export const PAID_PLAN_IDS: PlanId[] = ["growth", "scale", "unlimited"];

export interface CreditPack {
  id: string;
  credits: number;
  price: number; // USD (one-time)
}

export const CREDIT_PACKS: Record<string, CreditPack> = {
  small: { id: "small", credits: 25, price: 9 },
  medium: { id: "medium", credits: 100, price: 25 },
  large: { id: "large", credits: 300, price: 59 },
};

export const CREDIT_PACK_IDS = ["small", "medium", "large"] as const;

// --- Stripe price id resolution (server-only; reads STRIPE_PRICES) -------------

let priceMap: Record<string, string> | null = null;
function prices(): Record<string, string> {
  if (priceMap) return priceMap;
  try {
    priceMap = JSON.parse(process.env.STRIPE_PRICES || "{}") as Record<string, string>;
  } catch {
    priceMap = {};
  }
  return priceMap;
}

/** Stripe price id for a subscription tier. */
export function planPriceId(id: PlanId): string | undefined {
  return prices()[id];
}

/** Stripe price id for a credit pack. */
export function creditPriceId(packId: string): string | undefined {
  return prices()[`credits_${packId}`];
}

/** Reverse lookup used by the webhook: which tier does this Stripe price belong to? */
export function planForPrice(priceId: string): PlanId | undefined {
  const p = prices();
  return PAID_PLAN_IDS.find((k) => p[k] === priceId);
}

export function isPlanId(v: string): v is PlanId {
  return v === "free" || v === "growth" || v === "scale" || v === "unlimited";
}
