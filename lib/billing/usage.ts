import type { SupabaseClient } from "@supabase/supabase-js";
import { PLANS, isPlanId, type PlanId } from "./plans";

// Server-only usage metering. Billing columns on profiles are service-role-write
// only (see 20260707180000_billing), so every write here MUST use the admin client.

export interface Billing {
  plan: PlanId;
  quota: number | null; // monthly allowance; null = unlimited
  used: number; // slideshows this period
  credits: number; // never-expiring overflow balance
  periodEnd: string | null; // ISO
}

const MONTH_MS = 30 * 24 * 60 * 60 * 1000;

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
    .select("plan, plan_quota, slideshows_used, credits, period_end")
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

  return { plan, quota, used, credits, periodEnd };
}

/** Slideshows the user can still generate this period (allowance left + credits). */
export function remaining(b: Billing): number {
  if (b.quota === null) return Number.POSITIVE_INFINITY;
  return Math.max(0, b.quota - b.used) + b.credits;
}

// Consume n slideshows: draw from the monthly allowance first, then credits.
export async function consume(
  admin: SupabaseClient,
  userId: string,
  b: Billing,
  n: number,
): Promise<void> {
  if (b.quota === null) return; // unlimited — nothing to meter
  const fromAllowance = Math.min(n, Math.max(0, b.quota - b.used));
  const fromCredits = n - fromAllowance;
  await admin
    .from("profiles")
    .update({
      slideshows_used: b.used + fromAllowance,
      credits: Math.max(0, b.credits - fromCredits),
    })
    .eq("id", userId);
}
