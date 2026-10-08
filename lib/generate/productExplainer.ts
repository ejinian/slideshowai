import sharp from "sharp";
import { Resvg } from "@resvg/resvg-js";
import { tryCopyModel } from "./copyModel";
import { stripEmoji } from "./cleanCaption";
import { designFontFiles, DISPLAY_FAMILY, MONO_FAMILY } from "./fonts";
import { SLIDE_W, SLIDE_H } from "./layout";
import type { RunLogger } from "./diagnostics";
import { backdropTheme, logBackdrop, startBackdrop } from "./higgsfield";
import type { ListicleSlide } from "./listicle";
import {
  formatPrice,
  productFacts,
  productShortName,
  type ShopifyProduct,
  type ShopifyStore,
} from "./shopify";

// PRODUCT EXPLAINER — the designed carousel a Shopify link produces.
//
// Not a caption over a photo. Each slide is a DESIGNED card on a dark canvas
// tinted from the product's own colour: a condensed uppercase headline with
// one accent word, small monospaced detail text, fact cards, the product cut
// out of its packshot and dropped onto the canvas with a soft shadow, a price
// slide built from the store's real variants, and a closing "want the link?"
// slide. Modelled on the reference deck Christian handed over (2026-10-07):
// "THE ZYN SWAP WITH ZERO NICOTINE" / "MEET LOOSEY GOOSEY" / "WHAT'S IN THE
// CAN" / "WHAT IT COSTS" / "WANT THE LINK?".
//
// Everything on these slides is baked into the BACKGROUND image. The live
// caption on each slide is empty, exactly like showcase's silent slides — the
// design IS the text, and the editor's TikTok-caption overlay could not draw
// it. That is a deliberate exception to "text is never baked" and the reason
// the deck is regenerable rather than editable. Prices come from the store's
// variants, never from the model.

export interface ExplainerDeck {
  /** One rendered 1080x1920 JPEG per slide — the slide backgrounds. */
  backgrounds: Buffer[];
  /** Silent slides (text "") with roles the rest of the pipeline expects. */
  slides: ListicleSlide[];
  /** The hook headline, for the slideshow title. */
  title: string;
  /** Every slide's readable text, for the post-description fallback. */
  lines: string[];
  theme: Theme;
  model: string;
  kinds: SlideKind[];
}

export type SlideKind = "hook" | "idea" | "grid" | "price" | "cta";

interface RawSlide {
  kind: SlideKind;
  headline: string;
  accent: string;
  sub: string;
  bullets: { lead: string; rest: string }[];
  cards: { title: string; meta: string; body: string }[];
  pill: string;
  footnote: string;
}

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["slides"],
  properties: {
    slides: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["kind", "headline", "accent", "sub", "bullets", "cards", "pill", "footnote"],
        properties: {
          kind: { type: "string", enum: ["hook", "idea", "grid", "price", "cta"] },
          headline: { type: "string" },
          accent: { type: "string" },
          sub: { type: "string" },
          bullets: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["lead", "rest"],
              properties: { lead: { type: "string" }, rest: { type: "string" } },
            },
          },
          cards: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["title", "meta", "body"],
              properties: {
                title: { type: "string" },
                meta: { type: "string" },
                body: { type: "string" },
              },
            },
          },
          pill: { type: "string" },
          footnote: { type: "string" },
        },
      },
    },
  },
} as const;

// Which slide kinds a deck of N slides gets. Hook first, price second to
// last, CTA last; the middle is idea + fact grids. Fixed here so the model
// fills a known structure instead of inventing one.
export function planKinds(count: number): SlideKind[] {
  const n = Math.min(Math.max(count, 3), 10);
  if (n === 3) return ["hook", "grid", "cta"];
  if (n === 4) return ["hook", "idea", "price", "cta"];
  const middle: SlideKind[] = ["idea", "grid"];
  while (middle.length < n - 3) middle.push(middle.length % 2 === 0 ? "idea" : "grid");
  return ["hook", ...middle, "price", "cta"];
}

const SYSTEM =
  "You write the text for a designed product-explainer carousel: dark slides, a " +
  "big condensed UPPERCASE headline with one accent word, small monospaced detail " +
  "text, fact cards. The register is a person who found a product and is laying " +
  "out what it is, plainly — curious, a little dry, never an ad voice. Lowercase " +
  "for all detail text; the headline is rendered uppercase automatically, so write " +
  "it in normal case.\n" +
  "HARD RULES:\n" +
  "• FACTS ONLY. Every claim comes from the PRODUCT FACTS given. Never invent " +
  "ingredients, specs, origins, awards, review counts, ratings, discounts, " +
  "shipping terms or guarantees. If a slide needs a fact that is not given, say " +
  "less — a shorter card beats an invented one. Prices are added by the system; " +
  "never write a price or a percentage yourself.\n" +
  "• HEADLINES: 2-5 words, no punctuation except a question mark on the CTA, " +
  "and `accent` is ONE word (or two adjacent words) copied exactly from the " +
  "headline — the part that gets the colour.\n" +
  "• NO emoji, no arrows, no special symbols — plain ASCII letters, digits, " +
  "commas, periods, apostrophes, parentheses, hyphens and the dot separator " +
  "' · ' only.\n" +
  "• The HOOK headline never names the brand. It names the category, the swap, " +
  "the problem or the surprising fact. The brand appears from slide 2 on.\n" +
  "• Per slide kind:\n" +
  "  hook  — headline + `sub`: one casual line, 6-12 words, how the creator came " +
  "across it (e.g. 'found this on a random shopify store. swipe').\n" +
  "  idea  — headline like 'meet <brand>' + `sub` ('here's the idea') + 3-4 " +
  "`bullets`, each {lead: 2-4 words, the fact} {rest: up to 8 words, plain " +
  "context}. Bullets state what it is, how it's used, what's in it.\n" +
  "  grid  — headline + EXACTLY 4 `cards` {title: 1-3 words} {meta: 2-5 words of " +
  "detail, e.g. 'root · vanuatu' or '200 mg blend'} {body: 2-5 words, what it " +
  "does or who it's for}. Optional `footnote` (one plain sentence, e.g. a " +
  "brand-claims caveat) when the facts are the brand's claims.\n" +
  "  price — headline (e.g. 'what it costs') + `sub`: one factual line about " +
  "buying it (leave \"\" if the facts give nothing beyond the price).\n" +
  "  cta   — headline (e.g. 'want the link?') + `pill`: 3-7 words telling people " +
  "how to get it ('comment <WORD> and i'll dm it' or 'link in bio') + `sub`: " +
  "one short line, e.g. the store's domain or 'ships from the store'.\n" +
  "Fields a kind does not use must be \"\" or [].";

