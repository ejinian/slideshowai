import sharp from "sharp";
import { Resvg } from "@resvg/resvg-js";
import {
  layoutSlide,
  SLIDE_W,
  SLIDE_H,
  DEFAULT_POS,
  type SlideLayout,
  type SlidePos,
  type SlideRole,
} from "./layout";
import { CAPTION_FAMILY, captionFontFiles } from "./fonts";

// Server-only. Composites a listicle slide onto a 9:16 (1080x1920) background.
// All geometry comes from the shared `layoutSlide()` so the exported PNG matches
// the browser drag editor exactly (see lib/generate/layout.ts).

export { SLIDE_W, SLIDE_H };

export interface CompositeOptions {
  text: string;
  role: SlideRole;
  number: number | null;
  /** Normalized caption position. Defaults reproduce the original bottom-centered look. */
  pos?: SlidePos;
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function tspans(lines: string[], x: number, lineHeight: number): string {
  return lines
    .map(
      (ln, i) =>
        `<tspan x="${x}" dy="${i === 0 ? 0 : lineHeight}">${escapeXml(ln)}</tspan>`,
    )
    .join("");
}

// A soft drop shadow under the outlined caption for a touch of depth. The black
// stroke (see textSvg) does the legibility work, so no scrim is needed.
function defs(): string {
  return `<defs>
  <filter id="shadow" x="-30%" y="-30%" width="160%" height="160%">
    <feDropShadow dx="0" dy="3" stdDeviation="6" flood-color="#000000" flood-opacity="0.45"/>
  </filter>
</defs>`;
}

function textSvg(L: SlideLayout): string {
  // First-line baseline ≈ 0.8*fontSize below the text box top (matches original).
  const baseline = Math.round(L.textBox.top + L.fontSize * 0.8);
  // Classic TikTok caption: white fill + a black outline painted BEHIND the fill
  // (paint-order:stroke) so the letters keep their weight. The outline is what
  // makes it legible on any background — it replaces the old dark scrim.
  const strokeW = Math.max(2, Math.round(L.fontSize * 0.15));
  return `<text x="${L.anchorX}" y="${baseline}" text-anchor="${L.textAnchor}" font-family="${CAPTION_FAMILY}" font-weight="${L.fontWeight}" font-size="${L.fontSize}" letter-spacing="${L.letterSpacing}" fill="#ffffff" stroke="#000000" stroke-width="${strokeW}" stroke-linejoin="round" paint-order="stroke" filter="url(#shadow)">${tspans(L.lines, L.anchorX, L.lineHeight)}</text>`;
}

// Classic TikTok caption: white text with a black outline, no scrim. Numbered
// slides carry their number inline in the text (see layoutSlide).
function buildSvg(L: SlideLayout): string {
  return `<svg width="${SLIDE_W}" height="${SLIDE_H}" xmlns="http://www.w3.org/2000/svg">
  ${defs()}
  ${textSvg(L)}
</svg>`;
}

/** Resize a raw background to the exact 1080x1920 export crop. */
function fitBackground(background: Buffer) {
  return sharp(background).resize(SLIDE_W, SLIDE_H, { fit: "cover", position: "centre" });
}

/**
 * The text-free 1080x1920 background, stored alongside each slide so the drag
 * editor can overlay live HTML text on the SAME crop the export uses.
 */
export async function prepareBackground(background: Buffer): Promise<Buffer> {
  return fitBackground(background).jpeg({ quality: 82 }).toBuffer();
}

export async function compositeSlide(
  background: Buffer,
  opts: CompositeOptions,
): Promise<Buffer> {
  const layout = layoutSlide({
    text: opts.text,
    role: opts.role,
    number: opts.number,
    pos: opts.pos ?? DEFAULT_POS,
  });
  const svg = buildSvg(layout);
  // Rasterize the text/badge overlay with resvg-js using explicit font buffers.
  // sharp's librsvg ignores embedded @font-face fonts on Vercel's Linux runtime,
  // producing tofu glyphs — resvg loads the TTF buffers directly, so it's WYSIWYG
  // on every platform. The overlay is transparent outside the drawn elements.
  const resvg = new Resvg(svg, {
    background: "rgba(0,0,0,0)",
    font: {
      loadSystemFonts: false,
      fontFiles: captionFontFiles(),
      defaultFontFamily: CAPTION_FAMILY,
    },
  });
  const overlay = Buffer.from(resvg.render().asPng());
  return fitBackground(background)
    .composite([{ input: overlay, top: 0, left: 0 }])
    .png()
    .toBuffer();
}
