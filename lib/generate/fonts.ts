import path from "node:path";

// Server-only. Provides the caption font TTF paths to the SVG renderer (resvg-js),
// which loads fonts from files explicitly — unlike sharp's bundled librsvg, which
// does NOT apply embedded @font-face on Linux/Vercel (tofu glyphs). The TTFs live
// in assets/fonts and are traced onto Vercel via outputFileTracingIncludes
// (next.config.ts). Do NOT import from client code.
//
// Caption font = Montserrat (free/OFL) — a close match to TikTok's classic caption
// look. The editor overlay (CaptionLayer) uses the same family for WYSIWYG.

export const CAPTION_FAMILY = "Montserrat";

const FILES = ["Montserrat-700.ttf", "Montserrat-800.ttf"];

/** Absolute paths to the caption TTFs, for resvg's `fontFiles`. */
export function captionFontFiles(): string[] {
  return FILES.map((f) => path.join(process.cwd(), "assets", "fonts", f));
}
