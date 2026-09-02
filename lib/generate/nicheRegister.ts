import type { SupabaseClient } from "@supabase/supabase-js";
import { NICHE_TO_TREND } from "./trendExemplars";
import { secondPerson } from "./aiLingo";

// Per-niche REGISTER, measured from the corpus instead of guessed.
//
// The trend exemplars show the copy model real captions from the niche; the
// length and second-person rules were one fixed set applied to every niche.
// Measured on 2026-09-02 across 759 transcribed decks that is wrong for at
// least one bucket: Gym / Local Service / Food / E-commerce run 4-6 words a
// slide with 7-28% of slides addressing "you", while B2C App runs 13 words
// and 48% "you". A global 10-word cap fits four niches and fights the fifth.
//
// This reads the same `trending_posts` rows the exemplars come from (one
// indexed SELECT, 5-min cache, no model spend) and turns them into a target
// the prompt states and caps the validators enforce. Every derived number is
// clamped so a thin or odd sample can never produce a silly cap, and any
// failure returns null so generation proceeds on the global defaults.

export interface NicheRegister {
  /** Trend-feed label the sample was drawn from. */
  trendNiche: string;
  /** Posts in the sample (all had transcribed slide text). */
  posts: number;
  /** Median words per non-empty slide across the sample. */
  medianWords: number;
  /** Median words on slide 1. */
  medianHookWords: number;
  /** Share of slides (0..1) that address the viewer as "you". */
  youRate: number;
  /** Hard one-line cap derived from medianWords (clamped 8..16). */
  wordCap: number;
  /** Share of a deck's slides allowed to address "you" (clamped). */
  youFraction: number;
}

const CACHE_TTL_MS = 5 * 60_000;
const cache = new Map<string, { at: number; reg: NicheRegister | null }>();

const MIN_POSTS = 15;
const SAMPLE = 60;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const median = (a: number[]) => {
  const s = [...a].sort((x, y) => x - y);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
};

/** Caps the validators use — global defaults when there is no register. */
export function capsFor(reg: NicheRegister | null | undefined, fallbackWordCap: number) {
  const wordCap = reg?.wordCap ?? fallbackWordCap;
  const youCap = (n: number): number =>
    n >= 4 ? Math.max(1, Math.ceil(n * (reg?.youFraction ?? 0.5))) : n;
  return { wordCap, youCap };
}

export function computeRegister(
  trendNiche: string,
  rows: { slide_texts: unknown }[],
): NicheRegister | null {
  const words: number[] = [];
  const hookWords: number[] = [];
  let you = 0;
  let posts = 0;
  for (const r of rows) {
    const texts = Array.isArray(r.slide_texts)
      ? (r.slide_texts as unknown[])
          .map((t) => (typeof t === "string" ? t.trim() : ""))
          .filter((t) => t.length > 0)
      : [];
    if (texts.length < 2) continue;
    posts++;
    hookWords.push(texts[0].split(/\s+/).length);
    for (const t of texts) {
      words.push(t.split(/\s+/).length);
      if (secondPerson(t)) you++;
    }
  }
  if (posts < MIN_POSTS) return null;
  const medianWords = median(words);
  const youRate = you / words.length;
  return {
    trendNiche,
    posts,
    medianWords,
    medianHookWords: median(hookWords),
    youRate,
    // 1.6× the median leaves room for the occasional longer line without
    // letting the typical slide drift back to a two-clause sentence.
    wordCap: clamp(Math.round(medianWords * 1.6), 8, 16),
    // A little headroom over the measured rate; never below a third (one
    // "your shoulders are stealing the work" is always fine) or above 3/4.
    youFraction: clamp(youRate + 0.2, 0.34, 0.75),
  };
}

/**
 * Register for a generator niche key, from the fastest-growing transcribed
 * posts in its trend bucket. null when the niche has no bucket, the sample is
 * too thin, or anything fails — callers then keep the global caps.
 */
export async function fetchNicheRegister(
  supabase: SupabaseClient,
  nicheKey: string,
): Promise<NicheRegister | null> {
  const trendNiche = NICHE_TO_TREND[nicheKey] ?? null;
  if (!trendNiche) return null;
  const hit = cache.get(trendNiche);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.reg;
  let reg: NicheRegister | null = null;
  try {
    const { data, error } = await supabase
      .from("trending_posts")
      .select("slide_texts")
      .eq("niche", trendNiche)
      .not("slide_texts", "is", null)
      .order("views_per_hour", { ascending: false })
      .limit(SAMPLE);
    if (!error && data) reg = computeRegister(trendNiche, data as { slide_texts: unknown }[]);
  } catch {
    reg = null;
  }
  cache.set(trendNiche, { at: Date.now(), reg });
  return reg;
}

/** Prompt paragraph stating the measured target; "" when there is none. */
export function registerBlock(reg: NicheRegister | null | undefined): string {
  if (!reg) return "";
  const pct = Math.round(reg.youRate * 100);
  const youLine =
    reg.youRate >= 0.4
      ? `talking straight to the viewer is normal here (${pct}% of slides say "you"), so do it where it fits`
      : reg.youRate >= 0.2
        ? `about ${pct}% of slides address the viewer as "you"; the rest state what works or what someone did`
        : `almost nobody addresses the viewer here (${pct}% of slides say "you"); state what works, what they do, what i did`;
  return (
    `REGISTER IN THIS NICHE — measured off the ${reg.posts} fastest-growing ` +
    `slideshows in ${reg.trendNiche} right now, not a guess. The typical slide ` +
    `is ${reg.medianWords} words and the hook about ${reg.medianHookWords}; ` +
    `${youLine}. Write to that length: captions around ${reg.medianWords} ` +
    `words, never more than ${reg.wordCap}.`
  );
}