export function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** ASCII-only, emoji-free, single-spaced. The design fonts cover little else. */
export function plain(s: string, max = 200): string {
  return stripEmoji(s ?? "")
    .replace(/[→←↑↓➜➔]/g, "")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[—–]/g, "-")
    .replace(/[^\x20-\x7E·]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

// ---------------------------------------------------------------------------
// Theme — from the product's own colour
// ---------------------------------------------------------------------------

export interface Theme {
  bg1: string;
  bg2: string;
  accent: string;
  text: string;
  muted: string;
  card: string;
  stroke: string;
  hue: number;
}

function hsl(h: number, s: number, l: number): string {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let [r, g, b] = [0, 0, 0];
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const to = (v: number) => Math.round((v + m) * 255).toString(16).padStart(2, "0");
  return `#${to(r)}${to(g)}${to(b)}`;
}

function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
  const R = r / 255, G = g / 255, B = b / 255;
  const max = Math.max(R, G, B), min = Math.min(R, G, B);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l };
  const s = d / (1 - Math.abs(2 * l - 1));
  let h = 0;
  if (max === R) h = ((G - B) / d) % 6;
  else if (max === G) h = (B - R) / d + 2;
  else h = (R - G) / d + 4;
  h = Math.round(h * 60);
  if (h < 0) h += 360;
  return { h, s, l };
}

/**
 * Tint the canvas from the product. sharp's dominant colour of the hero
 * photo sets the hue; a washed-out product (white/cream/grey packaging) falls
 * back to the reference deck's deep green + lime.
 */
export async function themeFrom(hero: Buffer | null): Promise<Theme> {
  let hue = 120;
  try {
    if (hero) {
      const { dominant } = await sharp(hero).stats();
      const { h, s, l } = rgbToHsl(dominant.r, dominant.g, dominant.b);
      if (s >= 0.22 && l > 0.12 && l < 0.9) hue = h;
    }
  } catch {
    /* keep the default */
  }
  return {
    hue,
    bg1: hsl(hue, 0.3, 0.11),
    bg2: hsl(hue, 0.45, 0.045),
    accent: hsl(hue, 0.85, 0.7),
    text: "#f4f6f1",
    muted: "rgba(236,242,230,0.62)",
    card: "rgba(255,255,255,0.045)",
    stroke: hsl(hue, 0.5, 0.42),
  };
}

// ---------------------------------------------------------------------------
// Product cut-out
// ---------------------------------------------------------------------------

export interface Cutout {
  /** RGBA PNG, trimmed to the product. */
  png: Buffer;
  width: number;
  height: number;
}

/**
 * Lift the product off a flat light packshot. A flood fill from the border
 * marks everything connected to the edge that is near the backdrop colour;
 * alpha fades with distance from that colour, so the packshot's own soft
 * shadow survives as a translucent darkening instead of a grey smear, and
 * light areas INSIDE the product (a white label) stay opaque because they are
 * not connected to the border. Returns null for anything that is not a flat
 * light backdrop — lifestyle shots are placed as rounded photo cards instead.
 */
