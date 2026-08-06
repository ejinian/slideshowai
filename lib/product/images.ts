import sharp from "sharp";

// Product photos are NOT phone photos, and the difference breaks three things
// the normal upload path never hits. Measured across live stores:
//
//  1. TRANSPARENCY — 2 of 4 tested product images were PNGs with an alpha
//     channel (Allbirds, Feastables). composite.ts never flattens, so sharp
//     would resolve alpha to black unpredictably. We flatten explicitly.
//  2. ASPECT — every product image measured square-ish (1.00 / 1.09 / 0.84)
//     while slides are 9:16 (0.5625). prepareBackground uses `fit: "cover"`,
//     which would crop ~44% off each side of a square packshot and slice the
//     product in half. We pre-compose to exactly 1080x1920 so that cover is a
//     no-op and nothing is lost.
//  3. JUNK — the tier-2 HTML harvest picks up logos, badges and payment icons
//     alongside real photography. Anything small is dropped.

const SLIDE_W = 1080;
const SLIDE_H = 1920; // 9:16 → aspect ratio 0.5625

// Below this the source is close enough to portrait that a cover-crop loses
// little; above it, cropping would eat the product, so we pad instead.
const CROP_SAFE_AR = 0.65;

const MIN_EDGE = 400; // logos/badges/payment icons are far smaller
const FETCH_TIMEOUT_MS = 10_000;
const MAX_BYTES = 12_000_000;

export interface PreparedImage {
  /** 1080x1920 JPEG data URL, ready to hand to /api/generate as a userImage. */
  dataUrl: string;
  /** Where it came from, so the UI can show a thumbnail / dedupe. */
  source: string;
  /** True when we padded with a blurred fill rather than cropping. */
  padded: boolean;
  width: number;
  height: number;
}

async function download(url: string): Promise<Buffer | null> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctl.signal,
      redirect: "follow",
      headers: { "user-agent": "Mozilla/5.0", accept: "image/*" },
    });
    if (!res.ok) return null;
    const len = Number(res.headers.get("content-length") ?? 0);
    if (len > MAX_BYTES) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    return buf.byteLength > MAX_BYTES ? null : buf;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

type Rgb = { r: number; g: number; b: number };

/**
 * Is this a studio packshot on a flat backdrop, and if so what colour?
 *
 * It matters because the two source types need opposite padding. A blurred fill
 * is the right treatment for a lifestyle photo, but blurring a white studio
 * background yields a flat grey slab that reads as a broken letterbox. Sampling
 * the corners and extending that exact colour instead gives a seamless
 * full-bleed slide where the product simply sits in more of its own backdrop.
 */
async function flatBackdrop(
  flatBuf: Buffer,
  w: number,
  h: number,
): Promise<Rgb | null> {
  const p = Math.max(8, Math.floor(Math.min(w, h) * 0.04));
  const corners: Array<[number, number]> = [
    [0, 0],
    [w - p, 0],
    [0, h - p],
    [w - p, h - p],
  ];
  try {
    const stats = await Promise.all(
      corners.map(async (c) => {
        // stats() reports on the INPUT image and ignores pipeline ops, so the
        // crop has to be materialized before it can be measured — otherwise
        // every corner returns identical whole-image numbers.
        const patch = await sharp(flatBuf)
          .extract({ left: c[0], top: c[1], width: p, height: p })
          .toBuffer();
        return sharp(patch).stats();
      }),
    );
    const means = stats.map((s) => s.channels.slice(0, 3).map((c) => c.mean));
    // Every corner must be near-uniform in itself AND match the others.
    const maxStdev = Math.max(
      ...stats.map((s) => Math.max(...s.channels.slice(0, 3).map((c) => c.stdev))),
    );
    const spread = Math.max(
      ...[0, 1, 2].map((ch) => {
        const vals = means.map((m) => m[ch]);
        return Math.max(...vals) - Math.min(...vals);
      }),
    );
    if (maxStdev > 10 || spread > 12) return null;
    const avg = [0, 1, 2].map(
      (ch) => means.reduce((a, m) => a + m[ch], 0) / means.length,
    );
    return { r: Math.round(avg[0]), g: Math.round(avg[1]), b: Math.round(avg[2]) };
  } catch {
    return null;
  }
}

