// Canonical hook-shape vocabulary for the trend corpus.
//
// `trending_posts.hook_type` is written by the ingest curation pass as FREE
// TEXT, and it has fragmented: 72 distinct labels over 759 transcribed rows,
// 55 of them singletons ("Quote of the day", "Choose your meal", "Price
// question"). Anything that wants to aggregate over hook shape — the scoring
// layer in docs/hook-scoring.md — first needs a closed set to aggregate into.
//
// This module is pure string work: a regex table, no DB, no model call, cannot
// throw. Legacy rows are mapped on read, so nothing needs backfilling for the
// steering fix to take effect.

/** Shapes we will steer a generated deck with. Aligned to HOOK_BANK. */
export const STEERABLE_SHAPES = [
  "curiosity_gap",
  "forbidden_secret",
  "cost_stakes",
  "callout",
  "before_after",
  "outcome_promise",
  "listicle",
  "pov_story",
  "price_anchor",
] as const;

/**
 * Shapes that are real and common in the corpus but carry NO value payload, so
 * they must never steer a value listicle.
 *
 * This is the fix for what was live on 2026-08-24: because `fetchTrendBlueprint`
 * took the top row by raw view velocity, every plain E-commerce deck was being
 * steered by a personal pregnancy-loss post ("Transformation arc") and every
 * Local Service deck by "photos i feel weirdly pretty in" ("Photo dump").
 * Those posts genuinely are trending; their mechanic just doesn't transfer to a
 * deck whose job is to teach the viewer something.
 */
export const NOT_STEERABLE_SHAPES = [
  "photo_dump",
  "sentiment",
  "engagement_bait",
  "product_promo",
] as const;

export type SteerableShape = (typeof STEERABLE_SHAPES)[number];
export type NotSteerableShape = (typeof NOT_STEERABLE_SHAPES)[number];
export type HookShape = SteerableShape | NotSteerableShape;

const STEERABLE = new Set<string>(STEERABLE_SHAPES);

/** True when this shape may steer a generated deck. */
export function isSteerable(shape: HookShape | null): shape is SteerableShape {
  return shape != null && STEERABLE.has(shape);
}

// Order matters: the first pattern to match wins, so the narrower phrases sit
// above the broader ones ("numbered listicle" before "listicle", "before and
// after" before the bare "after"). Built from the actual label distribution —
// every label with n>=2 in the corpus on 2026-08-24 is covered here.
const PATTERNS: [RegExp, HookShape][] = [
  [/photo\s?dump|dump|photo showcase|nostalgia|gallery/i, "photo_dump"],
  [/gatekeep/i, "curiosity_gap"],
  [/curiosity|teaser|tease|mystery|secret|forbidden|hidden|illegal/i, "curiosity_gap"],
  [/before\s*(and|&|to)?\s*after|transformation|glow\s?up|journey|arc/i, "before_after"],
  [/numbered listicle|listicle|numbered tips|tip list|advice list|how-?to list|how-?to guide|how-?to|app list|check\s?list|informative list|idea generation|process walkthrough|workout breakdown|steps?/i, "listicle"],
  [/callout|direct address|calling out|psa/i, "callout"],
  [/price anchor|price question|pricing|cost|budget|deal/i, "price_anchor"],
  [/pov|story|storytelling|narrative|relatable|day in the life|behind[-\s]?the[-\s]?scenes|interactive story/i, "pov_story"],
  [/outcome|result|promise|payoff|transformation promise|future vision/i, "outcome_promise"],
  [/stakes|mistake|warning|risk|red flag|don'?t/i, "cost_stakes"],
  [/engagement\s?(prompt|bait)|cta|invitation|interactive|decision|choose|poll|question/i, "engagement_bait"],
  [/product showcase|featured product|product promo|promotion|promo|brand marketing|service showcase|business showcase|testimonial|feature highlight|showcase/i, "product_promo"],
  [/motivat|quote|mantra|mood|apprecia|shoutout|community|support|positive|humor|humour|inspir/i, "sentiment"],
];

/**
 * Map a raw `hook_type` string onto the canonical set. Returns null when the
 * label is unrecognised — callers treat null as "unknown", NOT as "excluded",
 * so an unmapped-but-fine post is still usable when nothing else qualifies.
 */
export function canonicalizeHookType(raw: string | null | undefined): HookShape | null {
  const s = (raw ?? "").trim();
  if (!s) return null;
  for (const [re, shape] of PATTERNS) {
    if (re.test(s)) return shape;
  }
  return null;
}