export async function cutoutProduct(photo: Buffer): Promise<Cutout | null> {
  const base = sharp(photo).flatten({ background: { r: 255, g: 255, b: 255 } });
  const meta = await base.metadata();
  if (!meta.width || !meta.height) return null;
  // Work at a bounded size — the slide never shows the product above ~900px.
  const scale = Math.min(1, 1100 / Math.max(meta.width, meta.height));
  const { data, info } = await base
    .resize(Math.round(meta.width * scale), Math.round(meta.height * scale))
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const w = info.width, h = info.height, ch = info.channels;

  // Backdrop colour = mean of the four corner patches; must be light and flat.
  const patch = Math.max(4, Math.floor(Math.min(w, h) * 0.03));
  const corners = [[0, 0], [w - patch, 0], [0, h - patch], [w - patch, h - patch]];
  let sr = 0, sg = 0, sb = 0, n = 0;
  const means: number[][] = [];
  for (const [cx, cy] of corners) {
    let r = 0, g = 0, b = 0, k = 0;
    for (let y = cy; y < cy + patch; y++)
      for (let x = cx; x < cx + patch; x++) {
        const i = (y * w + x) * ch;
        r += data[i]; g += data[i + 1]; b += data[i + 2]; k++;
      }
    means.push([r / k, g / k, b / k]);
    sr += r; sg += g; sb += b; n += k;
  }
  const bg = [sr / n, sg / n, sb / n];
  const lum = (0.2126 * bg[0] + 0.7152 * bg[1] + 0.0722 * bg[2]) / 255;
  const spread = Math.max(...[0, 1, 2].map((c) => Math.max(...means.map((m) => m[c])) - Math.min(...means.map((m) => m[c]))));
  if (lum < 0.8 || spread > 18) return null;

  const diffAt = (i: number) =>
    (Math.abs(data[i] - bg[0]) + Math.abs(data[i + 1] - bg[1]) + Math.abs(data[i + 2] - bg[2])) / 3;
  // Neutral = grey-ish: the packshot's own shadow is darker but colourless,
  // while a cream or pastel label has colour. That is what keeps the fade out
  // of the product: the first version faded by distance-from-white alone and
  // washed a cream label into the canvas.
  const neutralAt = (i: number) => {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    return Math.max(r, g, b) - Math.min(r, g, b) <= 14;
  };
  const TIGHT = 16; // genuinely the backdrop
  const LOOSE = 78; // shadow territory, only when neutral and adjacent to backdrop
  const visited = new Uint8Array(w * h);
  const alpha = new Uint8Array(w * h).fill(255);
  const stack: number[] = [];
  const push = (x: number, y: number) => {
    const p = y * w + x;
    if (visited[p]) return;
    visited[p] = 1;
    stack.push(p);
  };
  for (let x = 0; x < w; x++) { push(x, 0); push(x, h - 1); }
  for (let y = 0; y < h; y++) { push(0, y); push(w - 1, y); }
  const shadowSeeds: number[] = [];
  while (stack.length) {
    const p = stack.pop() as number;
    const d = diffAt(p * ch);
    if (d > TIGHT) {
      // Edge of the backdrop. Remember it so the shadow pass can grow from
      // here, but do not cross into the object.
      if (d <= LOOSE && neutralAt(p * ch)) shadowSeeds.push(p);
      visited[p] = 0;
      continue;
    }
    alpha[p] = 0;
    const x = p % w, y = (p / w) | 0;
    if (x > 0) push(x - 1, y);
    if (x < w - 1) push(x + 1, y);
    if (y > 0) push(x, y - 1);
    if (y < h - 1) push(x, y + 1);
  }
  // Shadow pass: grey pixels contiguous with the backdrop fade with how far
  // they are from its colour, bounded in depth so nothing creeps far inside.
  const depth = new Uint16Array(w * h);
  const MAX_DEPTH = 90;
  for (const p of shadowSeeds) { if (!visited[p]) { visited[p] = 1; depth[p] = 1; stack.push(p); } }
  while (stack.length) {
    const p = stack.pop() as number;
    const d = diffAt(p * ch);
    alpha[p] = Math.max(0, Math.min(255, Math.round(((d - 6) / 60) * 255)));
    if (depth[p] >= MAX_DEPTH) continue;
    const x = p % w, y = (p / w) | 0;
    const tryPush = (nx: number, ny: number) => {
      const q = ny * w + nx;
      if (visited[q]) return;
      const dq = diffAt(q * ch);
      if (dq > LOOSE || !neutralAt(q * ch)) return;
      visited[q] = 1;
      depth[q] = depth[p] + 1;
      stack.push(q);
    };
    if (x > 0) tryPush(x - 1, y);
    if (x < w - 1) tryPush(x + 1, y);
    if (y > 0) tryPush(x, y - 1);
    if (y < h - 1) tryPush(x, y + 1);
  }
  // One-pixel anti-alias on the hard edge: average alpha with 4-neighbours
  // where it steps from 0 to 255.
  const soft = new Uint8Array(alpha);
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++) {
      const p = y * w + x;
      const a = alpha[p];
      if (a === 0 || a === 255) {
        const nb = alpha[p - 1] + alpha[p + 1] + alpha[p - w] + alpha[p + w];
        if ((a === 255 && nb < 1020) || (a === 0 && nb > 0)) soft[p] = Math.round((a * 2 + nb / 4 * 2) / 4);
      }
    }
  alpha.set(soft);

  // Bounding box of what is left (alpha > 24), plus a little breathing room.
  let minX = w, minY = h, maxX = -1, maxY = -1;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const p = y * w + x;
      data[p * ch + 3] = alpha[p];
      if (alpha[p] > 24) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  if (maxX < 0 || maxX - minX < w * 0.15 || maxY - minY < h * 0.15) return null;
  // The product has to be a real object, not the whole frame (then nothing was
  // actually cut out and it was never a packshot).
  if ((maxX - minX) * (maxY - minY) > w * h * 0.97) return null;

  const pad = 6;
  const left = Math.max(0, minX - pad), top = Math.max(0, minY - pad);
  const width = Math.min(w - left, maxX - minX + 1 + pad * 2);
  const height = Math.min(h - top, maxY - minY + 1 + pad * 2);
  const png = await sharp(data, { raw: { width: w, height: h, channels: 4 } })
    .extract({ left, top, width, height })
    .png()
    .toBuffer();
  return { png, width, height };
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

export const PAD = 72;
export const CONTENT_W = SLIDE_W - PAD * 2; // 936
export const TOP = 230;
const FOOTER_Y = 1708;
export const ART_BOTTOM = 1600;
const MONO_ADV = 0.6125; // Space Mono advance, em

let fontFilesCache: string[] | null = null;
export function fonts(): string[] {
  return (fontFilesCache ??= designFontFiles());
}

