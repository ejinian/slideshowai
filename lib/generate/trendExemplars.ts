import type { SupabaseClient } from "@supabase/supabase-js";

// Runtime "what's working on TikTok right now" fuel for caption generation.
// Reads the freshest high-velocity posts from `trending_posts` (populated by the
// Apify trends ingest) for the closest niche and renders them as few-shot
// exemplars the copy model studies — the same move a human creator makes before
// filming: scroll the niche, see which hooks are popping, match that energy.
//
// This is a single indexed SELECT (+ a short in-memory cache), NOT the Apify
// scrape — so it adds ~tens of ms, not seconds.

// generator niche key → trend-feed niche label. The trends taxonomy is coarse
// and business-model oriented (see lib/mock-data.ts), so several generator
// niches share a trend bucket.
const NICHE_TO_TREND: Record<string, string> = {
  // generator slugs
  gym: "Gym & Fitness",
  food: "Food & Dining",
  cafe: "Food & Dining",
  fashion: "E-commerce",
  beauty: "E-commerce",
  ecommerce: "E-commerce",
  realestate: "Local Service",
  // generator LABELS — Generator.tsx sends the label, not the slug
  "Gym & Fitness": "Gym & Fitness",
  "Food & Dining": "Food & Dining",
  "Cafe & Coffee": "Food & Dining",
  "Fashion & Apparel": "E-commerce",
  "Beauty & Skincare": "E-commerce",
  "Ecommerce / Product": "E-commerce",
  "Real Estate": "Local Service",
};

export interface TrendExemplar {
  hook: string;
  why: string | null;
  hookType: string | null;
}

const CACHE_TTL_MS = 5 * 60_000;
const cache = new Map<string, { at: number; rows: TrendExemplar[] }>();

type Row = {
  title: string | null;
  why_it_works: string | null;
  hook_type: string | null;
};

// A real prose hook ("Want bigger arms? Most people...") teaches the model far
// more than hashtag soup ("#glowup #trending"). Strip hashtags/mentions, then
// count remaining words to tell the two apart.
function proseWordCount(hook: string): number {
  return hook
    .replace(/[#@][\w-]+/g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .trim()
    .split(/\s+/)
    .filter((w) => w.length > 1).length;
}

function toExemplars(data: Row[]): TrendExemplar[] {
  const rows = data
    .filter((r) => (r.title ?? "").trim().length > 0)
    .map((r) => ({
      hook: (r.title ?? "").trim(),
      why: (r.why_it_works ?? "").trim() || null,
      hookType: (r.hook_type ?? "").trim() || null,
    }));
  // Stable sort (preserves the incoming view-velocity order within each group)
  // that floats substantive prose hooks above hashtag-only captions.
  return rows.sort(
    (a, b) => Number(proseWordCount(b.hook) >= 3) - Number(proseWordCount(a.hook) >= 3),
  );
}

/**
 * Top trending hooks for a generator niche, ordered by view velocity. Returns []
 * on any failure or empty table so generation proceeds without exemplars.
 */
export async function fetchTrendExemplars(
  supabase: SupabaseClient,
  nicheKey: string,
  limit = 8,
): Promise<TrendExemplar[]> {
  const trendNiche = NICHE_TO_TREND[nicheKey] ?? null;
  const cacheKey = trendNiche ?? "__all__";
  const hit = cache.get(cacheKey);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.rows.slice(0, limit);

  const select = "title, why_it_works, hook_type";
  const base = () =>
    supabase
      .from("trending_posts")
      .select(select)
      .order("views_per_hour", { ascending: false })
      .limit(24);

  let rows: TrendExemplar[] = [];
  try {
    const scoped = trendNiche ? base().eq("niche", trendNiche) : base();
    const { data, error } = await scoped;
    if (!error && data) rows = toExemplars(data as Row[]);

    // Sparse niche → top up with the best posts across every niche (still real,
    // still high-performing hooks worth mimicking).
    if (rows.length < 3 && trendNiche) {
      const { data: all } = await base();
      if (all) {
        const seen = new Set(rows.map((r) => r.hook));
        for (const e of toExemplars(all as Row[])) {
          if (!seen.has(e.hook)) rows.push(e);
        }
      }
    }
  } catch {
    return [];
  }

  cache.set(cacheKey, { at: Date.now(), rows });
  return rows.slice(0, limit);
}

/** Compact prompt block; empty string when there are no exemplars. */
export function exemplarsBlock(rows: TrendExemplar[]): string {
  if (rows.length === 0) return "";
  const lines = rows.map((r, i) => {
    const tag = r.hookType ? ` [${r.hookType}]` : "";
    const why = r.why ? `\n   why it works: ${r.why}` : "";
    return `${i + 1}. "${r.hook}"${tag}${why}`;
  });
  return (
    "REAL TikTok posts going viral in this niche RIGHT NOW — study the hook " +
    "style, structure, and specificity. Match this energy and calibre; write a " +
    "hook at least this scroll-stopping. Do NOT copy any of them verbatim:\n" +
    lines.join("\n")
  );
}
