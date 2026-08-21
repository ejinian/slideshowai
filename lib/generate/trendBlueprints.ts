import type { SupabaseClient } from "@supabase/supabase-js";
import { stripEmoji } from "./cleanCaption";
import type { FormatBlueprint } from "./listicle";
import { NICHE_TO_TREND, proseWordCount } from "./trendExemplars";

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
}

const CACHE_TTL_MS = 5 * 60_000;
const cache = new Map<string, { at: number; bp: TrendBlueprint | null }>();

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
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.bp;

  let bp: TrendBlueprint | null = null;
  try {
    const { data, error } = await supabase
      .from("trending_posts")
      .select("id, author, views, views_per_hour, hook_type, anatomy, slide_texts")
      .eq("niche", trendNiche)
      .not("slide_texts", "is", null)
      .not("hook_type", "is", null)
      .order("views_per_hour", { ascending: false })
      .limit(12);
    if (!error && data) {
      for (const r of data as unknown as Row[]) {
        const candidate = toBlueprint(r);
        if (candidate) {
          bp = candidate;
          break;
        }
      }
    }
  } catch {
    bp = null;
  }

  cache.set(trendNiche, { at: Date.now(), bp });
  return bp;
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
  };
}
