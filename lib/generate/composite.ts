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
import { flatBackdrop, toSlideCanvas, MIN_EDGE } from "@/lib/product/images";

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

// ---------------------------------------------------------------------------
// Product photos (Shopify-link decks)
// ---------------------------------------------------------------------------

/** Caption anchor for a slide whose product sits on the dark lower stage —
 *  the top ~40% of the slide is empty dark canvas, so the text lives there. */
export const PRODUCT_CAPTION_POS: SlidePos = { x: 0.5, y: 0.2, align: "center" };

// Where the white tile sits on the 1080x1920 stage. Everything above TILE_TOP_MIN
// is dark canvas for the caption.
const TILE_SIDE = 90;
const TILE_W = SLIDE_W - TILE_SIDE * 2; // 900
const TILE_BOTTOM = SLIDE_H - 120; // 1800
const TILE_MAX_H = 1000; // → tile top never above y=800
const TILE_RADIUS = 48;

/** Is this flat backdrop light enough that white captions would vanish on it? */
function isLight(c: { r: number; g: number; b: number }): boolean {
  return (0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b) / 255 > 0.8;
}

export interface ProductBackground {
  /** Exact 1080x1920 JPEG — prepareBackground() on it is a no-op crop. */
  buffer: Buffer;
  /** True when the photo was a light studio packshot and got the dark stage. */
  staged: boolean;
}

/**
 * Compose one product photo onto a slide.
 *
 * Shopify galleries are mostly white-background packshots, and a white slide is
 * the one background white captions cannot survive — the contrast plate would
 * fire on every slide and the deck would read as a wall of black bars. So a
 * light packshot (measured at the corners, same test lib/product/images.ts
 * uses) is placed on a DARK canvas: the product keeps its own backdrop inside a
 * rounded tile in the LOWER part of the slide, and the top is left as dark
 * canvas for the caption (see PRODUCT_CAPTION_POS). Keeping the packshot's
 * backdrop inside the tile — rather than cutting the product out — avoids the
 * white fringe and smeared drop-shadows a cut-out gets against black.
 *
 * Lifestyle shots (not a flat light backdrop) take the normal product-photo
 * path: cover-crop when near portrait, blurred fill otherwise.
 */
export async function prepareProductBackground(
  photo: Buffer,
): Promise<ProductBackground | null> {
  const meta = await sharp(photo).metadata();
  const w = meta.width ?? 0;
  const h = meta.height ?? 0;
  if (w < MIN_EDGE || h < MIN_EDGE) return null;

  // Alpha resolves to black on JPEG export, so a transparent packshot would
  // arrive as a silhouette. Flatten onto white first, like the upload path.
  const flat = await sharp(photo).flatten({ background: { r: 255, g: 255, b: 255 } }).toBuffer();
  const backdrop = await flatBackdrop(flat, w, h);

  if (!backdrop || !isLight(backdrop)) {
    const normal = await toSlideCanvas(photo);
    return normal ? { buffer: normal.out, staged: false } : null;
  }

  // Tile keeps the photo's aspect: full tile width, height capped so the top
  // stays clear. A very tall packshot is contained inside the cap instead.
  const tileH = Math.min(TILE_MAX_H, Math.round((TILE_W * h) / w));
  const product = await sharp(flat)
    .resize(TILE_W, tileH, { fit: "contain", background: backdrop })
    .toBuffer();
  const tileTop = TILE_BOTTOM - tileH;

  // Rounded corners: an SVG mask the exact size of the tile.
  const mask = Buffer.from(
    `<svg width="${TILE_W}" height="${tileH}" xmlns="http://www.w3.org/2000/svg"><rect width="${TILE_W}" height="${tileH}" rx="${TILE_RADIUS}" ry="${TILE_RADIUS}" fill="#fff"/></svg>`,
  );
  const tile = await sharp(product)
    .composite([{ input: mask, blend: "dest-in" }])
    .png()
    .toBuffer();

  // Near-black canvas with a faint lift behind the tile so it doesn't float on
  // a void. Pure gradients only — no text, so librsvg is fine here.
  const canvas = Buffer.from(
    `<svg width="${SLIDE_W}" height="${SLIDE_H}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <radialGradient id="g" cx="50%" cy="${((tileTop + tileH / 2) / SLIDE_H) * 100}%" r="70%">
      <stop offset="0" stop-color="#1f1f23"/>
      <stop offset="1" stop-color="#050506"/>
    </radialGradient>
  </defs>
  <rect width="${SLIDE_W}" height="${SLIDE_H}" fill="url(#g)"/>
</svg>`,
  );

  const buffer = await sharp(canvas)
    .composite([{ input: tile, left: TILE_SIDE, top: tileTop }])
    .jpeg({ quality: 86, mozjpeg: true })
    .toBuffer();
  return { buffer, staged: true };
}

