// SERVER-ONLY. "Make one like this": resolve a TikTok photo post the user
// pasted, read its slides, and distill the FORMAT — never the content.
//
// This is a READER, exactly like lib/product: it returns the shape
// /api/generate already accepts (a FormatBlueprint riding the same channel
// "Remix this trend" uses), so listicle.ts / imageFirst.ts / the generate route
// are untouched. The blueprint teaches the deck's MECHANIC — hook shape,
// per-slide beats, caption register. The reference's actual photos are read for
// analysis and discarded; we never store or republish someone else's images.
//
// RESOLVERS, in order (same chain as scripts/fetch-viral-example.mjs, which
// proved it):
//   1. tikwm — free keyless public resolver. Takes the raw URL, so it also
//      handles vm.tiktok.com short links.
//   2. Apify ScrapTik — only if tikwm fails AND APIFY_TOKEN is set (~$0.002,
//      shared budget with the trends pipeline). Needs the aweme id, so short
//      links that tikwm couldn't resolve stop here.
// Fetching tiktok.com ourselves is not an option — TikTok withholds the post
// payload from non-browser clients (documented in the script).

import type { FormatBlueprint } from "@/lib/generate/listicle";

// Vision task → gpt-4o directly, like every other vision pass here (the
// copyModel seam is for the CAPTION model, which may be a non-vision provider).
const VISION_MODEL = "gpt-4o";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const ACTOR = "scraptik~tiktok-api";
/** Slides we analyze. Past this we'd pay to read the tail of a photo dump. */
const MAX_SLIDES = 8;
/** Longest edge sent to vision — mirrors lib/trend-slide-text.ts SEND_PX logic:
 *  at detail:"low" the model boxes to 512px anyway, bigger is pure upload. */
const DETAIL = "low" as const;

export class ReferenceError extends Error {
  constructor(
    message: string,
    /** Machine code the route maps to a status + friendly copy. */
    readonly code: "not_tiktok" | "not_photo_post" | "unreachable" | "analysis_failed",
    /** The underlying cause, for the failure dump — never shown to the user. */
    readonly detail?: string,
  ) {
    super(message);
  }
}

export interface ResolvedReference {
  /** @handle, for the chip ("Based on @youneslifts"). */
  author: string | null;
  /** The post's own description (under-the-post text, often hashtag soup). */
  desc: string;
  slideCount: number;
  views: number | null;
  /** CDN URLs of the slides, in swipe order. Read, analyzed, discarded. */
  imageUrls: string[];
}

export interface ReferenceAnalysis {
  format: FormatBlueprint;
  slideCount: number;
  author: string | null;
  views: number | null;
  /** The transcribed hook, so the chip can show WHAT it learned. */
  hookText: string | null;
}

/** True for any tiktok.com / vm.tiktok.com link — the composer's router. */
export function isTikTokUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === "vm.tiktok.com" || host === "tiktok.com" || host.endsWith(".tiktok.com");
  } catch {
    return false;
  }
}

function parseTarget(rawUrl: string): { awemeId: string | null } {
  const id = rawUrl.match(/\/(?:photo|video)\/(\d+)/);
  return { awemeId: id ? id[1] : null };
}

/** TikTok pairs a HEIC variant with a JPEG one; pick what sharp/vision can read. */
function pickDecodable(urls: unknown): string | undefined {
  if (!Array.isArray(urls) || urls.length === 0) return undefined;
  const strs = urls.filter((u): u is string => typeof u === "string");
  return strs.find((u) => /\.(jpe?g|webp|png)(\?|$)/i.test(u)) ?? strs[0];
}

async function viaTikwm(rawUrl: string): Promise<ResolvedReference> {
  const res = await fetch(
    `https://www.tikwm.com/api/?url=${encodeURIComponent(rawUrl)}`,
    { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(30_000) },
  );
  if (!res.ok) throw new Error(`tikwm HTTP ${res.status}`);
  const j = (await res.json()) as {
    code?: number;
    msg?: string;
    data?: {
      images?: unknown[];
      title?: string;
      author?: { unique_id?: string };
      play_count?: number;
    };
  };
  if (j.code !== 0) throw new Error(`tikwm: ${j.msg || "error"}`);
  const d = j.data ?? {};
  const images = (d.images ?? []).filter((u): u is string => typeof u === "string");
  if (images.length === 0) {
    // tikwm resolves videos fine — no images means it's genuinely not a
    // slideshow, which is a USER-facing outcome, not a resolver failure.
    throw new ReferenceError(
      "That post is a video, not a photo slideshow.",
      "not_photo_post",
    );
  }
  return {
    author: d.author?.unique_id ?? null,
    desc: d.title ?? "",
    slideCount: images.length,
    views: d.play_count ?? null,
    imageUrls: images.slice(0, MAX_SLIDES),
  };
}

