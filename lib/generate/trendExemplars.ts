import type { SupabaseClient } from "@supabase/supabase-js";
import { stripEmoji } from "./cleanCaption";

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
export const NICHE_TO_TREND: Record<string, string> = {
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
  /**
   * The remaining transcribed slides, when we have them. Present only on
   * `onSlide` exemplars.
   */
  rest: string[];
  /**
   * True when `hook` is the text transcribed off slide 1 — i.e. the words that
   * actually stopped the scroll. False when it is the video DESCRIPTION, a much
   * weaker signal that must never be presented to the model as a slide hook.
   */
  onSlide: boolean;
}

const CACHE_TTL_MS = 5 * 60_000;
const cache = new Map<string, { at: number; rows: TrendExemplar[] }>();

const FULL_COLS = "title, why_it_works, hook_type, slide_texts";
const LEGACY_COLS = "title, why_it_works, hook_type";
let selectCols: string = FULL_COLS;

type Row = {
  title: string | null;
  why_it_works: string | null;
  hook_type: string | null;
  slide_texts: string[] | null;
};

// A real prose caption ("Want bigger arms? Most people...") teaches the model
// far more than hashtag soup ("#glowup #trending"). Strip hashtags/mentions,
// then count remaining words to tell the two apart.
export function proseWordCount(hook: string): number {
  return hook
    .replace(/[#@][\w-]+/g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .trim()
    .split(/\s+/)
    .filter((w) => w.length > 1).length;
}

function toExemplars(data: Row[]): TrendExemplar[] {
  const rows: TrendExemplar[] = [];
  for (const r of data) {
    const why = (r.why_it_works ?? "").trim() || null;
    const hookType = (r.hook_type ?? "").trim() || null;
    // Prefer the transcribed slides. `slide_texts` can lead with an empty
    // string (a photo-only opener), so the hook is the first slide that
    // actually says something, and the rest follow it in order.
    //
    // stripEmoji here and NOT at ingest: real creators use emoji constantly
    // (measured — "happy girl autumn 🍂" came straight off a live slide), so
    // the stored corpus keeps them and stays a faithful transcription. But we
    // are about to hand these to a model whose prompt bans emoji outright,
    // because the caption font has no glyph for them and they bake as tofu
    // boxes. Showing an exemplar that breaks a rule the same prompt states is
    // how a ban leaks — see the "secret weapon" leak in listicle.ts.
    const slides = (r.slide_texts ?? [])
      .map((t) => (typeof t === "string" ? stripEmoji(t) : ""))
      .filter((t) => t.length > 0);
    if (slides.length > 0) {
      rows.push({ hook: slides[0], why, hookType, rest: slides.slice(1), onSlide: true });
      continue;
    }
    const title = stripEmoji(r.title ?? "");
    if (title.length > 0) {
      rows.push({ hook: title, why, hookType, rest: [], onSlide: false });
    }
  }
  // Stable sort (preserves the incoming view-velocity order within each group):
  // real on-slide text first, then prose descriptions, then hashtag-only ones.
  const rank = (e: TrendExemplar) =>
    e.onSlide ? 2 : proseWordCount(e.hook) >= 3 ? 1 : 0;
  return rows.sort((a, b) => rank(b) - rank(a));
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

  const base = () =>
    supabase
      .from("trending_posts")
      .select(selectCols)
      .order("views_per_hour", { ascending: false })
      .limit(24);

  let rows: TrendExemplar[] = [];
  try {
    const scoped = trendNiche ? base().eq("niche", trendNiche) : base();
    let { data, error } = await scoped;
    // Tolerate a deploy that lands before the slide_texts migration runs.
    // Latched, so we pay the failed round-trip once per process, not per call.
    if (error && /slide_texts/.test(error.message)) {
      selectCols = LEGACY_COLS;
      ({ data, error } = trendNiche ? await base().eq("niche", trendNiche) : await base());
    }
    if (!error && data) rows = toExemplars(data as unknown as Row[]);

    // Sparse niche → top up with the best posts across every niche (still real,
    // still high-performing hooks worth mimicking).
    if (rows.length < 3 && trendNiche) {
      const { data: all } = await base();
      if (all) {
        const seen = new Set(rows.map((r) => r.hook));
        for (const e of toExemplars(all as unknown as Row[])) {
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

// On-slide text frequently IS a quotation ("Isaiah, why were you going to the
// gym?"), and wrapping that in quotes again yields a stuttered ""…"" that reads
// as a formatting glitch in the prompt. Quote only when it isn't already.
const quoted = (s: string) =>
  /^["“].*["”]$/.test(s) ? s : `"${s}"`;

/**
 * Compact prompt block; empty string when there are no exemplars.
 *
 * The two groups are kept SEPARATE and labelled differently on purpose. An
 * on-slide transcription is the real thing — the words a human typed onto a
 * slide that then went viral — and is the strongest voice signal we have. A
 * video description is a different genre (hashtag-stuffed, written for search,
 * never seen on the slide); presenting one to the model as if it were a hook
 * teaches it to write descriptions, which is the failure this whole pipeline
 * exists to fix.
 */
export function exemplarsBlock(rows: TrendExemplar[]): string {
  if (rows.length === 0) return "";
  const blocks: string[] = [];

  const onSlide = rows.filter((r) => r.onSlide);
  if (onSlide.length > 0) {
    const lines = onSlide.map((r, i) => {
      const tag = r.hookType ? ` [${r.hookType}]` : "";
      // The following slides carry the deck's SHAPE — how short the lines run,
      // how unevenly they vary, how little gets explained. That structural
      // variety is the dominant "reads as AI" tell in docs/anti-ai-voice.md,
      // and no ban list can teach it the way one real deck does.
      const rest = r.rest.length
        ? `\n   then: ${r.rest.slice(0, 3).map(quoted).join(" | ")}`
        : "";
      const why = r.why ? `\n   why it works: ${r.why}` : "";
      return `${i + 1}. ${quoted(r.hook)}${tag}${rest}${why}`;
    });
    blocks.push(
      "THE ACTUAL WORDS ON SLIDESHOWS GOING VIRAL IN THIS NICHE RIGHT NOW — " +
        "transcribed straight off the images, uncorrected. This is how real " +
        "creators write when nobody is making them sound professional: note " +
        "the lowercase, the missing punctuation, the bluntness, how specific " +
        "they get, and how little they explain. Note also that no two slides " +
        "are built the same way. WRITE IN THIS REGISTER. Take the voice and " +
        "the calibre; never the words, never the subject:\n" +
        lines.join("\n"),
    );
  }

  const described = rows.filter((r) => !r.onSlide);
  if (described.length > 0) {
    const lines = described.map((r, i) => {
      const tag = r.hookType ? ` [${r.hookType}]` : "";
      const why = r.why ? `\n   why it works: ${r.why}` : "";
      return `${i + 1}. ${quoted(r.hook)}${tag}${why}`;
    });
    blocks.push(
      "Also trending in this niche, but only the post's DESCRIPTION was " +
        "available, not its on-slide text. Descriptions are written for search " +
        "and read nothing like a slide. Use these for subject matter and angle " +
        "only — never as a model for how a caption should sound:\n" +
        lines.join("\n"),
    );
  }

  return blocks.join("\n\n");
}
