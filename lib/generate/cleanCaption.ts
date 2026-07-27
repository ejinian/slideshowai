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
const LONG_DASH_RE = /\s*(?:--+|[–—―])\s*/g;

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

/** Remove the artefacts that make a caption read as machine-written. */
export function cleanCaption(s: string): string {
  return stripLongDashes(stripEmoji(s));
}
