// SERVER-ONLY. What running the app has actually cost us in model spend.
//
// This is an ESTIMATE, and the honest framing matters: we do not meter tokens
// per request, so these are unit prices × counts. They come from the same
// arithmetic as the margin doctrine in CLAUDE.md (gpt-4o $2.50/$10 per 1M,
// gpt-4.1 $2/$8, gpt-4o-mini $0.15/$0.60, and every vision call here is
// detail:"low" = 85 image tokens).
//
// TWO THINGS ARE DELIBERATELY NOT COUNTED, because counting them would be
// making numbers up:
//   * "Let AI decide", Sharpen, Remix and reference analyses leave no per-row
//     trace — they happen outside slideshow creation and nothing records them.
//   * Decks created before 20260811000000 have no `supercharged` /
//     `background_mode`, so they are priced as plain stock generations. That
//     understates history rather than inventing a number.
// Both are surfaced in the UI rather than buried here.

import type { SupabaseClient } from "@supabase/supabase-js";

/** Unit prices in USD. Keep these next to the reasoning, not scattered. */
export const UNIT = {
  /** One copy call: ~3k in / ~600 out on gpt-4o, incl. the voice corpus. */
  copyCall: 0.014,
  /** Stock: the vision judge runs PER SLIDE over its Pexels candidates. */
  stockJudgePerSlide: 0.0035,
  /** Uploads: ONE image-first vision call over the whole photo set. */
  imageFirstCall: 0.005,
  /** Supercharge adds a gpt-4.1 pass over the finished deck (+ possible redo). */
  superchargeJudge: 0.04,
  /** One AI photo re-pick: Pexels search + a vision judge over candidates. */
  imageSwap: 0.005,
  /** Trends cron: Apify ~$1.15/run + the slide-text vision pass. Monthly. */
  trendsMonthly: 35,
} as const;

export interface CostBreakdown {
  /** Copy model, every deck. */
  copy: number;
  /** Per-slide vision judging on stock decks. */
  stockImages: number;
  /** One vision call per upload deck. */
  uploadImages: number;
  supercharge: number;
  imageSwaps: number;
  /** Fixed platform spend, not attributable to any user. */
  trends: number;
  total: number;
  /** Counts behind the numbers, so the estimate can be sanity-checked. */
  decks: number;
  superchargedDecks: number;
  uploadDecks: number;
  slides: number;
  swaps: number;
  /** Decks predating cost tracking — priced as plain stock. */
  untracked: number;
}

interface DeckRow {
  slide_count: number | null;
  supercharged: boolean | null;
  background_mode: string | null;
  image_swaps: number | null;
}

export async function estimateCost(admin: SupabaseClient): Promise<CostBreakdown> {
  const { data } = await admin
    .from("slideshows")
    .select("slide_count, supercharged, background_mode, image_swaps");
  const decks = (data ?? []) as DeckRow[];

  let copy = 0;
  let stockImages = 0;
  let uploadImages = 0;
  let supercharge = 0;
  let imageSwaps = 0;
  let slides = 0;
  let swaps = 0;
  let superchargedDecks = 0;
  let uploadDecks = 0;
  let untracked = 0;

  for (const d of decks) {
    const n = d.slide_count ?? 6;
    slides += n;
    copy += UNIT.copyCall;

    if (d.background_mode == null) untracked++;
    if (d.background_mode === "single") {
      uploadDecks++;
      uploadImages += UNIT.imageFirstCall;
    } else {
      // null (pre-tracking) is priced as stock — the cheaper direction to be
      // wrong in would be upload, and understating our own cost is worse.
      stockImages += n * UNIT.stockJudgePerSlide;
    }

    if (d.supercharged) {
      superchargedDecks++;
      supercharge += UNIT.superchargeJudge;
    }

    const sw = d.image_swaps ?? 0;
    swaps += sw;
    imageSwaps += sw * UNIT.imageSwap;
  }

  const trends = UNIT.trendsMonthly;
  return {
    copy,
    stockImages,
    uploadImages,
    supercharge,
    imageSwaps,
    trends,
    total: copy + stockImages + uploadImages + supercharge + imageSwaps + trends,
    decks: decks.length,
    superchargedDecks,
    uploadDecks,
    slides,
    swaps,
    untracked,
  };
}

/** "$12.40" / "$0.86" — cents matter at this scale. */
export function usd(n: number): string {
  return `$${n.toFixed(2)}`;
}
