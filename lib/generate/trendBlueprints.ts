import type { SupabaseClient } from "@supabase/supabase-js";
import { stripEmoji } from "./cleanCaption";
import type { FormatBlueprint } from "./listicle";
import { NICHE_TO_TREND, proseWordCount } from "./trendExemplars";
import { canonicalizeHookType, isSteerable, type HookShape } from "./hookTaxonomy";

// Auto-apply the mechanic of what's trending: pick the strongest curated post
// for the niche and ride its format down the SAME channel "Remix this trend"
// and "Make one like this" already use (`format` on the generate request, via
// cleanFormat). listicle.ts / imageFirst.ts stay untouched — the separation
// that protects the caption prompts everywhere else.
//
// No new model spend: the ingest curation pass already writes `hook_type` and
// a slide-by-slide `anatomy` for every relevant post, and the transcription
// pass stores the real on-slide text. This module is one indexed SELECT plus a
// short cache, like trendExemplars.
//
// An explicit blueprint (remix, reference) ALWAYS wins over this — the caller
// only asks for a trend blueprint when the client sent no format of its own.
//
// SELECTION IS SAMPLED, NOT MAXIMISED (2026-08-24). This used to be "order by
// views_per_hour, take the first row that passes the gate", which had two
// problems measured against the live corpus:
//
//   1. It steered whole niches with posts whose mechanic carries no value —
//      every plain E-commerce deck was riding a personal pregnancy-loss post,
//      every Local Service deck "photos i feel weirdly pretty in". Both are
//      genuinely trending; neither transfers to a deck meant to teach
//      something. Fixed by the steerable-shape filter (see hookTaxonomy.ts).
//   2. Even with a perfect ranking, always taking the top post makes every deck
//      in a niche the same shape for the life of the cache — the same monotony
//      as the old forced "N ways to…" hook, just wearing a different hat. So
//      we sample from the qualifying window instead, weighted by rank.
//
// `views_per_hour` is kept as the WEIGHTING signal but is deliberately no
// longer the decider: it is `views / hours` frozen at ingest, so it mostly
// tracks how soon after posting we happened to scrape (median vph falls 11 -> 2
// across age buckets while median views stays flat). The age-robust replacement
// is a per-snapshot delta over `trend_snapshots` — that is step B in
// docs/hook-scoring.md and is out of scope here.

/** Kill switch: TREND_BLUEPRINTS=off disables auto-attach without a deploy. */
export function trendBlueprintsEnabled(): boolean {
  return (process.env.TREND_BLUEPRINTS ?? "on").toLowerCase() !== "off";
}

export interface TrendBlueprint {
  format: FormatBlueprint;
  /** trending_posts.id — stored in gen_meta so views can be joined back later. */
  postId: string;
  author: string | null;
  views: number | null;
  viewsPerHour: number | null;
  /** Canonical shape this post was sampled as; null when the label is unknown. */
  shape: HookShape | null;
}

const CACHE_TTL_MS = 5 * 60_000;
/** How many velocity-ranked posts to consider before sampling. */
const CANDIDATE_WINDOW = 12;
// The POOL is cached, not the pick — otherwise every deck in the 5-minute
// window gets the same blueprint again and the sampling does nothing.
const cache = new Map<string, { at: number; pool: TrendBlueprint[] }>();

type Row = {
  id: string;
  author: string | null;
  views: number | null;
  views_per_hour: number | null;
  hook_type: string | null;
  anatomy: { slides?: string; beat?: string }[] | null;
  slide_texts: string[] | null;
};

/**
 * The highest-velocity post for the niche that we genuinely understand.
 *
 * "Genuinely understand" is the quality gate, and it is deliberately strict:
 * the row must have TRANSCRIBED slide text (so the anatomy was inferred from
 * the real slides, not from a hashtag description), a hook_type, and at least
 * two anatomy beats. Curation runs on gpt-4o-mini over whatever text exists,
 * so an anatomy guessed off "#fyp #goviral" is noise — steering every deck in
 * the niche with noise is worse than no steering at all.
 *
 * Returns null on any failure, empty table, or unmapped niche: generation then
 * proceeds exactly as before this feature existed.
 */
