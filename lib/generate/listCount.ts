// Pure, dependency-free: shared by generation (server) and the slide editor
// (client), which keeps a hook's stated count true after a slide is deleted.
// Lives apart from listicle.ts because that module imports the OpenAI SDK.

// If the user's topic states a list count ("3 exercises", "5 tips"), that number
// is their intent for how many value slides they want — honor it instead of
// letting the slide-count dropdown force a contradicting headline number
// ("3 ways" rendering as "4"). Returns the desired value-slide count (2..8), or
// null when the topic has no explicit listicle count.
const LIST_NOUNS =
  "ways?|tips?|reasons?|mistakes?|things?|steps?|exercises?|foods?|habits?|" +
  "signs?|lessons?|rules?|hacks?|secrets?|myths?|examples?|ideas?|benefits?|" +
  "facts?|moves?|drills?|stretches?|recipes?|traits?|questions?|" +
  // Added once numbering started following the hook: "5 fixes", "5 truths" and
  // "5 changes" are as much a list count as "5 ways", but were unrecognised, so
  // a deck whose hook plainly promised five items came out unnumbered.
  "fixes|truths?|changes?|swaps?|tricks?|picks?|spots?|places?|products?|" +
  "apps?|tools?|items?|lies|rules?|upgrades?|costs?|fails?";
// Up to three words may sit between the count and the noun — "3 chest
// exercises", "5 boring gut health fixes" were missed by requiring adjacency,
// which silently skipped the topic's stated count AND let a hook claiming a
// different number pass validation.
const NOUN_COUNT_RE = new RegExp(
  `\\b(\\d{1,2})\\s+(?:\\w+\\s+){0,3}(?:${LIST_NOUNS})\\b`,
  "i",
);
// "top 3 cars", "5 best sedans", "my 3 favourite lifts": a count whose noun is
// the SUBJECT, not a list word — "cars" will never be in LIST_NOUNS, yet "top 3
// cars best bang for buck" promises exactly three. 2026-09-24: that hook went
// unrecognised, so the Slides pill (6) won, five cars followed a "top 3", and
// the selector threw the creator's own wording away for the mismatch. Only
// unambiguous list phrasings — a bare "in 8 weeks" is a stat, not a promise
// (run 82), and stays out.
const LIST_PHRASES: RegExp[] = [
  /\btop\s+(\d{1,2})\b/i,
  /\b(\d{1,2})\s+best\b/i,
  /\bbest\s+(\d{1,2})\b/i,
  /\bmy\s+(\d{1,2})\s+(?:favou?rite|go-to)\b/i,
];

function matchCount(
  text: string,
  accept: (n: number) => boolean,
): { n: number; re: RegExp } | null {
  for (const re of [NOUN_COUNT_RE, ...LIST_PHRASES]) {
    const m = text.match(re);
    if (!m) continue;
    const n = parseInt(m[1], 10);
    if (accept(n)) return { n, re };
  }
  return null;
}

// 2..8 is the range a TOPIC can ask for — it sizes the deck.
function listCountMatch(text: string): { n: number; re: RegExp } | null {
  return matchCount(text, (n) => n >= 2 && n <= 8);
}

export function explicitListCount(text: string): number | null {
  return listCountMatch(text)?.n ?? null;
}

/**
 * Replace the hook's list count (the same digit+noun match explicitListCount
 * recognises) with `count`. Unchanged when the text has no list count — a bare
 * number is a stat, not a promise ("added 2 inches in 8 weeks" was rewritten to
 * "4 inches" by a first-integer match on run 82, falsifying the claim).
 */
export function replaceListCount(text: string, count: number): string {
  const hit = listCountMatch(text);
  if (!hit) return text;
  // Swap only the digits inside the phrase that matched, whichever form it took.
  return text.replace(hit.re, (whole: string, digits: string) =>
    whole.replace(digits, String(count)),
  );
}

// ── For the slide editor ───────────────────────────────────────────────────
// The same phrasings, without the 2..8 topic range: a finished deck can state
// any count ("9 things i wish i knew"), and the editor only ever corrects a
// count that already matched the deck.

/** The list count a caption states, whatever its size; null when it states none. */
export function statedListCount(text: string): number | null {
  return matchCount(text, (n) => n >= 1)?.n ?? null;
}

/** Swap the stated list count for `count`. Unchanged when none is stated. */
export function replaceStatedCount(text: string, count: number): string {
  const hit = matchCount(text, (n) => n >= 1);
  if (!hit) return text;
  return text.replace(hit.re, (whole: string, digits: string) =>
    whole.replace(digits, String(count)),
  );
}
