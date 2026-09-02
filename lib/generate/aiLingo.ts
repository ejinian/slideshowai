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
  // Canned curiosity-gap hooks. "the meal prep secret nobody tells you" reads
  // as AI on sight — it is the hook-bank example lightly paraphrased, and any
  // "(the) secret nobody/no one …" construction lands the same way. "shhh" is
  // a model performing playfulness; people don't type it.
  { re: /\bsecret\s+(that\s+)?(nobody|no one)\b/i, label: '"secret nobody…" hook' },
  { re: /\b(nobody|no one)\s+(tells|talks about|is talking about|wants you to know)\b/i, label: '"nobody tells you" framing' },
  { re: /\bsh+h+\b/i, label: '"shhh" opener' },
  { re: /\bchanges? everything\b/i, label: '"changes everything"' },
  { re: /\bwill change your life\b/i, label: '"change your life"' },
  { re: /\byou didn'?t know you needed\b/i, label: '"didn\'t know you needed"' },

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

// ── Deck-level shape uniformity — tell #5 in docs/anti-ai-voice.md ──────────
// The dominant tell phrase-scans can't touch: every slide built as the same
// balanced two-clause sentence ("X but Y", "X, not Y", "X, so Y", "X and
// wonder why Y"). Run 65 (2026-08-27) shipped SIX of them in a row — written
// by the JUDGE, whose prompt already said "no two captions may share the same
// shape". Prompt rules leak; this is the mechanical backstop.

const CONTRAST_SHAPE_RE = /\b(but|yet)\b|,\s*not\b|,\s*so\b|\band wonders?\b/i;

/** Is this caption a balanced two-clause contrast sentence? */
export function contrastShaped(text: string): boolean {
  return CONTRAST_SHAPE_RE.test(text ?? "");
}

/**
 * Deck-level rhythm check: flags a deck of 4+ slides where 3 or more captions
 * share the contrast shape. Returns the offending slide numbers (1-based), or
 * null when the deck's rhythm is fine. Two contrast sentences are normal
 * writing; three-plus in one deck is a machine's idea of "punchy".
 */
export function scanDeckShape(
  slides: { text?: string | null }[],
): { slides: number[] } | null {
  if (slides.length < 4) return null;
  const hits = slides
    .map((s, i) => (contrastShaped(s.text ?? "") ? i + 1 : -1))
    .filter((i) => i > 0);
  return hits.length >= 3 ? { slides: hits } : null;
}

// ── Zinger cadence — tell #6 in docs/anti-ai-voice.md ───────────────────────
// The opposite of #5: every line a DIFFERENT shape, and every one visibly
// trying to be quotable. Run 75 (2026-09-02) shipped "if you don't read one
// money book a month, you're losing the race" / "money moves in rooms you never
// get into by looking rich" — all judge rewrites justified as "sharper" and
// "more punch" — against a real deck on the same topic that reads "avoid toxic
// people" / "plan their day the night before". Two sub-shapes are regular
// enough to catch mechanically: the conditional threat ("if you don't X,
// you're losing Y") and a deck that lectures the viewer as "you" on nearly
// every slide. Real decks are "what I did" / "what they do", not "you're
// losing".

const THREAT_SHAPE_RE =
  /^(if|unless|until)\s+you\b[^,.]*[,.]\s*(you('?re|'?ll|'?ve|\s+are|\s+will|\s+won'?t|\s+never)\b|your\b)/i;
const DOOM_RE =
  /\byou('?re|\s+are)\s+(losing|falling\s+behind|staying\s+(broke|small|stuck)|wasting|going\s+to\s+(stay|lose|fail))\b/i;

/** Is this caption a conditional threat ("if you don't X, you're Y") or a doom line? */
export function threatShaped(text: string): boolean {
  const t = (text ?? "").replace(/^\s*\d+[.)]\s*/, "");
  return THREAT_SHAPE_RE.test(t) || DOOM_RE.test(t);
}

/** Does this caption address the viewer directly? */
export function secondPerson(text: string): boolean {
  return /\b(you|your|you're|you'll|you've|yourself)\b/i.test(text ?? "");
}

/**
 * Deck-level zinger check. Any threat-shaped caption fails outright (one is
 * already the loudest motivational-poster tell there is). Second person is
 * capped, not banned — one "your shoulders are stealing the work" is a real
 * creator; a 4+ deck where more than half the slides lecture "you" is a
 * machine being punchy. Returns null when the deck is fine.
 */
export function scanZingers(
  slides: { text?: string | null }[],
): { threats: number[]; youSlides: number[]; youHeavy: boolean } | null {
  const threats = slides
    .map((s, i) => (threatShaped(s.text ?? "") ? i + 1 : -1))
    .filter((i) => i > 0);
  const youSlides = slides
    .map((s, i) => (secondPerson(s.text ?? "") ? i + 1 : -1))
    .filter((i) => i > 0);
  const youHeavy = slides.length >= 4 && youSlides.length > Math.ceil(slides.length / 2);
  return threats.length || youHeavy ? { threats, youSlides, youHeavy } : null;
}

/** Second-person cap for a deck of `n` slides — the most "you" captions allowed. */
export function secondPersonCap(n: number): number {
  return n >= 4 ? Math.ceil(n / 2) : n;
}
