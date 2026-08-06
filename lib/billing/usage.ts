import type { SupabaseClient } from "@supabase/supabase-js";
import { FAIR_USE_CAP, PLANS, isPlanId, type PlanId } from "./plans";

// Server-only usage metering. Billing columns on profiles are service-role-write
// only (see 20260707180000_billing), so every write here MUST use the admin client.

// Minimum gap between generations per user — blocks scripted rapid-fire. Human
// generation takes several seconds anyway, so this is invisible in normal use.
export const RATE_LIMIT_MS = 4000;

export interface Billing {
  plan: PlanId;
  quota: number | null; // monthly allowance for DISPLAY; null = "Unlimited"
  used: number; // slideshows this period
  credits: number; // never-expiring overflow balance
  periodEnd: string | null; // ISO
  lastGeneratedAt: string | null; // ISO — for rate limiting
}

const MONTH_MS = 30 * 24 * 60 * 60 * 1000;

// The enforced ceiling. Unlimited (quota null) still caps at FAIR_USE_CAP so a
// runaway can't rack up unbounded OpenAI + storage cost; every other tier is its
// own quota.
function cap(quota: number | null): number {
  return quota === null ? FAIR_USE_CAP : quota;
}

// Loads billing for a user with a lazy monthly reset: if the period elapsed (or
// was never set), zero usage and stamp a fresh period_end, persisting it once so
// the reset is idempotent. Upserts so a user without a profiles row still works.
export async function loadBilling(
  admin: SupabaseClient,
  userId: string,
  now: number,
): Promise<Billing> {
  const { data } = await admin
    .from("profiles")
    .select(
      "plan, plan_quota, slideshows_used, credits, period_end, last_generated_at",
    )
    .eq("id", userId)
    .maybeSingle();

  const planRaw = (data?.plan as string | undefined) ?? "free";
  const plan: PlanId = isPlanId(planRaw) ? planRaw : "free";
  // plan_quota is authoritative once the webhook sets it; fall back to the plan's
  // configured quota (covers free users and rows predating the tiers migration).
  const quota =
    data?.plan_quota === null || data?.plan_quota === undefined
      ? PLANS[plan].quota
      : (data.plan_quota as number);
  let used = (data?.slideshows_used as number | undefined) ?? 0;
  const credits = (data?.credits as number | undefined) ?? 0;
  let periodEnd = (data?.period_end as string | null | undefined) ?? null;
  const lastGeneratedAt =
    (data?.last_generated_at as string | null | undefined) ?? null;

  if (!periodEnd || now > Date.parse(periodEnd)) {
    used = 0;
    periodEnd = new Date(now + MONTH_MS).toISOString();
    await admin
      .from("profiles")
      .upsert(
        { id: userId, slideshows_used: 0, period_end: periodEnd },
        { onConflict: "id" },
      );
  }

  return { plan, quota, used, credits, periodEnd, lastGeneratedAt };
}

/** Slideshows the user can still generate this period (allowance left + credits). */
export function remaining(b: Billing): number {
  return Math.max(0, cap(b.quota) - b.used) + b.credits;
}

/**
 * ADVISORY ONLY — for a friendly pre-flight message. Never the authority: it
 * reads a snapshot, so two parallel requests both pass it. `spendCredits` is
 * what actually decides.
 */
export function rateLimited(lastGeneratedAt: string | null, now: number): boolean {
  return !!lastGeneratedAt && now - Date.parse(lastGeneratedAt) < RATE_LIMIT_MS;
}

/* ── Atomic operations (20260806120000_billing_atomic.sql) ───────────────────
   Everything below is a single DB statement or runs under a row lock, so the
   database arbitrates. The previous read-modify-write versions let N parallel
   requests all read the same balance and all write the same number — N decks
   for one charge. Do NOT reintroduce a JS-side check-then-write here. */

/** What one generation costs. Single source of truth so every caller agrees. */
export function costOf({
  slideshowCount,
  supercharge,
}: {
  slideshowCount: number;
  supercharge?: boolean;
}): number {
  return Math.max(1, slideshowCount) * (supercharge ? 2 : 1);
}

export interface Reservation {
  /** How much was charged in total. */
  total: number;
  /** How much of it came out of never-expiring credits (the rest was allowance). */
  fromCredits: number;
}

/**
 * Atomically charge `n`. Returns null when the user can't cover it (and nothing
 * is written). Charge BEFORE the expensive work and `refund` on failure —
 * otherwise a deliberately-failed run is free OpenAI spend.
 */
export async function spendCredits(
  admin: SupabaseClient,
  userId: string,
  n: number,
): Promise<Reservation | null> {
  const { data, error } = await admin.rpc("spend_credits", {
    p_user: userId,
    p_n: n,
  });
  // Fail CLOSED: if the RPC errors we must not hand out free generations.
  if (error || typeof data !== "number" || data < 0) return null;
  return { total: n, fromCredits: data };
}

/** Return a reservation to the bucket it came from, after a failed pipeline. */
export async function refundCredits(
  admin: SupabaseClient,
  userId: string,
  r: Reservation,
): Promise<void> {
  await admin.rpc("refund_credits", {
    p_user: userId,
    p_n: r.total,
    p_from_credits: r.fromCredits,
  });
}

/**
 * Compare-and-swap the rate-limit clock. True only if THIS call won the slot, so
 * concurrent requests serialise instead of all passing a stale check.
 */
export async function claimGenerationSlot(
  admin: SupabaseClient,
  userId: string,
): Promise<boolean> {
  const { data, error } = await admin.rpc("claim_generation_slot", {
    p_user: userId,
    p_ms: RATE_LIMIT_MS,
  });
  return !error && data === true;
}

/**
 * Durable rolling-window limiter for the un-metered model endpoints (suggest /
 * sharpen / remix). Replaces an in-memory Map that reset on every cold start and
 * was per-lambda anyway. Fails CLOSED.
 */
export async function claimRateWindow(
  admin: SupabaseClient,
  userId: string,
  limit: number,
  windowSecs: number,
): Promise<boolean> {
  const { data, error } = await admin.rpc("claim_rate_window", {
    p_user: userId,
    p_limit: limit,
    p_window_secs: windowSecs,
  });
  return !error && data === true;
}

/**
 * Bump a deck's AI image-swap counter and return the new total (null if the deck
 * isn't the caller's). Ownership is checked inside the function because it is
 * SECURITY DEFINER and therefore bypasses RLS.
 */
export async function bumpImageSwaps(
  admin: SupabaseClient,
  slideshowId: string,
  userId: string,
): Promise<number | null> {
  const { data, error } = await admin.rpc("bump_image_swaps", {
    p_slideshow: slideshowId,
    p_user: userId,
  });
  if (error || typeof data !== "number") return null;
  return data;
}

/** AI image swaps included per credit. The 1st of each block is the charge. */
export const SWAPS_PER_CREDIT = 3;