// ---------------------------------------------------------------------------
// Website photos (website-link decks)
// ---------------------------------------------------------------------------

// A business site's photos are landscape (a house, a storefront, a plate) and
// mostly too small to cover-crop to 9:16 without a 3x upscale. The plain
// blurred-fill letterbox put the caption ON the photo, over a bright sky. So
// the photo becomes a rounded card on a darkened blur of itself, sitting a
// little below centre, and the caption lives in the dark space above it.
const SITE_CARD_SIDE = 48;
const SITE_CARD_W = SLIDE_W - SITE_CARD_SIDE * 2; // 984
const SITE_CARD_CENTER_Y = 1060;
const SITE_CARD_MAX_H = 1100;
const SITE_CARD_RADIUS = 36;

/**
 * Compose one website photo onto a slide. Near-portrait photos cover-crop like
 * any upload (staged: false). Landscape photos get the card layout (staged:
 * true — the route moves their caption to PRODUCT_CAPTION_POS, the dark top).
 * Light studio packshots (a site selling products) take the product stage.
 */
export async function prepareSiteBackground(
  photo: Buffer,
): Promise<ProductBackground | null> {
  const meta = await sharp(photo).metadata();
  const w = meta.width ?? 0;
  const h = meta.height ?? 0;
  if (w < MIN_EDGE || h < MIN_EDGE) return null;
  if (w / h <= 0.75) {
    const normal = await toSlideCanvas(photo);
    return normal ? { buffer: normal.out, staged: false } : null;
  }
  const flat = await sharp(photo).flatten({ background: { r: 255, g: 255, b: 255 } }).toBuffer();
  const backdrop = await flatBackdrop(flat, w, h);
  if (backdrop && isLight(backdrop)) return prepareProductBackground(photo);

  const cardH = Math.min(SITE_CARD_MAX_H, Math.round((SITE_CARD_W * h) / w));
  const card = await sharp(flat)
    .resize(SITE_CARD_W, cardH, { fit: "cover", position: "centre" })
    .composite([
      {
        input: Buffer.from(
          `<svg width="${SITE_CARD_W}" height="${cardH}" xmlns="http://www.w3.org/2000/svg"><rect width="${SITE_CARD_W}" height="${cardH}" rx="${SITE_CARD_RADIUS}" ry="${SITE_CARD_RADIUS}" fill="#fff"/></svg>`,
        ),
        blend: "dest-in",
      },
    ])
    .png()
    .toBuffer();
  const bg = await sharp(flat)
    .resize(SLIDE_W, SLIDE_H, { fit: "cover", position: "centre" })
    .blur(60)
    .modulate({ brightness: 0.38, saturation: 0.8 })
    .toBuffer();
  const top = Math.max(0, Math.min(SLIDE_H - cardH, Math.round(SITE_CARD_CENTER_Y - cardH / 2)));
  const buffer = await sharp(bg)
    .composite([{ input: card, left: SITE_CARD_SIDE, top }])
    .jpeg({ quality: 86, mozjpeg: true })
    .toBuffer();
  return { buffer, staged: true };
}
