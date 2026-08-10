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
  return (
    s
      .replace(EMOJI_RE, "")
      // Collapse runs of spaces/tabs — including the double space left behind
      // by a removed emoji — but NOT newlines. This was `/\s{2,}/g`, which ate
      // the blank line between the two paragraphs of a heading+body caption and
      // flattened "i blamed my stomach\n\nnow i leave 12 hours" into one run-on
      // sentence. A caption with no newlines is unaffected: with none present
      // this behaves exactly as `\s{2,}` did.
      .replace(/[^\S\r\n]{2,}/g, " ")
      // At most one blank line between paragraphs.
      .replace(/\n{3,}/g, "\n\n")
      // A "blank" line of spaces would render as a non-empty line, so strip
      // trailing whitespace per line rather than only at the ends.
      .replace(/[^\S\r\n]+$/gm, "")
      .trim()
  );
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
      .replace(/[^\S\r\n]{2,}/g, " ")
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
    .replace(/[^\S\r\n]{2,}/g, " ")
    .trim();
  // Dropping a leading label can leave the sentence starting mid-flow; that's
  // fine (captions are lowercase), but never leave dangling punctuation.
  return out.replace(/^[,.;\s]+/, "").trim();
}

// REVERSED 2026-08-07. This used to force sentence case: the model kept writing
// "this gets results faster than most workout plans", that was read as it
// misunderstanding "sentence case", and the capital was applied mechanically.
//
// That was backwards. The model was right and the medium is lowercase — every
// deck in viralExamples.ts is, and so is every caption transcribed off a live
// trending post ("whos ready for fall fits", "happy girl autumn"). Capitalising
// the first letter is the single loudest formality tell in a caption, and it was
// silently undoing the voice the prompts spend thirty lines asking for: the
// prompt's own model answer, "i ate 180g of protein a day for 8 weeks", came out
// the other side as "I ate 180g…".
//
// So the capital is stripped instead, mechanically, for the same reason it was
// once added: asking the model is not reliable on its own.
//
// ONLY the first letter of a sentence, and never when it starts a run of
// capitals — "PSA stop doing this" and "UK gyms are different" keep their
// acronyms rather than becoming "pSA" / "uK". Mid-sentence capitals are left
// alone entirely, so proper nouns inside a line are untouched.
const SENTENCE_START_CAP_RE = /(^|[.!?]\s+|\n\s*)([A-Z])(?![A-Z])/g;

export function toCasualCase(s: string): string {
  return s.replace(
    SENTENCE_START_CAP_RE,
    (_m, lead: string, ch: string) => lead + ch.toLowerCase(),
  );
}

// A single-sentence caption almost never ends in a full stop on TikTok — real
// posts read "i ain't dying", "pov: you and dad decided to lock tf in", "Every
// family needs their mentally unstable son that rots in the gym". The trailing
// period is the formal choice, and formal reads as written-by-a-machine.
//
// ONLY the terminal period, and ONLY when the caption is a single sentence: a
// caption with internal punctuation ("Never skip cardio. If you do, walk 10k
// steps") keeps its full stops, and "?" / "!" are never touched. Decimals and
// abbreviations are safe because the match is anchored to the very end.
const SINGLE_SENTENCE_TERMINAL_PERIOD = /^([^.!?]+)\.\s*$/;

export function stripTerminalPeriod(s: string): string {
  const m = s.match(SINGLE_SENTENCE_TERMINAL_PERIOD);
  // Don't strip when the "sentence" ends in a number (a stat like "…hit 10k.")
  // reads fine, but "3.5" style decimals never reach here anyway.
  return m ? m[1].trimEnd() : s;
}

/** Remove the artefacts that make a caption read as machine-written. */
export function cleanCaption(s: string): string {
  return stripTerminalPeriod(
    toCasualCase(stripColons(stripLongDashes(stripEmoji(s)))),
  );
}
