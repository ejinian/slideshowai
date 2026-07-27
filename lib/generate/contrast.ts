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
 *   cream (235)       →  1.27
 *   light grey (183)  →  2.01
 *   mid grey (128)    →  3.95   ← the floor sits just under here
 *   dark grey (64)    → 10.37
 *   pure black (0)    → 21.00   best case
 *
 * RECALIBRATED 2026-07-26 on the fixed measurement (see the extract() note in
 * probeCaptionContrast — every earlier number was whole-image brightness, so the
 * old 2.0/2.5 floors were tuned against the wrong signal entirely).
 *
 * Calibrated against the bright-end metric on real slides. A treadmill console
 * (dark plastic, light buttons and printed labels) scores 6.81 by mean but 4.68
 * at the bright end, and its caption is genuinely hard to read — while the next
 * slide that reads cleanly sits at 5.55. The floor goes in that gap.
 *
 * Over-plating is deliberately the cheap direction: a plate is never unreadable,
 * a missed one always is, and the plate is now toggleable per slide in the
 * editor, so a judgement call the metric gets wrong takes one click to undo.
 */
export const CONTRAST_FLOOR = 5.0;

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
  /** Luminance of the BRIGHT end of the region (the percentile below) — what the verdict uses. */
  luminance: number;
  /** WCAG relative luminance of the region's mean colour. Reported, not decided on. */
  meanLuminance: number;
  /** Contrast against the mean. Kept for diagnostics so the two can be compared. */
  meanRatio: number;
  /** WCAG contrast against the region's BRIGHT end (1 = invisible, 21 = ideal). */
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

/** Caption region is downsampled to this grid before scoring its bright end. */
const GRID_W = 8;
const GRID_H = 12;
/** Score this percentile of cell brightness — robust to a lone specular pixel. */
const BRIGHT_PERCENTILE = 0.85;

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
    body?: string | null;
  },
): Promise<ContrastProbe | null> {
  const layout = layoutSlide({
    text: opts.text,
    role: opts.role,
    number: opts.number,
    pos: opts.pos ?? null,
    body: opts.body ?? null,
  });

  // Pad the text block a little: the glyph stroke and drop shadow bleed past the
  // box, and the eye reads the immediate surround as part of the contrast.
  const pad = layout.fontSize * 0.25;
  const left = clampInt(layout.block.left - pad, 0, SLIDE_W - 1);
  const top = clampInt(layout.block.top - pad, 0, SLIDE_H - 1);
  const width = clampInt(layout.block.width + pad * 2, 1, SLIDE_W - left);
  const height = clampInt(layout.block.height + pad * 2, 1, SLIDE_H - top);

  try {
    // The crop MUST be materialised before stats(). sharp's stats() reads the
    // SOURCE image and ignores chained pipeline operations, so
    // `sharp(x).extract(...).stats()` silently returns whole-image statistics.
    const crop = await sharp(preparedBg)
      .extract({ left, top, width, height })
      .toBuffer();
    const stats = await sharp(crop).stats();
    const [r, g, b] = stats.channels;
    if (!r || !g || !b) return null;

    const mean = { r: r.mean, g: g.mean, b: b.mean };
    const meanLuminance = relativeLuminance(mean.r, mean.g, mean.b);

    // THE VERDICT IS NOT THE MEAN. Text is unreadable wherever it crosses a
    // bright patch, and averaging hides those: a treadmill console (dark plastic,
    // light buttons and printed labels) averaged to a very comfortable 6.81 while
    // the caption was genuinely hard to read against the buttons behind it.
    //
    // So downsample the caption region to a coarse grid and score the BRIGHT END
    // of that distribution. The 85th percentile ignores a single stray specular
    // highlight but catches any patch big enough to sit behind real glyphs.
    const { data } = await sharp(crop)
      .resize(GRID_W, GRID_H, { fit: "fill" })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const cells: number[] = [];
    for (let i = 0; i + 2 < data.length; i += 3) {
      cells.push(relativeLuminance(data[i], data[i + 1], data[i + 2]));
    }
    cells.sort((x, y) => x - y);
    const brightLuminance = cells.length
      ? cells[Math.min(cells.length - 1, Math.floor(cells.length * BRIGHT_PERCENTILE))]
      : meanLuminance;

    const ratio = ratioAgainstWhite(brightLuminance);

    return {
      mean,
      luminance: brightLuminance,
      meanLuminance,
      meanRatio: ratioAgainstWhite(meanLuminance),
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