/**
 * Compose one product photo onto an exact 1080x1920 canvas.
 *
 * Near-portrait sources are cover-cropped (cheap, no bars). Everything else is
 * contained, then backed by either the product's own studio backdrop (seamless)
 * or a blurred over-scaled copy of itself — the standard TikTok/Reels treatment
 * for off-ratio media, and far better than amputating the product.
 */
async function toSlideCanvas(
  buf: Buffer,
): Promise<{ out: Buffer; padded: boolean; width: number; height: number } | null> {
  const meta = await sharp(buf).metadata();
  const w = meta.width ?? 0;
  const h = meta.height ?? 0;
  if (w < MIN_EDGE || h < MIN_EDGE) return null;

  // Flatten up front: an alpha channel resolves to black on JPEG export, so a
  // transparent packshot would otherwise arrive as a silhouette. Measured on
  // live stores, 2 of 4 product images had alpha.
  const flatBuf = await sharp(buf)
    .flatten({ background: { r: 255, g: 255, b: 255 } })
    .toBuffer();

  if (w / h <= CROP_SAFE_AR) {
    const out = await sharp(flatBuf)
      .resize(SLIDE_W, SLIDE_H, { fit: "cover", position: "centre" })
      .jpeg({ quality: 86, mozjpeg: true })
      .toBuffer();
    return { out, padded: false, width: SLIDE_W, height: SLIDE_H };
  }

  const backdrop = await flatBackdrop(flatBuf, w, h);

  const fg = await sharp(flatBuf)
    .resize(SLIDE_W, SLIDE_H, { fit: "inside", withoutEnlargement: false })
    .toBuffer();

  const bg = backdrop
    ? await sharp({
        create: {
          width: SLIDE_W,
          height: SLIDE_H,
          channels: 3,
          background: backdrop,
        },
      })
        .jpeg()
        .toBuffer()
    : await sharp(flatBuf)
        .resize(SLIDE_W, SLIDE_H, { fit: "cover", position: "centre" })
        .blur(48)
        .modulate({ brightness: 0.7 })
        .toBuffer();

  const out = await sharp(bg)
    .composite([{ input: fg, gravity: "centre" }])
    .jpeg({ quality: 86, mozjpeg: true })
    .toBuffer();
  return { out, padded: true, width: SLIDE_W, height: SLIDE_H };
}

/**
 * Download + normalize product photos, best-first, stopping at `limit`.
 * Failures are skipped silently — a dead CDN URL must never fail the whole
 * import when the other seven photos are fine.
 */
export async function prepareProductImages(
  urls: string[],
  limit: number,
): Promise<PreparedImage[]> {
  const seen = new Set<string>();
  const queue = urls.filter((u) => {
    const key = u.split("?")[0];
    if (seen.has(key)) return false;
    seen.add(key);
    return /^https?:\/\//i.test(u);
  });

  const out: PreparedImage[] = [];
  // Sequential on purpose: we usually need only the first few, and hammering a
  // store's CDN with 200 parallel requests is how you earn a rate-limit.
  for (const url of queue) {
    if (out.length >= limit) break;
    const buf = await download(url);
    if (!buf) continue;
    try {
      const composed = await toSlideCanvas(buf);
      if (!composed) continue;
      out.push({
        dataUrl: `data:image/jpeg;base64,${composed.out.toString("base64")}`,
        source: url,
        padded: composed.padded,
        width: composed.width,
        height: composed.height,
      });
    } catch {
      /* unreadable/corrupt image — skip it */
    }
  }
  return out;
}
