import sharp from "sharp";
import { Resvg } from "@resvg/resvg-js";
import {
  layoutSlide,
  SLIDE_W,
  SLIDE_H,
  DEFAULT_POS,
  PLATE_PAD_X_FRAC,
  PLATE_RADIUS_FRAC,
  CAPTION_STROKE_FRAC,
  type SlideLayout,
  type SlidePos,
  type SlideRole,
} from "./layout";
import { usesPillHeading } from "./layout";
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
  /** Paint a black plate behind the caption (low-contrast backgrounds). */
  textBg?: boolean;
  /** Optional body paragraph under the heading (short decks only). */
  body?: string | null;
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
    .map((ln, i) => {
      // A blank line is the paragraph gap in a two-part body caption. An EMPTY
      // tspan does not advance the text position — with no glyph to place, the
      // `dy` is effectively dropped and the paragraphs render flush against
      // each other. A non-breaking space gives it something to advance past.
      const content = ln === "" ? "&#160;" : escapeXml(ln);
      return `<tspan x="${x}" dy="${i === 0 ? 0 : lineHeight}">${content}</tspan>`;
    })
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

function textSvg(L: SlideLayout, pill: boolean): string {
  // First-line baseline ≈ 0.8*fontSize below the text box top (matches original).
  const baseline = Math.round(L.textBox.top + L.fontSize * 0.8);
  // Classic TikTok caption: white fill + a black outline painted BEHIND the fill
  // (paint-order:stroke) so the letters keep their weight. The outline is what
  // makes it legible on any background — it replaces the old dark scrim.
  const strokeW = Math.max(2, Math.round(L.fontSize * CAPTION_STROKE_FRAC));
  // On the white pill the text is black and carries NO outline or shadow — a
  // black stroke against a white plate reads as a printing error, and the plate
  // already does all the legibility work the outline exists for.
  const paint = pill
    ? `fill="#000000"`
    : `fill="#ffffff" stroke="#000000" stroke-width="${strokeW}" stroke-linejoin="round" paint-order="stroke" filter="url(#shadow)"`;
  return `<text x="${L.anchorX}" y="${baseline}" text-anchor="${L.textAnchor}" font-family="${CAPTION_FAMILY}" font-weight="${L.fontWeight}" font-size="${L.fontSize}" letter-spacing="${L.letterSpacing}" ${paint}>${tspans(L.lines, L.anchorX, L.lineHeight)}</text>`;
}

// Optional black plate behind the caption, painted for slides whose background
// is too bright for white text (measured in lib/generate/contrast.ts). One rect
// per line, tiled at lineHeight so they merge into a continuous band.
//
// This is drawn UNDER the text and changes nothing about the type: same family,
// same weight, same size, same black stroke. Turning it on can only add pixels
// behind the glyphs.
function plateSvg(L: SlideLayout, light: boolean): string {
  const padX = L.fontSize * PLATE_PAD_X_FRAC;
  const r = Math.round(L.fontSize * PLATE_RADIUS_FRAC);
  // lineBoxes is heading lines THEN body lines. The dark contrast plate wants
  // both (all of it has to stay legible); the white pill is a heading-only
  // device — plating the body too buries it under white and loses the outline
  // that makes it read against the photo.
  const boxes = light ? L.lineBoxes.slice(0, L.lines.length) : L.lineBoxes;
  return boxes
    .map((b) => {
      const x = Math.round(b.left - padX);
      const w = Math.round(b.width + padX * 2);
      // Opaque white for the pill; the translucent black plate is the
      // low-contrast fallback and keeps its original values exactly.
      const fill = light
        ? `fill="#ffffff" fill-opacity="1"`
        : `fill="#000000" fill-opacity="0.82"`;
      return `<rect x="${x}" y="${Math.round(b.top)}" width="${w}" height="${Math.round(b.height)}" rx="${r}" ry="${r}" ${fill}/>`;
    })
    .join("");
}

// Classic TikTok caption: white text with a black outline, no scrim. Numbered
// slides carry their number inline in the text (see layoutSlide).
// The optional body paragraph, under the heading. Same family and same black
// outline, smaller and lighter — the heading stays the loud element.
function bodySvg(L: SlideLayout): string {
  if (L.bodyLines.length === 0) return "";
  const baseline = Math.round(L.bodyBox.top + L.bodyFontSize * 0.8);
  const strokeW = Math.max(2, Math.round(L.bodyFontSize * CAPTION_STROKE_FRAC));
  return `<text x="${L.bodyAnchorX}" y="${baseline}" text-anchor="${L.textAnchor}" font-family="${CAPTION_FAMILY}" font-weight="${L.bodyFontWeight}" font-size="${L.bodyFontSize}" letter-spacing="${L.bodyLetterSpacing}" fill="#ffffff" stroke="#000000" stroke-width="${strokeW}" stroke-linejoin="round" paint-order="stroke" filter="url(#shadow)">${tspans(L.bodyLines, L.bodyAnchorX, L.bodyLineHeight)}</text>`;
}

function buildSvg(L: SlideLayout, textBg: boolean, pill: boolean): string {
  // The pill wins over the contrast plate: it is an explicit style choice, and a
  // white pill already solves the legibility problem the black plate exists for.
  return `<svg width="${SLIDE_W}" height="${SLIDE_H}" xmlns="http://www.w3.org/2000/svg">
  ${defs()}
  ${pill || textBg ? plateSvg(L, pill) : ""}
  ${textSvg(L, pill)}
  ${bodySvg(L)}
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
    body: opts.body ?? null,
  });
  // Derived from the slide itself — see usesPillHeading(). No new option, so
  // every existing call site gets the right look with no change.
  const pill = usesPillHeading(opts.role, opts.number, opts.body, opts.text);
  const svg = buildSvg(layout, opts.textBg ?? false, pill);
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
