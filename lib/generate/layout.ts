// Shared, PURE layout model for a composited listicle slide.
//
// This module is the single source of truth for *where the caption sits* and
// *how it is typeset*. It is consumed by two renderers that MUST agree pixel
// for pixel:
//   1. the Sharp/SVG compositor (server)  — lib/generate/composite.ts
//   2. the drag editor's HTML overlay (client) — components/dashboard/slideshows/SlideEditor.tsx
//
// Because both renderers derive every coordinate from `layoutSlide()` in the
// fixed 1080x1920 export space, a drag in the browser (scaled by the rendered
// container width) maps exactly onto the final PNG. Positions are expressed as
// NORMALIZED COORDINATES (fractions 0..1) so the mapping is resolution-free.
//
// IMPORTANT: keep this file free of server-only imports (no `sharp`, no `fs`),
// so it is safe to bundle into Client Components.

export const SLIDE_W = 1080;
export const SLIDE_H = 1920;
export const ACCENT = "#6366f1";

// Owned here (the pure module) so both the client overlay and the OpenAI-backed
// listicle generator can share the type without pulling each other's deps in.
export type SlideRole = "title" | "reason" | "plug" | "cta";
export type Align = "left" | "center" | "right";

export interface SlidePos {
  /** 0..1 anchor X. Its meaning depends on `align`: left edge / center / right edge. */
  x: number;
  /** 0..1 anchor Y — the vertical CENTER of the text block. */
  y: number;
  align: Align;
  /** 0..1 fraction of the slide width the text may fill before wrapping. */
  maxWidth?: number;
}

// Defaults reproduce today's look: centered, anchored low (near the old
// BOTTOM_PAD=170 placement).
export const DEFAULT_POS: SlidePos = { x: 0.5, y: 0.82, align: "center" };

// Inset kept between the block and the canvas edges when clamping.
const MARGIN = 32;

interface RoleStyle {
  fontSize: number;
  lineHeightFactor: number;
  fontWeight: number;
  letterSpacing: number;
  /** average glyph advance as a fraction of fontSize (used for sizing/wrapping). */
  charWidth: number;
  /** default text width as a fraction of SLIDE_W. */
  widthFrac: number;
  maxLines: number;
  minChars: number;
}

// Ported verbatim from the original buildSvg() so DEFAULT_POS reproduces the
// previous styling (oversized title, number-badge reasons/plug, CTA pill).
const ROLE_STYLE: Record<SlideRole, RoleStyle> = {
  title: { fontSize: 100, lineHeightFactor: 1.12, fontWeight: 800, letterSpacing: -1, charWidth: 0.54, widthFrac: 0.84, maxLines: 4, minChars: 8 },
  reason: { fontSize: 62, lineHeightFactor: 1.16, fontWeight: 700, letterSpacing: -0.5, charWidth: 0.54, widthFrac: 0.82, maxLines: 4, minChars: 10 },
  plug: { fontSize: 62, lineHeightFactor: 1.16, fontWeight: 700, letterSpacing: -0.5, charWidth: 0.54, widthFrac: 0.82, maxLines: 4, minChars: 10 },
  cta: { fontSize: 58, lineHeightFactor: 1.12, fontWeight: 800, letterSpacing: 0, charWidth: 0.56, widthFrac: 0.7, maxLines: 2, minChars: 10 },
};

// Decoration constants (1080-space px), matching the originals.
const TITLE_RULE_W = 120;
const TITLE_RULE_H = 8;
const TITLE_RULE_GAP = 36;
const BADGE = 132;
const BADGE_GAP = 32;
const BADGE_FONT = 78;
const CTA_PAD_X = 60;
const CTA_PAD_Y = 32;

export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface SlideLayout {
  role: SlideRole;
  align: Align;
  accent: string;
  fontSize: number;
  lineHeight: number;
  fontWeight: number;
  letterSpacing: number;
  lines: string[];
  /** bounding box of the whole block (text + decorations), post-clamp. */
  block: Box;
  /** where the text lines flow. */
  textBox: Box;
  /** x coordinate the text is anchored to (matches `textAnchor`). */
  anchorX: number;
  textAnchor: "start" | "middle" | "end";
  /** title accent rule, if role === "title". */
  rule?: Box;
  /** number badge, if role === "reason" | "plug". */
  badge?: { box: Box; label: string; fontSize: number };
  /** CTA pill, if role === "cta". */
  pill?: Box;
  /** localized radial scrim that follows the text wherever it lands. */
  scrim: { cx: number; cy: number; rx: number; ry: number };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi);
}

// Greedy word-wrap by character budget. Identical to the original compositor so
// line breaks match between the SVG export and the HTML overlay.
export function wrapText(text: string, maxChars: number, maxLines: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    if (!cur) cur = w;
    else if ((cur + " " + w).length <= maxChars) cur += " " + w;
    else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    kept[maxLines - 1] = kept[maxLines - 1].replace(/[.,;:!?]?$/, "…");
    return kept;
  }
  return lines;
}

