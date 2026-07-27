import sharp from "sharp";
import {
  layoutSlide,
  SLIDE_W,
  SLIDE_H,
  type SlidePos,
  type SlideRole,
} from "./layout";

// Server-only. Measures how legible white caption text is against the exact
// region of the background it lands on.
//
// Runs AFTER the copy model has written the captions and layoutSlide() has
// placed them, so the sampled box is the real one the user will see — not a
// guess. The caller decides what to do with a bad score (see CONTRAST_FLOOR).
//
// NOTE: this never touches typography. The caption font, weight, and the black
// stroke around the glyphs are fixed and must stay byte-identical — the only
// remedy this measurement feeds is a plate painted BEHIND the text.

/**
 * Below this WCAG ratio, white text is considered to be sitting on a background
 * too bright to read against. Deliberately far below the WCAG AA bar (4.5): the
 * glyphs already carry a black stroke, so we only want to catch the genuinely
 * unreadable cases, not every mildly light photo.
 *
 * Measured reference points — ratio = 1.05 / (luminance + 0.05):
 *   pure white (255)  →  1.00   worst case, text is invisible
 *   cream (235)       →  1.27   the washed-out-curtain failure
 *   light grey (183)  →  2.01   ← the floor sits almost exactly here
 *   mid grey (128)    →  3.95
 *   dark grey (64)    → 10.37
 *   pure black (0)    → 21.00   best case
 *
 * The floor was raised 2.0 → 2.5 after a caption over a TikTok profile grid
 * measured 2.42 in two separate runs and was unreadable both times (the grid's
 * own baked-in thumbnail text competes with the caption). The nearest slide that
 * genuinely reads fine measured 2.88, so 2.5 separates them with one knob.
 * Erring toward the plate is deliberate: a false positive is a black bar on a
 * slide that didn't strictly need one, a false negative is an unreadable slide.
 *
 * KNOWN BLIND SPOT: this scores the MEAN, so a background that is half black
 * and half white measures 3.98 ("ok") while being the hardest case there is.
 * That's why `stdev` is reported alongside — 127.5 on that same sample. Real
 * failures so far have also been high-stdev (98.0), but the one clean pass
 * nearby was 88.3 — too close to draw a second threshold without overfitting
 * two data points, so stdev stays diagnostic-only.
 */
export const CONTRAST_FLOOR = 2.5;

/** WCAG relative luminance of an 8-bit sRGB colour. */
function relativeLuminance(r: number, g: number, b: number): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/**
 * WCAG contrast ratio between pure white text and a background of luminance L.
 * (Lighter + 0.05) / (darker + 0.05), where lighter is white (L = 1).
 */
function ratioAgainstWhite(luminance: number): number {
  return 1.05 / (luminance + 0.05);
}

export interface ContrastProbe {
  /** Mean sRGB of the background under the caption box. */
  mean: { r: number; g: number; b: number };
  /** WCAG relative luminance of that mean colour (0..1). */
  luminance: number;
  /** WCAG contrast ratio, white text vs that mean (1 = invisible, 21 = ideal). */
  ratio: number;
  /**
   * Mean per-channel standard deviation in the box. Not part of the pass/fail
   * decision — logged because a busy region can read badly even at a decent
   * ratio, and we want the data before deciding whether it's worth acting on.
   */
  stdev: number;
  /** The sampled region, in 1080x1920 export space. */
  box: { left: number; top: number; width: number; height: number };
  /** ratio < CONTRAST_FLOOR — the caption needs a plate behind it. */
  poor: boolean;
}

function clampInt(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, Math.round(v)));
}

/**
 * Sample the background under a slide's caption and score it.
 *
 * `preparedBg` MUST already be the fitted 1080x1920 export crop (what
 * prepareBackground() returns), otherwise the layout coordinates won't line up
 * with the pixels being measured.
 */
export async function probeCaptionContrast(
  preparedBg: Buffer,
  opts: {
    text: string;
    role: SlideRole;
    number: number | null;
    pos?: SlidePos | null;
  },
): Promise<ContrastProbe | null> {
  const layout = layoutSlide({
    text: opts.text,
    role: opts.role,
    number: opts.number,
    pos: opts.pos ?? null,
  });

  // Pad the text block a little: the glyph stroke and drop shadow bleed past the
  // box, and the eye reads the immediate surround as part of the contrast.
  const pad = layout.fontSize * 0.25;
  const left = clampInt(layout.block.left - pad, 0, SLIDE_W - 1);
  const top = clampInt(layout.block.top - pad, 0, SLIDE_H - 1);
  const width = clampInt(layout.block.width + pad * 2, 1, SLIDE_W - left);
  const height = clampInt(layout.block.height + pad * 2, 1, SLIDE_H - top);

  try {
    const stats = await sharp(preparedBg)
      .extract({ left, top, width, height })
      .stats();
    const [r, g, b] = stats.channels;
    if (!r || !g || !b) return null;

    const mean = { r: r.mean, g: g.mean, b: b.mean };
    const luminance = relativeLuminance(mean.r, mean.g, mean.b);
    const ratio = ratioAgainstWhite(luminance);

    return {
      mean,
      luminance,
      ratio,
      stdev: (r.stdev + g.stdev + b.stdev) / 3,
      box: { left, top, width, height },
      poor: ratio < CONTRAST_FLOOR,
    };
  } catch {
    // Measurement must never break a generation.
    return null;
  }
}
