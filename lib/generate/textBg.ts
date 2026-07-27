// Whether a slide's caption gets a black plate behind it.
//
// PURE and server-import-free (no sharp, no fs) so it can be bundled into Client
// Components — the HTML editor overlay and the server-side SVG bake must reach
// the same answer from the same inputs, exactly like lib/generate/layout.ts.

export type TextBgMode = "auto" | "on" | "off";

export const TEXT_BG_MODES: TextBgMode[] = ["auto", "on", "off"];

export function isTextBgMode(v: unknown): v is TextBgMode {
  return v === "auto" || v === "on" || v === "off";
}

/**
 * Resolve the deck-level mode against a slide's measured verdict.
 *
 * 'auto' (default) honours the contrast measurement taken at generation time;
 * 'on' and 'off' are the user's manual override for the whole slideshow.
 */
export function resolveTextBg(
  mode: string | null | undefined,
  slideTextBg: boolean | null | undefined,
): boolean {
  if (mode === "on") return true;
  if (mode === "off") return false;
  return slideTextBg === true;
}