// Cross-axis placement of a child of width `childW` inside the block, honoring
// `align` (left → block left edge, right → block right edge, else centered).
function alignChild(align: Align, blockLeft: number, blockW: number, childW: number): number {
  if (align === "left") return blockLeft;
  if (align === "right") return blockLeft + blockW - childW;
  return blockLeft + (blockW - childW) / 2;
}

/**
 * Compute the full geometry for a slide's caption at a given position.
 * Everything returned is in the 1080x1920 export coordinate space.
 */
export function layoutSlide(opts: {
  text: string;
  role: SlideRole;
  number: number | null;
  pos?: Partial<SlidePos> | null;
}): SlideLayout {
  const pos: SlidePos = { ...DEFAULT_POS, ...(opts.pos ?? {}) };
  const align = pos.align;
  const st = ROLE_STYLE[opts.role];

  const fontSize = st.fontSize;
  const lineHeight = Math.round(fontSize * st.lineHeightFactor);
  const widthFrac = clamp(pos.maxWidth ?? st.widthFrac, 0.2, 0.96);

  const maxChars = Math.max(
    st.minChars,
    Math.floor((SLIDE_W * widthFrac) / (fontSize * st.charWidth)),
  );
  const lines = wrapText(opts.text, maxChars, st.maxLines);
  const longest = lines.reduce((a, b) => (b.length > a.length ? b : a), "");
  const textW = clamp(longest.length * fontSize * st.charWidth, fontSize, SLIDE_W * 0.92);
  const textH = lines.length * lineHeight;

  // --- block dimensions (include decorations) ---
  let blockW: number;
  let blockH: number;
  if (opts.role === "title") {
    blockW = Math.max(textW, TITLE_RULE_W);
    blockH = TITLE_RULE_H + TITLE_RULE_GAP + textH;
  } else if (opts.role === "cta") {
    const pillW = Math.min(SLIDE_W * 0.9, textW + CTA_PAD_X * 2);
    blockW = pillW;
    blockH = textH + CTA_PAD_Y * 2;
  } else {
    blockW = Math.max(textW, BADGE);
    blockH = BADGE + BADGE_GAP + textH;
  }

  // --- anchor the block, then clamp it fully on-canvas ---
  // Vertical: anchor y is the block's vertical center.
  let top = pos.y * SLIDE_H - blockH / 2;
  top = clamp(top, MARGIN, SLIDE_H - blockH - MARGIN);

  // Horizontal: anchor x is the left edge / center / right edge per align.
  let left: number;
  if (align === "left") left = pos.x * SLIDE_W;
  else if (align === "right") left = pos.x * SLIDE_W - blockW;
  else left = pos.x * SLIDE_W - blockW / 2;
  left = clamp(left, MARGIN, SLIDE_W - blockW - MARGIN);

  const block: Box = { left, top, width: blockW, height: blockH };

  // --- children, positioned within the (clamped) block ---
  let rule: Box | undefined;
  let badge: SlideLayout["badge"];
  let pill: Box | undefined;
  let textBox: Box;
  let anchorX: number;
  let textAnchor: "start" | "middle" | "end";

  if (opts.role === "title") {
    rule = {
      left: alignChild(align, left, blockW, TITLE_RULE_W),
      top,
      width: TITLE_RULE_W,
      height: TITLE_RULE_H,
    };
    textBox = {
      left: alignChild(align, left, blockW, textW),
      top: top + TITLE_RULE_H + TITLE_RULE_GAP,
      width: textW,
      height: textH,
    };
    textAnchor = align === "left" ? "start" : align === "right" ? "end" : "middle";
    anchorX = align === "left" ? textBox.left : align === "right" ? textBox.left + textW : textBox.left + textW / 2;
  } else if (opts.role === "cta") {
    pill = { left, top, width: blockW, height: blockH };
    // Text is always centered inside the pill; the pill itself moves with align.
    textBox = { left: left + (blockW - textW) / 2, top: top + CTA_PAD_Y, width: textW, height: textH };
    textAnchor = "middle";
    anchorX = left + blockW / 2;
  } else {
    badge = {
      box: { left: alignChild(align, left, blockW, BADGE), top, width: BADGE, height: BADGE },
      label: opts.number != null ? String(opts.number) : "",
      fontSize: BADGE_FONT,
    };
    textBox = {
      left: alignChild(align, left, blockW, textW),
      top: top + BADGE + BADGE_GAP,
      width: textW,
      height: textH,
    };
    textAnchor = align === "left" ? "start" : align === "right" ? "end" : "middle";
    anchorX = align === "left" ? textBox.left : align === "right" ? textBox.left + textW : textBox.left + textW / 2;
  }

  // Localized scrim: an ellipse sized to the block plus soft padding, centered
  // on the block. Follows the text wherever it lands so captions stay legible.
  const scrim = {
    cx: left + blockW / 2,
    cy: top + blockH / 2,
    rx: blockW / 2 + fontSize * 0.95,
    ry: blockH / 2 + fontSize * 0.75,
  };

  return {
    role: opts.role,
    align,
    accent: ACCENT,
    fontSize,
    lineHeight,
    fontWeight: st.fontWeight,
    letterSpacing: st.letterSpacing,
    lines,
    block,
    textBox,
    anchorX,
    textAnchor,
    rule,
    badge,
    pill,
    scrim,
  };
}
