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
  /**
   * User multiplier on the caption font size. 1.0 = the generated default.
   * Applied to the role's base size BEFORE wrapping, so a bigger size re-wraps
   * into more lines instead of overflowing the intended text width.
   */
  fontScale?: number;
}

/** Bounds for the caption size slider. */
export const FONT_SCALE_MIN = 0.6;
export const FONT_SCALE_MAX = 1.6;

// Defaults reproduce today's look: centered, anchored low (near the old
// BOTTOM_PAD=170 placement).
// y is the caption's vertical anchor (0=top, 1=bottom). Kept in the upper-middle
// so it clears TikTok's bottom UI chrome (caption + username + action buttons),
// which was hiding captions anchored near the bottom.
export const DEFAULT_POS: SlidePos = { x: 0.5, y: 0.58, align: "center" };

// Inset kept between the block and the canvas edges when clamping.
const MARGIN = 32;

/**
 * Horizontal breathing room on each side of a caption line's black plate, as a
 * fraction of fontSize. Shared by the SVG bake and the HTML editor overlay so
 * the plate is the same width in both.
 *
 * Raised 0.25 → 0.36: line widths are estimated from CHARACTER COUNT times an
 * average advance, so a line of wide glyphs ("hacks nobody") renders wider than
 * the estimate and crowded the plate edge, while a narrow line ("tells you for")
 * sat comfortably inside. The padding has to absorb that error.
 */
export const PLATE_PAD_X_FRAC = 0.36;
/**
 * Plate corner radius, as a fraction of fontSize. Generous on purpose — at 0.18
 * the plate read as a plain rectangle; TikTok's own text background is closer to
 * a pill.
 */
export const PLATE_RADIUS_FRAC = 0.32;

/**
 * Extra width allowed for the plate only, absorbing the same character-count
 * estimate error as the padding above. Applied to the plate rect and never to
 * the text layout, so line breaks and caption geometry are untouched.
 */
export const PLATE_WIDTH_SLACK = 1.04;

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

// Classic TikTok caption look: plain white text in the caption family, no
// decorations. Numbered slides carry their number inline ("1. …") in the same
// font as the sentence.
const ROLE_STYLE: Record<SlideRole, RoleStyle> = {
  title: { fontSize: 100, lineHeightFactor: 1.12, fontWeight: 800, letterSpacing: -1, charWidth: 0.54, widthFrac: 0.84, maxLines: 4, minChars: 8 },
  reason: { fontSize: 62, lineHeightFactor: 1.16, fontWeight: 700, letterSpacing: -0.5, charWidth: 0.54, widthFrac: 0.82, maxLines: 4, minChars: 10 },
  plug: { fontSize: 62, lineHeightFactor: 1.16, fontWeight: 700, letterSpacing: -0.5, charWidth: 0.54, widthFrac: 0.82, maxLines: 4, minChars: 10 },
  // maxLines was 2 — a budget for a four-word sign-off ("follow for more"). On a
  // 1-3 slide deck the last slide is the PAYOFF, i.e. the longest and most
  // substantive line of the whole post, and 2 lines crushed it to the shrink
  // floor (58px → 32px, 55%). Raising the budget only affects captions that were
  // being shrunk: the loop below never runs when the text already fits.
  cta: { fontSize: 58, lineHeightFactor: 1.12, fontWeight: 800, letterSpacing: 0, charWidth: 0.56, widthFrac: 0.7, maxLines: 5, minChars: 10 },
};

// The optional BODY paragraph that can sit under a caption on a short deck.
//
// Real value posts are a bold heading plus a paragraph carrying the actual
// protocol ("eat in a 600-800 cal deficit. coke zero and rice cakes will be your
// best friends"). One caption per slide cannot express that, so short decks get
// a second block.
//
// Its size is ABSOLUTE rather than a fraction of the heading: the heading ranges
// 58-100px by role, and a proportional body would be 80px on a title slide and
// 46px on a cta. Real decks keep body text the same size on every slide.
const BODY_STYLE: RoleStyle = {
  fontSize: 46,
  lineHeightFactor: 1.26,
  fontWeight: 700,
  letterSpacing: -0.25,
  charWidth: 0.54,
  widthFrac: 0.86,
  maxLines: 10,
  minChars: 14,
};