/** Exact text width via resvg's bbox (fonts are the bundled files). */
export function measure(text: string, family: string, size: number, weight: "normal" | "bold" = "normal"): number {
  if (!text) return 0;
  if (family === MONO_FAMILY) return text.length * size * MONO_ADV;
  try {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="6000" height="600"><text x="0" y="400" font-family="${family}" font-weight="${weight}" font-size="${size}">${esc(text)}</text></svg>`;
    const r = new Resvg(svg, { font: { loadSystemFonts: false, fontFiles: fonts(), defaultFontFamily: family } });
    const b = r.getBBox();
    if (b && b.width > 0) return b.width;
  } catch {
    /* fall through */
  }
  return text.length * size * 0.5;
}

export function wrap(text: string, family: string, size: number, maxW: number, weight: "normal" | "bold" = "normal"): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (cur && measure(next, family, size, weight) > maxW) {
      lines.push(cur);
      cur = w;
    } else cur = next;
  }
  if (cur) lines.push(cur);
  return lines;
}

export interface Ctx {
  theme: Theme;
  svg: string[];
  /** Raster layers composited over the SVG (cut-outs, photo cards). */
  layers: { input: Buffer; left: number; top: number }[];
  /** Optional 1080x1920 art behind the whole slide (the Higgsfield
   *  experiment, lib/generate/higgsfield.ts). The theme gradient becomes a
   *  translucent veil over it so the type keeps its contrast. */
  backdrop?: Buffer | null;
}

export function monoText(ctx: Ctx, x: number, y: number, text: string, size: number, fill: string, weight: "normal" | "bold" = "normal", anchor = "start"): void {
  if (!text) return;
  ctx.svg.push(
    `<text x="${x}" y="${y}" text-anchor="${anchor}" font-family="${MONO_FAMILY}" font-weight="${weight}" font-size="${size}" fill="${fill}">${esc(text)}</text>`,
  );
}

/** Headline block. Returns the y just below it. */
export function headline(ctx: Ctx, text: string, accent: string, y: number, maxLines = 3): number {
  const words = plain(text).toUpperCase().split(/\s+/).filter(Boolean);
  const accentWords = new Set(plain(accent).toUpperCase().split(/\s+/).filter(Boolean));
  const upper = words.join(" ");
  let size = 138;
  let lines = wrap(upper, DISPLAY_FAMILY, size, CONTENT_W);
  while (lines.length > maxLines && size > 84) {
    size -= 10;
    lines = wrap(upper, DISPLAY_FAMILY, size, CONTENT_W);
  }
  const lineH = Math.round(size * 0.98);
  let yy = y + Math.round(size * 0.86);
  const spaceW = measure("N N", DISPLAY_FAMILY, size) - measure("NN", DISPLAY_FAMILY, size);
  for (const ln of lines) {
    let x = PAD;
    const parts = ln.split(" ");
    const spans = parts.map((w, i) => {
      const fill = accentWords.has(w) ? ctx.theme.accent : ctx.theme.text;
      const s = `<tspan x="${Math.round(x)}" fill="${fill}">${esc(w)}</tspan>`;
      x += measure(w, DISPLAY_FAMILY, size) + (i < parts.length - 1 ? spaceW : 0);
      return s;
    });
    ctx.svg.push(
      `<text y="${yy}" font-family="${DISPLAY_FAMILY}" font-size="${size}" letter-spacing="1">${spans.join("")}</text>`,
    );
    yy += lineH;
  }
  return yy - lineH + Math.round(size * 0.3);
}

export function roundedRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number, fill: string, stroke?: string, strokeW = 2): void {
  ctx.svg.push(
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" ry="${r}" fill="${fill}"${stroke ? ` stroke="${stroke}" stroke-width="${strokeW}" stroke-opacity="0.55"` : ""}/>`,
  );
}

export function footer(ctx: Ctx, index: number, total: number): void {
  const r = 6, gap = 22;
  const width = total * r * 2 + (total - 1) * gap;
  let x = Math.round((SLIDE_W - width) / 2) + r;
  for (let i = 0; i < total; i++) {
    ctx.svg.push(
      `<circle cx="${x}" cy="${FOOTER_Y}" r="${r}" fill="${i === index ? ctx.theme.accent : "rgba(255,255,255,0.22)"}"/>`,
    );
    x += r * 2 + gap;
  }
  monoText(ctx, SLIDE_W - PAD, FOOTER_Y + 9, "save for later", 24, ctx.theme.muted, "normal", "end");
}

