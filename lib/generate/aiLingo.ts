// Detector for the phrasing that makes a caption read as machine-written, or as
// a 2015 YouTube thumbnail rather than something posted this year.
//
// WHY THIS IS CODE AND NOT JUST A PROMPT RULE: it already was a prompt rule. A
// real run produced "protein-packed meals are your secret weapon" while "X is
// your secret weapon" was sitting in the banned list of that very prompt, and
// another produced "the game-changer: ..." breaking two standing rules at once.
// The model complies most of the time and quietly ignores the rest, so anything
// that can be checked mechanically gets checked mechanically and RETRIED.
//
// Kept deliberately narrow: every entry is a phrase with no legitimate use in a
// caption. Vague-sounding-but-usable wording is the copy prompt's job, not this
// file's — a detector that fires on borderline phrasing would burn retries and
// push the model toward blander output, which is the opposite of the goal.

interface Tell {
  /** What to look for. Case-insensitive. */
  re: RegExp;
  /** Shown to the model on retry so it knows what to avoid. */
  label: string;
}

const TELLS: Tell[] = [
  // --- Ad-copy superlatives and "secret" framing -------------------------
  { re: /\bsecret weapon\b/i, label: '"secret weapon"' },
  { re: /\bgame[- ]?chang(er|ing)\b/i, label: '"game-changer"' },
  { re: /\bholy grail\b/i, label: '"holy grail"' },
  { re: /\bmagic bullet\b/i, label: '"magic bullet"' },
  { re: /\bbest[- ]kept secret\b/i, label: '"best-kept secret"' },
  { re: /\bhidden gem\b/i, label: '"hidden gem"' },

  // --- 2015 YouTube voice ------------------------------------------------
  { re: /\b(gym|life|fitness|diet|money|travel)\s+hacks?\b/i, label: '"hacks" framing' },
  { re: /\bpro tip\b/i, label: '"pro tip"' },
  { re: /\blet'?s dive (in|into)\b/i, label: '"let\'s dive in"' },
  { re: /\bbuckle up\b/i, label: '"buckle up"' },
  { re: /\bpronto\b/i, label: '"pronto"' },
  { re: /\bsupercharge\b/i, label: '"supercharge"' },
  { re: /\bskyrocket\b/i, label: '"skyrocket"' },
  { re: /\bcrush(ing)? (it|your goals)\b/i, label: '"crush it"' },
  { re: /\bnext[- ]level\b/i, label: '"next-level"' },
  { re: /\bpacked with\b/i, label: '"packed with"' },
  { re: /\b\w+-packed\b/i, label: '"…-packed" compound' },

  // --- Advisor voice: surveying options instead of committing ------------
  // The list number is baked into the caption now ("1. Focus on ..."), so the
  // opener anchor has to step over it.
  { re: /^\s*(?:\d+\s*[.):]\s*)?(focus on|make sure to|remember to|be sure to|don'?t forget to|try to)\b/i, label: "advisor opener (focus on / make sure to / remember to)" },
  { re: /\bconsider (adding|trying|doing)\b/i, label: '"consider adding/trying"' },
  { re: /\bcan help (you )?(to )?\b/i, label: '"can help"' },
  { re: /\bis key\b/i, label: '"X is key"' },
  { re: /\bit'?s all about\b/i, label: '"it\'s all about"' },
  { re: /\bthe key (is|to)\b/i, label: '"the key is"' },
  { re: /\bseals? the deal\b/i, label: '"seals the deal"' },

  // --- CTA tells ---------------------------------------------------------
  { re: /\bwant more\b.*\?/i, label: '"want more …?" CTA' },
  { re: /\bthe real stuff\b/i, label: '"the real stuff"' },
  { re: /\bdrop a follow\b/i, label: '"drop a follow"' },
  { re: /\bhit (that|the) (follow|like)\b/i, label: '"hit that follow"' },
  { re: /\byou won'?t regret it\b/i, label: '"you won\'t regret it"' },
  { re: /\bstay tuned\b/i, label: '"stay tuned"' },
  { re: /\bthank me later\b/i, label: '"thank me later"' },

  // --- Filler that announces vagueness -----------------------------------
  { re: /\byou'?re probably making\b/i, label: '"you\'re probably making"' },
  { re: /\bdid you know\b/i, label: '"did you know"' },
  { re: /\bunlock (your|the)\b/i, label: '"unlock your…"' },
  { re: /\belevate your\b/i, label: '"elevate your"' },
  { re: /\blevel up your\b/i, label: '"level up your"' },
  { re: /\btake (it|things) to the next level\b/i, label: '"next level"' },

  // --- Menu-blurb / copywriter voice -------------------------------------
  // A comma then a generic evaluative verdict — the pure ad-copy tail no one
  // texts ("mocha adds a chocolatey twist, perfect for a creamy finish"). Kept
  // tight (comma + evaluative word + preposition) so it only fires on the tail
  // structure; rewriting it toward a concrete benefit is exactly the goal, so
  // there is no push-toward-bland risk. The fuzzier menu-copy tells (abstract
  // sensory nouns, twee personification, over-balanced parallelism) are too
  // false-positive-prone to regex and live in the judge prompt instead.
  { re: /,\s*(perfect|great|ideal|amazing|excellent|wonderful)\s+(for|when|to|if)\b/i, label: 'evaluative tail clause ("…, perfect for …")' },
];

/** Every AI tell found in `text`, as human-readable labels (deduplicated). */
export function findAiLingo(text: string): string[] {
  if (!text) return [];
  const hits = TELLS.filter((t) => t.re.test(text)).map((t) => t.label);
  return [...new Set(hits)];
}

/** Scan a whole deck's captions and bodies at once. */
export function scanDeckForAiLingo(
  slides: { text?: string | null; body?: string | null }[],
): { slide: number; tells: string[] }[] {
  return slides
    .map((s, i) => ({
      slide: i + 1,
      tells: [...new Set([...findAiLingo(s.text ?? ""), ...findAiLingo(s.body ?? "")])],
    }))
    .filter((r) => r.tells.length > 0);
}