/** Gap between the heading block and the body block, as a fraction of body size. */
const BODY_GAP_FRAC = 0.62;

export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface SlideLayout {
  role: SlideRole;
  align: Align;
  fontSize: number;
  lineHeight: number;
  fontWeight: number;
  letterSpacing: number;
  lines: string[];
  /** bounding box of the whole block (= the text), post-clamp. */
  block: Box;
  /** where the text lines flow. */
  textBox: Box;
  /** Optional body paragraph under the heading. Empty when the slide has none. */
  bodyLines: string[];
  bodyFontSize: number;
  bodyLineHeight: number;
  bodyFontWeight: number;
  bodyLetterSpacing: number;
  bodyBox: Box;
  bodyAnchorX: number;
  /**
   * One box per rendered line, tiled exactly at `lineHeight` with no vertical
   * gap. Used to paint the optional black plate BEHIND the caption when the
   * background is too bright to read white text against (see lib/generate/
   * contrast.ts). Tiled rather than padded so adjacent plates merge seamlessly
   * instead of showing rounded-corner seams.
   *
   * Typography is NOT affected by this: the plate is painted underneath, and the
   * font, weight, size and stroke are identical whether it's drawn or not.
   */
  lineBoxes: Box[];
  /** x coordinate the text is anchored to (matches `textAnchor`). */
  anchorX: number;
  textAnchor: "start" | "middle" | "end";
  /** localized radial scrim that follows the text wherever it lands. */
  scrim: { cx: number; cy: number; rx: number; ry: number };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi);
}