/** ScrapTik nests the post differently per endpoint — unwrap by walking. */
function findAweme(payload: unknown, awemeId: string): Record<string, unknown> | undefined {
  const seen: Record<string, unknown>[] = [];
  const walk = (node: unknown, depth: number): void => {
    if (!node || typeof node !== "object" || depth > 6) return;
    if (Array.isArray(node)) {
      node.forEach((n) => walk(n, depth + 1));
      return;
    }
    const o = node as Record<string, unknown>;
    if (o.aweme_id || o.image_post_info || o.aweme_type != null) seen.push(o);
    Object.values(o).forEach((v) => walk(v, depth + 1));
  };
  walk(payload, 0);
  return (
    seen.find((p) => String(p.aweme_id) === String(awemeId)) ??
    seen.find(
      (p) =>
        ((p.image_post_info as { images?: unknown[] } | undefined)?.images?.length ?? 0) > 0,
    ) ??
    seen[0]
  );
}

async function viaApify(awemeId: string): Promise<ResolvedReference> {
  const token = process.env.APIFY_TOKEN;
  if (!token || token.includes("your_")) throw new Error("APIFY_TOKEN not set");
  const res = await fetch(
    `https://api.apify.com/v2/acts/${ACTOR}/run-sync-get-dataset-items?token=${token}&timeout=120`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ post_awemeId: awemeId }),
      signal: AbortSignal.timeout(120_000),
    },
  );
  if (!res.ok) throw new Error(`Apify HTTP ${res.status}`);
  const post = findAweme(await res.json(), awemeId);
  const rawImages =
    ((post?.image_post_info as { images?: unknown[] } | undefined)?.images ?? []) as {
      display_image?: { url_list?: unknown };
    }[];
  const images = rawImages
    .map((im) => pickDecodable(im?.display_image?.url_list))
    .filter((u): u is string => !!u);
  if (images.length === 0) {
    throw new ReferenceError(
      "That post is a video, not a photo slideshow.",
      "not_photo_post",
    );
  }
  const author = (post?.author as { unique_id?: string } | undefined)?.unique_id ?? null;
  const stats = post?.statistics as { play_count?: number } | undefined;
  return {
    author,
    desc: typeof post?.desc === "string" ? post.desc : "",
    slideCount: images.length,
    views: stats?.play_count ?? null,
    imageUrls: images.slice(0, MAX_SLIDES),
  };
}

export async function resolveReference(rawUrl: string): Promise<ResolvedReference> {
  if (!isTikTokUrl(rawUrl)) {
    throw new ReferenceError("Not a TikTok link.", "not_tiktok");
  }
  const { awemeId } = parseTarget(rawUrl);
  let lastErr: unknown;
  try {
    return await viaTikwm(rawUrl);
  } catch (e) {
    if (e instanceof ReferenceError) throw e; // "it's a video" is final
    lastErr = e;
  }
  if (awemeId) {
    try {
      return await viaApify(awemeId);
    } catch (e) {
      if (e instanceof ReferenceError) throw e;
      lastErr = e;
    }
  }
  console.warn("[reference] all resolvers failed:", lastErr);
  throw new ReferenceError(
    "Couldn't read that TikTok post right now.",
    "unreachable",
  );
}

const ANALYSIS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["hookType", "hookText", "anatomy"],
  properties: {
    hookType: { type: "string" },
    hookText: { type: "string" },
    anatomy: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["slides", "beat"],
        properties: {
          slides: { type: "string" },
          beat: { type: "string" },
        },
      },
    },
  },
} as const;

