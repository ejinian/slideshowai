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

// Embedded Inter + radial scrim (follows the text) + drop shadow. The scrim
// gradient uses the default objectBoundingBox units so r=0.5 tracks the
// ellipse's half-extents.
function defs(): string {
  return `<defs>
  <radialGradient id="scrim" cx="0.5" cy="0.5" r="0.5">
    <stop offset="0" stop-color="#000000" stop-opacity="0.72"/>
    <stop offset="0.6" stop-color="#000000" stop-opacity="0.5"/>
    <stop offset="1" stop-color="#000000" stop-opacity="0"/>
  </radialGradient>
  <filter id="shadow" x="-30%" y="-30%" width="160%" height="160%">
    <feDropShadow dx="0" dy="3" stdDeviation="7" flood-color="#000000" flood-opacity="0.6"/>
  </filter>
</defs>`;
}

function textSvg(L: SlideLayout): string {
  // First-line baseline ≈ 0.8*fontSize below the text box top (matches original).
  const baseline = Math.round(L.textBox.top + L.fontSize * 0.8);
  return `<text x="${L.anchorX}" y="${baseline}" text-anchor="${L.textAnchor}" font-family="${CAPTION_FAMILY}" font-weight="${L.fontWeight}" font-size="${L.fontSize}" letter-spacing="${L.letterSpacing}" fill="#ffffff" filter="url(#shadow)">${tspans(L.lines, L.anchorX, L.lineHeight)}</text>`;
}

function buildSvg(L: SlideLayout): string {
  const parts: string[] = [
    `<ellipse cx="${L.scrim.cx}" cy="${L.scrim.cy}" rx="${L.scrim.rx}" ry="${L.scrim.ry}" fill="url(#scrim)"/>`,
  ];

  if (L.rule) {
    parts.push(
      `<rect x="${L.rule.left}" y="${L.rule.top}" width="${L.rule.width}" height="${L.rule.height}" rx="${L.rule.height / 2}" fill="${L.accent}"/>`,
    );
  }
  if (L.pill) {
    parts.push(
      `<rect x="${L.pill.left}" y="${L.pill.top}" width="${L.pill.width}" height="${L.pill.height}" rx="${L.pill.height / 2}" fill="${L.accent}" filter="url(#shadow)"/>`,
    );
  }
  // NOTE: the number badge is deliberately NOT baked — it's a webapp-only editor
  // aid (rendered by CaptionLayer). It must never appear in the posted image, the
  // post viewer, or thumbnails, so it's omitted from the composite here.
  parts.push(textSvg(L));

  return `<svg width="${SLIDE_W}" height="${SLIDE_H}" xmlns="http://www.w3.org/2000/svg">
  ${defs()}
  ${parts.join("\n  ")}
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