// Greedy word-wrap by character budget. Identical to the original compositor so
// line breaks match between the SVG export and the HTML overlay.
// NEVER truncates: captions must always render in full (an "…" on a baked slide
// is a hard product failure — see layoutSlide, which shrinks the font to fit
// instead of cutting text).
export function wrapText(text: string, maxChars: number): string[] {
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
  /** Optional paragraph rendered under the heading (short decks only). */
  body?: string | null;
}): SlideLayout {
  const pos: SlidePos = { ...DEFAULT_POS, ...(opts.pos ?? {}) };
  const align = pos.align;
  const st = ROLE_STYLE[opts.role];

  const widthFrac = clamp(pos.maxWidth ?? st.widthFrac, 0.2, 0.96);

  // Numbered slides carry the number inline, same font as the sentence
  // ("1. You're under-eating protein"), unless the text is already numbered.
  const text =
    opts.number != null &&
    (opts.role === "reason" || opts.role === "plug") &&
    !/^\s*\d+\s*[.):]/.test(opts.text)
      ? `${opts.number}. ${opts.text}`
      : opts.text;

  // Shrink-to-fit, NEVER truncate. A caption that overflows the role's line
  // budget at the base size steps the font down (bounded) until it fits; if it
  // still overflows at the floor, every line renders anyway. Long viral
  // captions beat brevity — an "…" on a slide is never acceptable.
  // Floor raised 0.55 → 0.85: prefer MORE LINES over smaller type. Halving the
  // font to save a line makes the slide look broken; an extra line doesn't.
  // Past this floor layoutSlide simply renders every line (never truncates), so
  // a very long caption grows downward instead of shrinking away to nothing.
  // The user's size multiplier scales the role's BASE size, so shrink-to-fit and
  // wrapping both operate on the size they actually asked for. Scaling the final
  // result instead would leave the line breaks computed for a different size and
  // push text past the intended width.
  const fontScale = clamp(pos.fontScale ?? 1, FONT_SCALE_MIN, FONT_SCALE_MAX);
  const baseFontSize = Math.max(8, Math.round(st.fontSize * fontScale));
  const minFontSize = Math.round(baseFontSize * 0.85);
  let fontSize = baseFontSize;
  const charsAt = (fs: number) =>
    Math.max(st.minChars, Math.floor((SLIDE_W * widthFrac) / (fs * st.charWidth)));
  let lines = wrapText(text, charsAt(fontSize));
  while (lines.length > st.maxLines && fontSize > minFontSize) {
    fontSize = Math.max(minFontSize, Math.round(fontSize * 0.92));
    lines = wrapText(text, charsAt(fontSize));
  }
  const lineHeight = Math.round(fontSize * st.lineHeightFactor);
  const longest = lines.reduce((a, b) => (b.length > a.length ? b : a), "");
  const textW = clamp(longest.length * fontSize * st.charWidth, fontSize, SLIDE_W * 0.92);
  const textH = lines.length * lineHeight;

  // --- optional body paragraph, laid out with the same model ---
  // Absent body ⇒ every value below is zero/empty and the geometry is EXACTLY
  // what it was before bodies existed, so 4+ decks are untouched.
  const bodyText = (opts.body ?? "").trim();
  const bd = BODY_STYLE;
  const bodyWidthFrac = clamp(pos.maxWidth ?? bd.widthFrac, 0.2, 0.96);
  const bodyBase = Math.max(8, Math.round(bd.fontSize * fontScale));
  const bodyMin = Math.round(bodyBase * 0.85);
  let bodyFontSize = bodyBase;
  const bodyCharsAt = (fs: number) =>
    Math.max(bd.minChars, Math.floor((SLIDE_W * bodyWidthFrac) / (fs * bd.charWidth)));
  let bodyLines = bodyText ? wrapText(bodyText, bodyCharsAt(bodyFontSize)) : [];
  while (bodyLines.length > bd.maxLines && bodyFontSize > bodyMin) {
    bodyFontSize = Math.max(bodyMin, Math.round(bodyFontSize * 0.92));
    bodyLines = wrapText(bodyText, bodyCharsAt(bodyFontSize));
  }
  const bodyLineHeight = Math.round(bodyFontSize * bd.lineHeightFactor);
  const bodyLongest = bodyLines.reduce((a, b) => (b.length > a.length ? b : a), "");
  const bodyW = bodyLines.length
    ? clamp(bodyLongest.length * bodyFontSize * bd.charWidth, bodyFontSize, SLIDE_W * 0.92)
    : 0;
  const bodyH = bodyLines.length * bodyLineHeight;
  const bodyGap = bodyLines.length ? Math.round(bodyFontSize * BODY_GAP_FRAC) : 0;

  // --- block = heading (+ gap + body), no decorations ---
  const blockW = Math.max(textW, bodyW);
  const blockH = textH + bodyGap + bodyH;

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

  const textBox: Box = {
    left: alignChild(align, left, blockW, textW),
    top,
    width: textW,
    height: textH,
  };
  const bodyBox: Box = {
    left: alignChild(align, left, blockW, bodyW),
    top: top + textH + bodyGap,
    width: bodyW,
    height: bodyH,
  };
  // Per-line boxes, using the same char-advance model the wrap used so the
  // plate tracks each line's real width instead of the block's. Body lines are
  // included so the plate covers the whole caption, heading and paragraph.
  const lineBoxes: Box[] = [
    ...lines.map((ln, i) => {
      const w = clamp(ln.length * fontSize * st.charWidth, fontSize, textW);
      return {
        left: alignChild(align, textBox.left, textW, w),
        top: textBox.top + i * lineHeight,
        width: w,
        height: lineHeight,
      };
    }),
    ...bodyLines.map((ln, i) => {
      const w = clamp(ln.length * bodyFontSize * bd.charWidth, bodyFontSize, bodyW);
      return {
        left: alignChild(align, bodyBox.left, bodyW, w),
        top: bodyBox.top + i * bodyLineHeight,
        width: w,
        height: bodyLineHeight,
      };
    }),
  ];

  const textAnchor: "start" | "middle" | "end" =
    align === "left" ? "start" : align === "right" ? "end" : "middle";
  const anchorX =
    align === "left"
      ? textBox.left
      : align === "right"
        ? textBox.left + textW
        : textBox.left + textW / 2;
  const bodyAnchorX =
    align === "left"
      ? bodyBox.left
      : align === "right"
        ? bodyBox.left + bodyW
        : bodyBox.left + bodyW / 2;

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
    fontSize,
    lineHeight,
    fontWeight: st.fontWeight,
    letterSpacing: st.letterSpacing,
    lines,
    block,
    textBox,
    bodyLines,
    bodyFontSize,
    bodyLineHeight,
    bodyFontWeight: bd.fontWeight,
    bodyLetterSpacing: bd.letterSpacing,
    bodyBox,
    bodyAnchorX,
    lineBoxes,
    anchorX,
    textAnchor,
    scrim,
  };
}