export async function fetchTrendBlueprint(
  supabase: SupabaseClient,
  nicheKey: string,
): Promise<TrendBlueprint | null> {
  const trendNiche = NICHE_TO_TREND[nicheKey] ?? null;
  if (!trendNiche) return null;

  const hit = cache.get(trendNiche);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return pickWeighted(hit.pool);

  let pool: TrendBlueprint[] = [];
  try {
    const { data, error } = await supabase
      .from("trending_posts")
      .select("id, author, views, views_per_hour, hook_type, anatomy, slide_texts")
      .eq("niche", trendNiche)
      .not("slide_texts", "is", null)
      .not("hook_type", "is", null)
      .order("views_per_hour", { ascending: false })
      .limit(CANDIDATE_WINDOW);
    if (!error && data) {
      for (const r of data as unknown as Row[]) {
        const candidate = toBlueprint(r);
        // Unknown shape (null) is NOT excluded — the label vocabulary is still
        // drifting, so an unrecognised label means "we can't tell", not "bad".
        // Only a shape we affirmatively know carries no value is dropped.
        if (candidate && candidate.shape !== null && !isSteerable(candidate.shape)) {
          continue;
        }
        if (candidate) pool.push(candidate);
      }
    }
  } catch {
    pool = [];
  }

  cache.set(trendNiche, { at: Date.now(), pool });
  return pickWeighted(pool);
}

/**
 * Sample one blueprint, biased toward the front of the (velocity-ordered) pool.
 *
 * Rank weight 1/(i+1) rather than the raw view counts: velocity spans three
 * orders of magnitude inside a single niche, so weighting by it directly is
 * argmax with extra steps — one post would take ~95% of the draws. The
 * harmonic profile keeps the strongest post the most likely single outcome
 * while leaving the rest of the window genuinely reachable.
 */
function pickWeighted(pool: TrendBlueprint[]): TrendBlueprint | null {
  if (pool.length === 0) return null;
  if (pool.length === 1) return pool[0];
  const weights = pool.map((_, i) => 1 / (i + 1));
  const total = weights.reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (let i = 0; i < pool.length; i++) {
    r -= weights[i];
    if (r <= 0) return pool[i];
  }
  return pool[pool.length - 1];
}

function toBlueprint(r: Row): TrendBlueprint | null {
  const hookType = (r.hook_type ?? "").trim();
  const anatomy = (r.anatomy ?? [])
    .map((b) => ({
      slides: String(b?.slides ?? "").slice(0, 12),
      beat: String(b?.beat ?? "").slice(0, 120),
    }))
    .filter((b) => b.slides && b.beat);
  if (!hookType || anatomy.length < 2) return null;

  // First slide that actually says something — same rule as trendExemplars.
  // stripEmoji at the prompt boundary, not in the stored corpus (the caption
  // font has no emoji glyphs; an exemplar breaking the prompt's own ban is how
  // a ban leaks).
  const hookText =
    (r.slide_texts ?? [])
      .map((t) => (typeof t === "string" ? stripEmoji(t) : ""))
      .find((t) => t.length > 0) ?? null;
  // The hook doubles as the style exemplar, so it must be real prose. This is
  // what keeps "SLIDESHOW IDEA!!" — a live top-velocity post in realestate —
  // from becoming the caption the whole niche gets taught to imitate.
  if (!hookText || proseWordCount(hookText) < 3) return null;

  return {
    format: {
      hookType: hookType.slice(0, 40),
      exemplarCaption: hookText.slice(0, 300),
      anatomy: anatomy.slice(0, 6),
    },
    postId: r.id,
    author: r.author,
    views: r.views ?? null,
    viewsPerHour: r.views_per_hour ?? null,
    shape: canonicalizeHookType(hookType),
  };
}