/** Place the cut-out (with shadow) inside a box, bottom-anchored. */
export async function placeArt(
  ctx: Ctx,
  art: { cutout: Cutout | null; photo: Buffer | null },
  box: { cx: number; bottom: number; maxW: number; maxH: number; native?: boolean },
): Promise<void> {
  if (box.maxH < 200) return;
  if (art.cutout) {
    const s = Math.min(box.maxW / art.cutout.width, box.maxH / art.cutout.height);
    const w = Math.max(1, Math.round(art.cutout.width * s));
    const h = Math.max(1, Math.round(art.cutout.height * s));
    const left = Math.round(box.cx - w / 2);
    const top = box.bottom - h;
    const resized = await sharp(art.cutout.png).resize(w, h).png().toBuffer();
    // Soft shadow: the silhouette, black, blurred, at ~55% — spread a little
    // past the product so a blurred edge never gets clipped.
    const spread = 60;
    const sil = await sharp(resized)
      .extend({ top: spread, bottom: spread, left: spread, right: spread, background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .raw()
      .toBuffer({ resolveWithObject: true });
    const px = sil.data;
    for (let i = 0; i < px.length; i += 4) {
      px[i] = 0; px[i + 1] = 0; px[i + 2] = 0;
      px[i + 3] = Math.round(px[i + 3] * 0.55);
    }
    const shadow = await sharp(px, { raw: { width: sil.info.width, height: sil.info.height, channels: 4 } })
      .blur(26)
      .png()
      .toBuffer();
    ctx.layers.push({ input: shadow, left: left - spread, top: top - spread + 26 });
    ctx.layers.push({ input: resized, left, top });
    return;
  }
  if (art.photo) {
    // Lifestyle shot: a rounded photo card instead of a cut-out.
    // `native`: keep the photo's own shape (a landscape house stays
    // landscape) instead of the product deck's near-square crop.
    const w = Math.min(box.maxW, CONTENT_W);
    let h = Math.min(box.maxH, Math.round(w * 1.1));
    if (box.native) {
      const m = await sharp(art.photo).metadata();
      if (m.width && m.height) h = Math.min(box.maxH, Math.round((w * m.height) / m.width));
    }
    const left = Math.round(box.cx - w / 2);
    const top = box.bottom - h;
    const mask = Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="${w}" height="${h}" rx="40" ry="40" fill="#fff"/></svg>`,
    );
    const card = await sharp(art.photo)
      .resize(w, h, { fit: "cover", position: "attention" })
      .composite([{ input: mask, blend: "dest-in" }])
      .png()
      .toBuffer();
    ctx.layers.push({ input: card, left, top });
  }
}

interface PriceCard {
  title: string;
  price: string;
  per: string;
  was: string | null;
}

/** Price cards from the store's variants — never from the model. */
export function priceCards(p: ShopifyProduct): PriceCard[] {
  const vs = p.variants.filter((v) => v.price != null);
  if (vs.length === 0) {
    const price = formatPrice(p.price, p.currency);
    return price ? [{ title: "the price", price, per: "", was: formatPrice(p.compareAtPrice, p.currency) }] : [];
  }
  const sorted = [...vs].sort((a, b) => (a.price ?? 0) - (b.price ?? 0));
  const distinct = sorted.filter((v, i) => i === 0 || v.price !== sorted[i - 1].price);
  const picks = distinct.length <= 2 ? distinct : [distinct[0], distinct[distinct.length - 1]];
  const generic = (t: string) => !t || /^default title$/i.test(t);
  return picks.map((v, i) => ({
    title: generic(v.title) ? (picks.length > 1 ? (i === 0 ? "try once" : "the bundle") : "try once") : plain(v.title, 22).toLowerCase(),
    price: formatPrice(v.price, p.currency) ?? "",
    per: generic(v.title) ? "" : "",
    was: v.compareAtPrice != null && v.price != null && v.compareAtPrice > v.price ? formatPrice(v.compareAtPrice, p.currency) : null,
  }));
}

async function renderSlide(
  slide: RawSlide,
  index: number,
  total: number,
  theme: Theme,
  art: { cutout: Cutout | null; photo: Buffer | null },
  product: ShopifyProduct,
  backdrop: Buffer | null = null,
): Promise<Buffer> {
  const ctx: Ctx = { theme, svg: [], layers: [], backdrop };
  const sub = plain(slide.sub, 90).toLowerCase();

  switch (slide.kind) {
    case "hook": {
      let y = headline(ctx, slide.headline, slide.accent, TOP, 3);
      if (sub) {
        y += 36;
        const subLines = wrap(sub, MONO_FAMILY, 30, CONTENT_W).slice(0, 2);
        subLines.forEach((ln, li) => monoText(ctx, PAD, y + li * 42, ln, 30, theme.muted));
        y += (subLines.length - 1) * 42;
      }
      await placeArt(ctx, art, { cx: SLIDE_W / 2, bottom: ART_BOTTOM, maxW: 880, maxH: Math.min(900, ART_BOTTOM - y - 90) });
      break;
    }
    case "idea": {
      let y = headline(ctx, slide.headline, slide.accent, TOP, 2);
      if (sub) {
        y += 34;
        monoText(ctx, PAD, y, sub, 30, theme.muted);
      }
      y += 48;
      const bullets = slide.bullets.slice(0, 4).map((b) => ({ lead: plain(b.lead, 40).toLowerCase(), rest: plain(b.rest, 80).toLowerCase() }));
      const inner = CONTENT_W - 80;
      const size = 32, lh = 46;
      const rows: { spans: string[]; }[] = [];
      let cardH = 40;
      for (const b of bullets) {
        const text = b.rest ? `${b.lead} · ${b.rest}` : b.lead;
        const lines = wrap(text, MONO_FAMILY, size, inner);
        cardH += lines.length * lh + 24;
        rows.push({ spans: lines });
      }
      cardH += 16;
      roundedRect(ctx, PAD, y, CONTENT_W, cardH, 28, theme.card, theme.stroke);
      let ty = y + 40 + Math.round(size * 0.8);
      for (const [bi, row] of rows.entries()) {
        const lead = bullets[bi].lead;
        for (const [li, ln] of row.spans.entries()) {
          // Colour the lead words on the first line of each bullet.
          if (li === 0 && lead && ln.toLowerCase().startsWith(lead)) {
            const rest = ln.slice(lead.length);
            ctx.svg.push(
              `<text x="${PAD + 40}" y="${ty}" font-family="${MONO_FAMILY}" font-size="${size}"><tspan font-weight="bold" fill="${theme.accent}">${esc(lead)}</tspan><tspan fill="${theme.muted}">${esc(rest)}</tspan></text>`,
            );
          } else monoText(ctx, PAD + 40, ty, ln, size, theme.muted);
          ty += lh;
        }
        ty += 24;
      }
      const artTop = y + cardH + 60;
      await placeArt(ctx, art, { cx: SLIDE_W - PAD - 300, bottom: ART_BOTTOM, maxW: 600, maxH: ART_BOTTOM - artTop });
      break;
    }
    case "grid": {
      let y = headline(ctx, slide.headline, slide.accent, TOP, 2);
      y += 56;
      const cards = slide.cards.slice(0, 4);
      while (cards.length < 4 && cards.length > 0) cards.push(cards[cards.length - 1]);
      const gap = 24, cw = (CONTENT_W - gap) / 2, chh = 340;
      cards.forEach((c, i) => {
        const cx = PAD + (i % 2) * (cw + gap);
        const cy = y + Math.floor(i / 2) * (chh + gap);
        roundedRect(ctx, cx, cy, cw, chh, 24, theme.card, theme.stroke);
        const title = plain(c.title, 24).toUpperCase();
        let ts = 54;
        while (measure(title, DISPLAY_FAMILY, ts) > cw - 64 && ts > 34) ts -= 4;
        ctx.svg.push(
          `<text x="${cx + 32}" y="${cy + 32 + Math.round(ts * 0.86)}" font-family="${DISPLAY_FAMILY}" font-size="${ts}" fill="${theme.accent}">${esc(title)}</text>`,
        );
        const meta = plain(c.meta, 40).toLowerCase();
        const metaLines = wrap(meta, MONO_FAMILY, 24, cw - 64).slice(0, 2);
        metaLines.forEach((ln, li) => monoText(ctx, cx + 32, cy + 32 + ts + 30 + li * 32, ln, 24, theme.muted));
        const body = plain(c.body, 60).toLowerCase();
        const bodyLines = wrap(body, MONO_FAMILY, 30, cw - 64).slice(0, 2);
        const by = cy + chh - 40 - (bodyLines.length - 1) * 40;
        bodyLines.forEach((ln, li) => monoText(ctx, cx + 32, by + li * 40, ln, 30, theme.text));
      });
      const note = plain(slide.footnote, 160).toLowerCase();
      if (note) {
        const ny = y + 2 * chh + gap + 48;
        wrap(`*${note}`, MONO_FAMILY, 22, CONTENT_W).slice(0, 2).forEach((ln, li) => monoText(ctx, PAD, ny + li * 30, ln, 22, theme.muted));
      }
      break;
    }
    case "price": {
      let y = headline(ctx, slide.headline, slide.accent, TOP, 2);
      y += 56;
      const cards = priceCards(product);
      const gap = 24;
      const n = Math.max(1, Math.min(2, cards.length));
      const cw = n === 1 ? 600 : (CONTENT_W - gap) / 2;
      const chh = 380;
      const x0 = n === 1 ? Math.round((SLIDE_W - cw) / 2) : PAD;
      cards.slice(0, 2).forEach((c, i) => {
        const cx = x0 + i * (cw + gap);
        roundedRect(ctx, cx, y, cw, chh, 28, theme.card, theme.stroke);
        const title = c.title.toUpperCase();
        let ts = 52;
        while (measure(title, DISPLAY_FAMILY, ts) > cw - 64 && ts > 30) ts -= 4;
        ctx.svg.push(
          `<text x="${cx + cw / 2}" y="${y + 44 + Math.round(ts * 0.86)}" text-anchor="middle" font-family="${DISPLAY_FAMILY}" font-size="${ts}" fill="${theme.text}">${esc(title)}</text>`,
        );
        let ps = 150;
        while (measure(c.price, DISPLAY_FAMILY, ps) > cw - 72 && ps > 70) ps -= 8;
        const py = y + 44 + ts + 40 + Math.round(ps * 0.86);
        ctx.svg.push(
          `<text x="${cx + cw / 2}" y="${py}" text-anchor="middle" font-family="${DISPLAY_FAMILY}" font-size="${ps}" fill="${theme.accent}">${esc(c.price)}</text>`,
        );
        const detail = c.was ? `was ${c.was}` : c.per;
        if (detail) monoText(ctx, cx + cw / 2, py + 56, detail, 26, theme.muted, "normal", "middle");
        if (product.available === false) monoText(ctx, cx + cw / 2, py + 96, "sold out right now", 24, theme.muted, "normal", "middle");
      });
      let y2 = y + chh + 44;
      if (cards.length === 0) {
        monoText(ctx, PAD, y + 40, "price on the store", 30, theme.muted);
        y2 = y + 100;
      }
      if (sub) {
        const w = Math.min(CONTENT_W, measure(sub, MONO_FAMILY, 26) + 64);
        roundedRect(ctx, Math.round((SLIDE_W - w) / 2), y2, Math.round(w), 60, 30, "transparent", theme.stroke);
        monoText(ctx, SLIDE_W / 2, y2 + 39, sub, 26, theme.text, "normal", "middle");
        y2 += 60;
      }
      await placeArt(ctx, art, { cx: SLIDE_W / 2, bottom: ART_BOTTOM, maxW: 700, maxH: ART_BOTTOM - y2 - 50 });
      break;
    }
    case "cta": {
      let y = headline(ctx, slide.headline, slide.accent, TOP, 2);
      y += 44;
      const pill = plain(slide.pill, 60).toLowerCase() || `${productShortName(product)}, link in bio`;
      let ps = 32;
      while (measure(pill, MONO_FAMILY, ps, "bold") > CONTENT_W - 48 && ps > 22) ps -= 2;
      const pw = Math.round(measure(pill, MONO_FAMILY, ps, "bold") + 56);
      roundedRect(ctx, PAD, y, pw, 70, 35, theme.accent);
      monoText(ctx, PAD + 28, y + 46, pill, ps, "#0b0f0a", "bold");
      y += 70;
      if (sub) {
        y += 44;
        monoText(ctx, PAD, y, sub, 28, theme.muted);
      }
      await placeArt(ctx, art, { cx: SLIDE_W / 2, bottom: ART_BOTTOM, maxW: 860, maxH: Math.min(900, ART_BOTTOM - y - 80) });
      break;
    }
  }
  footer(ctx, index, total);
  return finishSlide(ctx);
}

/** Canvas gradient + the SVG layer + raster layers → the slide JPEG. */
export async function finishSlide(ctx: Ctx): Promise<Buffer> {
  const theme = ctx.theme;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${SLIDE_W}" height="${SLIDE_H}">
  <defs>
    <radialGradient id="bg" cx="50%" cy="38%" r="85%">
      <stop offset="0" stop-color="${theme.bg1}"/>
      <stop offset="1" stop-color="${theme.bg2}"/>
    </radialGradient>
  </defs>
  <rect width="${SLIDE_W}" height="${SLIDE_H}" fill="url(#bg)"/>
  ${ctx.svg.join("\n  ")}
</svg>`;
  if (ctx.backdrop) return finishOnBackdrop(ctx, ctx.backdrop);
  const r = new Resvg(svg, {
    background: theme.bg2,
    font: { loadSystemFonts: false, fontFiles: fonts(), defaultFontFamily: MONO_FAMILY },
  });
  const base = Buffer.from(r.render().asPng());
  return sharp(base)
    .composite(ctx.layers.map((l) => ({ input: l.input, left: l.left, top: l.top })))
    .jpeg({ quality: 88, mozjpeg: true })
    .toBuffer();
}

/**
 * Same slide over generated art: the art fills the frame, a veil in the
 * theme's colours darkens it most where the headline sits (top) and where the
 * footer sits (bottom), then the type and the cards go on top. Cards on art
 * need a solid-ish fill to read, so the caller passes a theme whose `card` is
 * opaque enough (see backdropTheme in higgsfield.ts).
 */
async function finishOnBackdrop(ctx: Ctx, backdrop: Buffer): Promise<Buffer> {
  const theme = ctx.theme;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${SLIDE_W}" height="${SLIDE_H}">
  <defs>
    <linearGradient id="veil" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${theme.bg2}" stop-opacity="0.92"/>
      <stop offset="0.28" stop-color="${theme.bg2}" stop-opacity="0.7"/>
      <stop offset="0.6" stop-color="${theme.bg1}" stop-opacity="0.42"/>
      <stop offset="1" stop-color="${theme.bg2}" stop-opacity="0.9"/>
    </linearGradient>
  </defs>
  <rect width="${SLIDE_W}" height="${SLIDE_H}" fill="url(#veil)"/>
  ${ctx.svg.join("\n  ")}
</svg>`;
  const r = new Resvg(svg, {
    font: { loadSystemFonts: false, fontFiles: fonts(), defaultFontFamily: MONO_FAMILY },
  });
  const overlay = Buffer.from(r.render().asPng());
  const base = await sharp(backdrop).resize(SLIDE_W, SLIDE_H, { fit: "cover" }).toBuffer();
  return sharp(base)
    .composite([{ input: overlay, left: 0, top: 0 }, ...ctx.layers.map((l) => ({ input: l.input, left: l.left, top: l.top }))])
    .jpeg({ quality: 88, mozjpeg: true })
    .toBuffer();
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Ask the vision model which gallery image is the cleanest packshot: the
 * product alone, no added badges, callouts or marketing text. Store galleries
 * mix those freely and the first image is often the busiest. Returns indices
 * best-first; any failure → the gallery's own order.
 */
async function rankHeroes(
  cm: NonNullable<ReturnType<typeof tryCopyModel>>,
  photos: Buffer[],
): Promise<number[]> {
  const order = photos.map((_, i) => i);
  if (photos.length < 2) return order;
  try {
    const thumbs = await Promise.all(
      photos.map((b) => sharp(b).resize({ width: 320, withoutEnlargement: true }).jpeg({ quality: 60 }).toBuffer()),
    );
    const content: Array<
      | { type: "text"; text: string }
      | { type: "image_url"; image_url: { url: string; detail: "low" } }
    > = [
      {
        type: "text",
        text:
          `${photos.length} product gallery images, numbered 0..${photos.length - 1}. Rank them best-first as a HERO ` +
          `cut-out: the product alone on a plain backdrop, in focus, with NO added text, badges, callout boxes, ` +
          `infographics or screenshots (the product's own printed label is fine). Return JSON {"order":[...]} with every index once.`,
      },
    ];
    thumbs.forEach((t, i) => {
      content.push({ type: "text", text: `image ${i}:` });
      content.push({ type: "image_url", image_url: { url: `data:image/jpeg;base64,${t.toString("base64")}`, detail: "low" } });
    });
    const completion = await cm.client.chat.completions.create({
      model: cm.model,
      temperature: 0,
      messages: [{ role: "user", content }],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "hero_rank",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            required: ["order"],
            properties: { order: { type: "array", items: { type: "integer" } } },
          },
        },
      },
    });
    const parsed = JSON.parse(completion.choices[0]?.message?.content ?? "{}") as { order?: number[] };
    const seen = new Set<number>();
    const ranked = (parsed.order ?? []).filter(
      (i) => Number.isInteger(i) && i >= 0 && i < photos.length && !seen.has(i) && (seen.add(i), true),
    );
    return [...ranked, ...order.filter((i) => !seen.has(i))];
  } catch {
    return order;
  }
}

