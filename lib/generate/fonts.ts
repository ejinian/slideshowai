import path from "node:path";

// Server-only. Provides the caption font TTF paths to the SVG renderer (resvg-js),
// which loads fonts from files explicitly — unlike sharp's bundled librsvg, which
// does NOT apply embedded @font-face on Linux/Vercel (tofu glyphs). The TTFs live
// in assets/fonts and are traced onto Vercel via outputFileTracingIncludes
// (next.config.ts). Do NOT import from client code.
//
// Caption font = TikTok Sans (TikTok's own display family) — the exact font used
// in TikTok's classic photo captions. The editor overlay (CaptionLayer) uses the
// same family for WYSIWYG. TikTokSans-800.ttf reports family "TikTok Sans
// ExtraBold" in its RIBBI name (nameID 1) but exposes the typographic family
// (nameID 16) "TikTok Sans", so resvg matches font-family "TikTok Sans" +
// font-weight 700/800 to the Bold / ExtraBold files respectively.

export const CAPTION_FAMILY = "TikTok Sans";

const FILES = ["TikTokSans-700.ttf", "TikTokSans-800.ttf"];

/** Absolute paths to the caption TTFs, for resvg's `fontFiles`. */
export function captionFontFiles(): string[] {
  return FILES.map((f) => path.join(process.cwd(), "assets", "fonts", f));
}
