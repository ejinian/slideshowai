/* Period policy for the Trends surface. Pure + separate from the view so the
   widening ladder can be unit-tested — it's the part with the fiddly edges. */

export type TrendPeriod = "7d" | "30d" | "alltime";

export const PERIOD_HOURS: Record<TrendPeriod, number> = {
  "7d": 24 * 7,
  "30d": 24 * 30,
  alltime: Infinity,
};

export const PERIOD_OPTIONS: { value: TrendPeriod; label: string }[] = [
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
  { value: "alltime", label: "All-time" },
];

/**
 * The periods to try, in order, starting from the selected one — narrowest
 * first, widening only. An empty period is never a dead end: the caller walks
 * this list and shows the first one with posts, advancing the selector with it
 * so the control and the content always agree.
 *
 * `hasAllTime` is false when the hall-of-fame feed is absent (its dropdown
 * option is hidden too, so it must not be a widening target either).
 */
export function periodCandidates(
  period: TrendPeriod,
  hasAllTime: boolean,
): TrendPeriod[] {
  const ladder: TrendPeriod[] = hasAllTime
    ? ["7d", "30d", "alltime"]
    : ["7d", "30d"];
  const start = ladder.indexOf(period);
  // Selected period isn't on the ladder (all-time picked while its feed is
  // missing) — respect the explicit choice rather than silently narrowing.
  return start === -1 ? [period] : ladder.slice(start);
}
