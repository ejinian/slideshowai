import { readFileSync } from "node:fs";
import path from "node:path";

// Server-only. Embeds Inter (Latin subset) into composited SVGs as base64
// @font-face data URIs, so the exported PNG renders in the SAME typeface as the
// browser drag overlay (which loads Inter via next/font) — exact-glyph WYSIWYG.
//
// librsvg (bundled with sharp) honors embedded @font-face. The TTFs live in
// assets/fonts and are bundled on Vercel via outputFileTracingIncludes
// (next.config.ts). Do NOT import this from client code (it reads the fs).

// Unique family name so we always use OUR embedded Inter, never a differently
// versioned system "Inter".
export const INTER_FAMILY = "InterEmbed";

const FILES: Record<number, string> = {
  700: "Inter-700.ttf",
  800: "Inter-800.ttf",
};

const cache = new Map<number, string>();

function base64(weight: number): string {
  let b = cache.get(weight);
  if (!b) {
    const file = path.join(process.cwd(), "assets", "fonts", FILES[weight]);
    b = readFileSync(file).toString("base64");
    cache.set(weight, b);
  }
  return b;
}

/** `@font-face` CSS embedding the requested Inter weights as data URIs. */
export function interFontFaceCss(weights: number[]): string {
  return [...new Set(weights)]
    .filter((w) => FILES[w])
    .map(
      (w) =>
        `@font-face{font-family:'${INTER_FAMILY}';font-style:normal;font-weight:${w};` +
        `src:url('data:font/ttf;base64,${base64(w)}') format('truetype');}`,
    )
    .join("");
}