/** The hero: best-ranked photo that cuts out cleanly; else the best-ranked photo as a card. */
async function pickArt(
  cm: NonNullable<ReturnType<typeof tryCopyModel>>,
  photos: Buffer[],
): Promise<{ cutout: Cutout | null; photo: Buffer | null; heroIndex: number }> {
  const ranked = await rankHeroes(cm, photos.slice(0, 6));
  for (const i of ranked) {
    try {
      const c = await cutoutProduct(photos[i]);
      if (c) return { cutout: c, photo: photos[i], heroIndex: i };
    } catch {
      /* try the next one */
    }
  }
  const i = ranked[0] ?? 0;
  return { cutout: null, photo: photos[i] ?? null, heroIndex: i };
}

export async function generateProductExplainer(
  product: ShopifyProduct,
  store: ShopifyStore,
  photos: Buffer[],
  count: number,
  angle: string,
  diag?: RunLogger | null,
  /** Local experiments: a backdrop image to use instead of calling Higgsfield. */
  opts: { backdrop?: Buffer | null } = {},
): Promise<ExplainerDeck | null> {
  const cm = tryCopyModel({ timeoutMs: 60_000 });
  if (!cm) return null;
  // Higgsfield experiment — see the same block in siteExplainer.ts.
  const backdropJob = startBackdrop(
    [product.title, product.productType, store.name, product.description.slice(0, 400)].filter(Boolean).join(". "),
    opts.backdrop,
  ).catch(() => null);
  const kinds = planKinds(count);
  const cards = priceCards(product);

  const user =
    (angle.trim() ? `THE CREATOR'S ANGLE (their own words, keep the spirit): ${plain(angle, 200)}\n\n` : "") +
    `PRODUCT FACTS (the only source of truth):\n${productFacts(product, store)}\n` +
    `Store: ${store.name ?? store.domain} (${store.domain})\n` +
    (cards.length
      ? `Prices the system will print on the price slide: ${cards.map((c) => `${c.title} ${c.price}${c.was ? ` (was ${c.was})` : ""}`).join("; ")}\n`
      : "") +
    `\nWrite EXACTLY ${kinds.length} slides, in this order of kinds: ${kinds.join(", ")}.\n` +
    `Brand/product short name for slides 2+: "${productShortName(product)}".`;

  let raw: RawSlide[];
  try {
    const completion = await cm.client.chat.completions.create({
      model: cm.model,
      temperature: 0.7,
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: user },
      ],
      response_format: {
        type: "json_schema",
        json_schema: { name: "product_explainer", strict: true, schema: SCHEMA },
      },
    });
    const text = completion.choices[0]?.message?.content ?? "{}";
    if (diag) await diag.text("03_product_explainer_raw.json", text);
    raw = (JSON.parse(text) as { slides?: RawSlide[] }).slides ?? [];
  } catch (e) {
    if (diag) await diag.text("03_product_explainer_raw.json", `MODEL CALL FAILED: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }
  if (raw.length === 0) return null;

  // Force the planned structure: kind by position, the model's text by position.
  const slides: RawSlide[] = kinds.map((kind, i) => ({
    kind,
    headline: plain(raw[i]?.headline ?? "", 60),
    accent: plain(raw[i]?.accent ?? "", 30),
    sub: raw[i]?.sub ?? "",
    bullets: Array.isArray(raw[i]?.bullets) ? raw[i].bullets : [],
    cards: Array.isArray(raw[i]?.cards) ? raw[i].cards : [],
    pill: raw[i]?.pill ?? "",
    footnote: raw[i]?.footnote ?? "",
  }));
  // Every slide needs a headline; a missing one is a failed draft.
  if (slides.some((s) => !s.headline)) return null;
  // The hook never names the brand (the one rule a sales deck breaks first).
  const brand = (product.vendor ?? store.name ?? "").toLowerCase().split(/\s+/)[0];
  if (brand && brand.length >= 3 && slides[0].headline.toLowerCase().includes(brand)) {
    slides[0].headline = slides[0].headline.replace(new RegExp(brand, "i"), "").replace(/\s{2,}/g, " ").trim() || slides[0].headline;
  }

  const art = await pickArt(cm, photos);
  const bd = await backdropJob;
  await logBackdrop(diag, bd);
  // The product's own colour still sets the hue; the art only changes the canvas.
  const baseTheme = await themeFrom(art.photo);
  const theme = bd?.image ? backdropTheme(baseTheme) : baseTheme;

  const backgrounds: Buffer[] = [];
  for (let i = 0; i < slides.length; i++) {
    backgrounds.push(await renderSlide(slides[i], i, slides.length, theme, art, product, bd?.image ?? null));
  }

  const lines = slides.map((s) => {
    const bits = [s.headline, s.sub, ...s.bullets.map((b) => `${b.lead} ${b.rest}`), ...s.cards.map((c) => `${c.title}: ${c.meta} ${c.body}`), s.pill]
      .map((t) => plain(t ?? "", 120))
      .filter(Boolean);
    return bits.join(" · ");
  });

  if (diag) {
    await diag.json("03_product_explainer.json", {
      note: "PRODUCT EXPLAINER — designed slides; all text baked into the backgrounds, live captions empty.",
      model: cm.label,
      kinds,
      theme,
      heroIndex: art.heroIndex,
      cutout: !!art.cutout,
      priceCards: cards,
      slides,
    });
  }

  return {
    backgrounds,
    slides: slides.map((s, i) => ({
      role: i === 0 ? "title" : s.kind === "cta" ? "cta" : "reason",
      number: null,
      text: "",
      imageKeywords: [],
    })),
    title: slides[0].headline.toLowerCase(),
    lines,
    theme,
    model: cm.label,
    kinds,
  };
}
