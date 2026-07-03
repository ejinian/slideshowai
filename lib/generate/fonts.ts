import path from "node:path";

// Server-only. Provides the Inter TTF buffers to the SVG renderer (resvg-js),
// which loads fonts from buffers explicitly — unlike sharp's bundled librsvg,
// which does NOT apply embedded @font-face data URIs on Linux/Vercel (tofu glyphs).
// The TTFs live in assets/fonts and are traced onto Vercel via
// outputFileTracingIncludes (next.config.ts). Do NOT import from client code.

// The family name the SVG references; must match the TTFs' actual family.
export const INTER_FAMILY = "Inter";

const FILES = ["Inter-700.ttf", "Inter-800.ttf"];

/** Absolute paths to the Inter TTFs, for resvg's `fontFiles`. */
export function interFontFiles(): string[] {
  return FILES.map((f) => path.join(process.cwd(), "assets", "fonts", f));
}
