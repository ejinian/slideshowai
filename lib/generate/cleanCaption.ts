// Deterministic caption cleanup, applied at the single choke point both intake
// paths funnel through, so the stored caption, the editor overlay and the bake
// all agree.
//
// These rules are ALSO stated in the copy prompts, but prompt bans are soft: a
// banned cliché ("game-changer") shipped in a real run despite being listed
// explicitly. Anything that can be enforced mechanically is enforced here too.

// Emoji (and their joiners/variation selectors) have no glyph in the caption
// font, so they bake as tofu boxes. Matches pictographs only — ASCII digits are
// `Emoji` but not `Emoji_Presentation`, so "3 tips" survives intact.
const EMOJI_RE =
  /[\p{Extended_Pictographic}\p{Emoji_Presentation}️‍⃣]/gu;

export function stripEmoji(s: string): string {
  return s.replace(EMOJI_RE, "").replace(/\s{2,}/g, " ").trim();
}

// Em/en dashes are the loudest "a machine wrote this" tell in a caption.
//
// ONLY the long dashes and the double-hyphen are touched. The ordinary
// hyphen-minus is left alone because it is load-bearing in real words
// ("game-changers", "sold-out", "6am-9am").
// An ASCII arrow ("--->") is a deliberate, human-looking device the copy model
// may use, so the dash run that forms it must survive. Only dashes NOT followed
// by ">" are punctuation.
// The lookahead excludes "-" too: without it, `--+` backtracks out of "--->",
// matches just "--" and leaves a stray "->".
const LONG_DASH_RE = /\s*(?:--+(?![->])|[–—―])\s*/g;

export function stripLongDashes(s: string): string {
  return (
    s
      // Between words it becomes the comma a person would have typed; at either
      // end of the caption it is just noise.
      .replace(LONG_DASH_RE, (match, offset: number, full: string) =>
        offset === 0 || offset + match.length >= full.length ? "" : ", ",
      )
      .replace(/\s+,/g, ",")
      .replace(/,(\s*,)+/g, ",")
      .replace(/,\s*([.!?])/g, "$1")
      .replace(/\s{2,}/g, " ")
      .trim()
  );
}

// Colons are the other loud tell, and the prompt ban demonstrably does not hold:
// a run produced "the game-changer: focused core activation every session",
// breaking the colon rule AND the "game-changer" cliché ban in one caption.
//
// Times and ratios (6:00, 3:1) are left alone — the colon there is data, not
// punctuation.
const LABEL_PREFIX_RE = /^[^:\n]{1,32}:\s+(?=\S)/;
const PUNCT_COLON_RE = /(?<!\d):(?!\d)\s*/g;

export function stripColons(s: string): string {
  let out = s;
  // "the game-changer: focused core activation" → "focused core activation".
  // The label is nearly always filler restating the slide; the substance is
  // after the colon, so dropping the label loses nothing and reads human.
  const labelled = out.match(LABEL_PREFIX_RE);
  if (labelled && !/\d\s*$/.test(labelled[0])) {
    out = out.slice(labelled[0].length);
  }
  // Any remaining sentence colon becomes the comma a person would have typed;
  // a trailing one just goes.
  out = out
    .replace(/(?<!\d):\s*$/, "")
    .replace(PUNCT_COLON_RE, ", ")
    .replace(/\s+,/g, ",")
    .replace(/,(\s*,)+/g, ",")
    .replace(/,\s*([.!?])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();
  // Dropping a leading label can leave the sentence starting mid-flow; that's
  // fine (captions are lowercase), but never leave dangling punctuation.
  return out.replace(/^[,.;\s]+/, "").trim();
}

// The copy prompts ask for "sentence case", but the model reads that as "all
// lowercase" and writes "this gets results faster than most workout plans".
// Sentence case actually means the first letter of each sentence is capitalised,
// so do it mechanically rather than asking again.
const SENTENCE_START_RE = /(^|[.!?]\s+|\n\s*)([a-z])/g;
const LONE_I_RE = /\b i \b/g;

export function toSentenceCase(s: string): string {
  return s
    .replace(SENTENCE_START_RE, (_m, lead: string, ch: string) => lead + ch.toUpperCase())
    // "i tried it" reads as a typo next to capitalised sentences.
    .replace(LONE_I_RE, " I ")
    .replace(/\bi'(m|ve|ll|d)\b/g, (m) => "I" + m.slice(1));
}

/** Remove the artefacts that make a caption read as machine-written. */
export function cleanCaption(s: string): string {
  return toSentenceCase(stripColons(stripLongDashes(stripEmoji(s))));
}