const ANALYSIS_SYSTEM = `You reverse-engineer the FORMAT of a viral TikTok photo slideshow from its slides, so a different creator can apply the same mechanic to their own subject.

You will see the slides in swipe order. Return:
- "hookType": the format in 1-3 words, e.g. "gatekeep listicle", "before and after", "hot take", "story time".
- "hookText": slide 1's overlay text, transcribed EXACTLY as written (casing, slang, typos kept). "" if slide 1 has no text.
- "anatomy": one entry per structural beat, covering every slide. "slides" is the range ("1", "2-5", "6"). "beat" describes the JOB that slide does and HOW its caption works — register, length, whether it names numbers/prices/steps — in under 15 words. Describe the mechanic, never the subject: "lists a concrete protocol with sets and reps" not "talks about chest day".

The point is transferability: someone posting about a completely different topic should be able to follow your anatomy and land the same effect. Ignore the subject matter entirely — no product names, no niche words in beats.`;

/** Longest edge we send — at detail:"low" the model boxes to 512px anyway. */
const SEND_PX = 512;

/**
 * Download + downscale one slide to a base64 data URL. Sent as base64 rather
 * than by URL for the same reason lib/trend-slide-text.ts does it: our fetch
 * reaches the TikTok CDN, but OpenAI's fetcher against signed, referer-checked
 * CDN links gets refused — passing the URLs through is what made every real
 * reference fail with "couldn't make sense of that post's slides" (2026-08-09).
 */
async function slideToDataUrl(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA },
      signal: AbortSignal.timeout(10_000),
      cache: "no-store",
    });
    if (!res.ok) return null;
    const { default: sharp } = await import("sharp");
    const jpeg = await sharp(Buffer.from(await res.arrayBuffer()))
      .resize({ width: SEND_PX, height: SEND_PX, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 80 })
      .toBuffer();
    return `data:image/jpeg;base64,${jpeg.toString("base64")}`;
  } catch {
    return null;
  }
}

/** One vision call: transcribe + distill. Throws ReferenceError on failure. */
export async function analyzeReference(
  ref: ResolvedReference,
): Promise<ReferenceAnalysis> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || apiKey.includes("REPLACE_ME")) {
    throw new ReferenceError("Analysis is not configured.", "analysis_failed");
  }
  const { default: OpenAI } = await import("openai");
  const openai = new OpenAI({ apiKey, timeout: 60_000, maxRetries: 1 });

  const images = (await Promise.all(ref.imageUrls.map(slideToDataUrl))).filter(
    (d): d is string => d !== null,
  );
  if (images.length === 0) {
    throw new ReferenceError(
      "Couldn't read that TikTok post right now.",
      "unreachable",
      `all ${ref.imageUrls.length} slide downloads failed`,
    );
  }

  try {
    const res = await openai.chat.completions.create({
      model: VISION_MODEL,
      messages: [
        { role: "system", content: ANALYSIS_SYSTEM },
        {
          role: "user",
          content: [
            {
              type: "text" as const,
              text:
                `${images.length} slides, in swipe order.` +
                (ref.desc ? ` Post description: ${ref.desc.slice(0, 200)}` : ""),
            },
            ...images.map((url) => ({
              type: "image_url" as const,
              image_url: { url, detail: DETAIL },
            })),
          ],
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: { name: "reference_format", strict: true, schema: ANALYSIS_SCHEMA },
      },
    });
    const parsed = JSON.parse(res.choices[0]?.message?.content ?? "{}") as {
      hookType?: string;
      hookText?: string;
      anatomy?: { slides: string; beat: string }[];
    };
    const hookText = parsed.hookText?.trim() || null;
    const format: FormatBlueprint = {
      hookType: parsed.hookType?.trim().slice(0, 40) || null,
      // The reference's own hook is the strongest style exemplar available —
      // same field remix uses for the trend's caption.
      exemplarCaption: hookText?.slice(0, 300) ?? null,
      anatomy:
        parsed.anatomy
          ?.slice(0, 6)
          .map((b) => ({
            slides: String(b.slides).slice(0, 12),
            beat: String(b.beat).slice(0, 120),
          }))
          .filter((b) => b.slides && b.beat) ?? null,
    };
    if (!format.hookType && !format.anatomy?.length) {
      throw new Error("empty analysis");
    }
    return {
      format,
      slideCount: ref.slideCount,
      author: ref.author,
      views: ref.views,
      hookText,
    };
  } catch (e) {
    console.warn("[reference] analysis failed:", e);
    throw new ReferenceError(
      "Couldn't make sense of that post's slides.",
      "analysis_failed",
      e instanceof Error ? e.message : String(e),
    );
  }
}
