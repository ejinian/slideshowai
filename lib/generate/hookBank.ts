// Static, curated bank of proven TikTok hook FORMULAS for slide 1.
//
// A "hook" is the first slide — its only job is to stop the scroll so the viewer
// swipes to slide 2. These are the highest-performing opening SHAPES (curiosity
// gap, forbidden/secret, stakes, callout, before→after, outcome promise),
// distilled from real viral photo-mode posts. They are a SOFT style input,
// injected into the copy prompt exactly like the live trend exemplars: the model
// picks the ONE shape that fits the user's topic and rewrites it around that
// topic — it never pastes a formula verbatim, and the topic always wins. Slide 1
// only; the rest of the deck (reasons + CTA) is unaffected.
//
// Static by design (no DB, no network, cannot throw) so it can never fail a
// generation. To add a hook, edit HOOK_BANK. A dynamic, trend-sourced version
// can layer on later without changing the injection seam.

export interface HookFormula {
  /** Human label for the psychological shape this hook uses. */
  type: string;
  /** Example phrasings; "X" stands in for the user's real topic. */
  examples: string[];
}

export const HOOK_BANK: HookFormula[] = [
  {
    type: "Curiosity gap — hide the payoff so they have to swipe",
    examples: [
      "nobody tells you this about X",
      "i bet you didn't know this about X",
      "you won't believe what i found out about X",
    ],
  },
  {
    type: "Forbidden / secret — feels like they shouldn't be seeing it",
    examples: [
      "you weren't supposed to see this about X",
      "i almost didn't post this X",
    ],
  },
  {
    type: "Cost / stakes — there's something to lose by ignoring it",
    examples: [
      "this X mistake is quietly costing you money",
      "most people get X wrong and never notice",
    ],
  },
  {
    type: "Callout — talk straight at the viewer",
    examples: [
      "most of you will skip this X, don't",
      "if you keep doing X, watch this first",
    ],
  },
  {
    type: "Before to after — show the transformation / outcome",
    examples: [
      "how i went from [bad result] to [great result] with X",
      "the X that took me from [before] to [after]",
    ],
  },
  {
    type: "Outcome promise — lead with the concrete win",
    examples: [
      "the X that got me [specific result]",
      "do X and here's exactly what happens",
    ],
  },
];

/**
 * Compact prompt block listing the hook formulas. Static, so in practice this
 * always returns the block; the caller still treats "" as "inject nothing".
 */
/**
 * @param numberedHook whether the deck's slide 1 must state a headline count.
 *   Short decks (1-3 slides) have no list to count, so demanding a number there
 *   contradicts their framework and produces broken hooks like "the 1 thing…".
 */
export function hookBankBlock(numberedHook = true): string {
  if (HOOK_BANK.length === 0) return "";
  const lines = HOOK_BANK.map(
    (h) => `• ${h.type}: ${h.examples.map((e) => `"${e}"`).join(", ")}`,
  );
  return (
    "PROVEN HOOK FORMULAS for SLIDE 1 — pick the ONE shape that best fits the topic " +
    'and rewrite it entirely around the topic\'s specifics ("X" = the user\'s topic). ' +
    "These are shapes, not scripts: never paste one word-for-word, never let a " +
    "formula pull slide 1 off the topic, and keep the voice rules above (sentence " +
    "case, no exclamation marks)." +
    (numberedHook
      ? " Whatever shape you choose, the slide-1 hook must still contain the " +
        "exact headline number required below."
      : " This post has no list, so the hook must NOT contain a count.") +
    "\n" +
    lines.join("\n")
  );
}

// ── Verbatim-echo guard ──────────────────────────────────────────────────────
// The bank's own instructions say "never paste a formula word-for-word", but
// prompt rules leak: a live run shipped "you weren't supposed to find out
// about no clove" — the forbidden-secret example with X swapped — which reads
// exactly as AI. This is the mechanical backstop: a hook that shares a long
// word-run with any bank example is an echo, and the caller retries the deck.

const STOP = new Set(["a", "an", "the", "this", "that", "your", "my", "our"]);

function tokens(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((w) => w && !STOP.has(w) && w !== "x");
}

/**
 * The bank example the hook copies nearly word-for-word, or null. A hook
 * counts as an echo when it contains 4+ consecutive content-words from one
 * example ("you weren't supposed to see/find-out" trips it; a fresh hook in
 * the same SHAPE — different words — never does).
 */
export function formulaEcho(hook: string): string | null {
  const h = tokens(hook);
  if (h.length < 4) return null;
  const runs = new Set<string>();
  for (let i = 0; i + 4 <= h.length; i++) runs.add(h.slice(i, i + 4).join(" "));
  for (const f of HOOK_BANK) {
    for (const ex of f.examples) {
      const e = tokens(ex);
      for (let i = 0; i + 4 <= e.length; i++) {
        if (runs.has(e.slice(i, i + 4).join(" "))) return ex;
      }
    }
  }
  return null;
}

