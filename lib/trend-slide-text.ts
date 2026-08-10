// SERVER-ONLY. Transcribes the text baked into trend slideshow images.
//
// The most valuable field in `trending_posts` is the one TikTok's API never
// returns: the on-slide caption. `title` holds the video DESCRIPTION (the text
// under the post), which is hashtag soup a third of the time. The hook that
// actually stopped the scroll is white text rendered into slide 1's JPEG.
//
// We already scrape those JPEGs — `raw.slideshowImageLinks` has been stored on
// every row since the ScrapTik switch and never read. A vision pass over them
// turns the trend feed into a live corpus of real hooks in our exact medium,
// which is what lib/generate/viralExamples.ts is hand-transcribed to
// approximate ("there is no scrapeable corpus of on-slide text").
//
// Fails OPEN at every level: a slide that won't download, a post that won't
// transcribe, or a missing OPENAI_API_KEY all leave `slide_texts` null, and
// every consumer falls back to the description exactly as before.

/** The shape this module needs from a row. `TrendingRow` satisfies it. */
export interface TranscribableRow {
  id: string;
  views: number;
  raw?: { slideshowImageLinks?: unknown[] } | null;
}

// Slide 1 is the hook and carries most of the value; 2-3 teach deck structure
// (the burstiness problem in docs/anti-ai-voice.md). Past that we'd be paying
// to transcribe the tail of 20-slide photo dumps.
const MAX_SLIDES = Number(process.env.TRENDS_OCR_MAX_SLIDES) || 6;
const MAX_ROWS = Number(process.env.TRENDS_OCR_MAX_ROWS) || 600;
const CONCURRENCY = Number(process.env.TRENDS_OCR_CONCURRENCY) || 6;
// The cron route budgets 300s total and the scrape already claims most of it.
// Workers stop taking new posts at this mark: a partial corpus beats a timeout
// that loses the whole refresh (same trade as RUN_BUDGET_MS in lib/trends.ts).
const BUDGET_MS = Number(process.env.TRENDS_OCR_BUDGET_MS) || 60_000;
// Longest edge we send. At detail:"low" the model sees a 512px-boxed image
// regardless, so anything larger is pure upload cost.
const SEND_PX = 512;
const MAX_CAPTION_CHARS = 300;

// "low" is 85 image tokens on gpt-4o (~$0.0002/slide) and reads the large,
// high-contrast overlay text these posts use. It is DELIBERATELY a knob and not
// a constant: if transcriptions come back garbled on a niche with smaller or
// busier type, flip to "high" without a deploy. (gpt-4o-mini is not the cheaper
// option here — it bills 2833 tokens for the same low-detail image, so it costs
// ~2x gpt-4o and reads stylized type worse.)
const DETAIL: "low" | "high" =
  process.env.TRENDS_OCR_DETAIL === "high" ? "high" : "low";

const SYSTEM = `You transcribe the text baked into TikTok photo-mode slides. This is a TRANSCRIPTION task, not a writing task — you are a pair of eyes, not an editor.

Copy what the slide says, character for character:
- Keep the creator's casing. They type in lowercase; do not capitalize anything they didn't.
- Keep their spelling, slang, abbreviations, missing apostrophes and typos. "u", "dont", "tryna" stay exactly as written.
- Do not add punctuation the slide does not have. Do not rephrase, summarize, expand, tidy or translate.
- Join separate lines of one caption with a single space.

Ignore everything that is not the creator's overlay caption: the @handle and profile name, the follow button, like/comment/share/bookmark counts, the music ticker, slide counters like "1/8", app watermarks (TikTok, CapCut, Canva), and text that is part of the photographed scene itself (shop signs, product labels, clothing prints, a phone screen in the shot).

Return "" for a slide with no overlay caption. Return exactly one entry per image, in the order the images were given.`;

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["texts"],
  properties: {
    texts: { type: "array", items: { type: "string" } },
  },
} as const;

/* ── slide URL extraction ─────────────────────────────────────────────────── */

// OpenAI's vision endpoint accepts png/jpeg/webp/gif only, and TikTok pairs a
// HEIC variant with a JPEG one inside the same url_list (the same trap
// pickDecodableUrl guards against for sharp in lib/trends.ts). Prefer an
// explicit decodable extension; many signed CDN URLs carry none, so fall back
// to anything not obviously HEIC rather than dropping the slide.
function pickUrl(list: unknown): string | null {
  if (!Array.isArray(list)) return null;
  const urls = list.filter(
    (u): u is string => typeof u === "string" && /^https?:\/\//.test(u),
  );
  return (
    urls.find((u) => /\.(jpe?g|webp|png)(\?|$)/i.test(u)) ??
    urls.find((u) => !/\.(heic|heif|avif)(\?|$)/i.test(u)) ??
    null
  );
}

// slideshowImageLinks is `unknown[]` because the two providers disagree:
// ScrapTik stores TikTok's aweme `{display_image:{url_list}}`, clockworks has
// shipped bare strings and `{url}` objects across versions. Probe each shape.
function oneSlideUrl(link: unknown): string | null {
  if (typeof link === "string") return pickUrl([link]);
  if (!link || typeof link !== "object") return null;
  const l = link as {
    display_image?: { url_list?: unknown };
    url_list?: unknown;
    url?: unknown;
    downloadLink?: unknown;
  };
  return (
    pickUrl(l.display_image?.url_list) ??
    pickUrl(l.url_list) ??
    pickUrl([l.url]) ??
    pickUrl([l.downloadLink])
  );
}

export function slideUrls(row: TranscribableRow, max = MAX_SLIDES): string[] {
  const links = row.raw?.slideshowImageLinks;
  if (!Array.isArray(links)) return [];
  const urls: string[] = [];
  for (const link of links) {
    const u = oneSlideUrl(link);
    if (u) urls.push(u);
    if (urls.length >= max) break;
  }
  return urls;
}

/* ── transcription ────────────────────────────────────────────────────────── */

// Sent as base64 rather than by URL: we know our own fetch reaches the TikTok
// CDN (it is how covers are cached), whereas OpenAI's fetcher against signed,
// expiring, referer-checked CDN links is not something to bet a run on.
async function toDataUrl(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(10_000),
      cache: "no-store",
    });
    if (!res.ok) return null;
    const { default: sharp } = await import("sharp");
    const jpeg = await sharp(Buffer.from(await res.arrayBuffer()))
      .resize({
        width: SEND_PX,
        height: SEND_PX,
        fit: "inside",
        withoutEnlargement: true,
      })
      .jpeg({ quality: 80 })
      .toBuffer();
    return `data:image/jpeg;base64,${jpeg.toString("base64")}`;
  } catch {
    return null;
  }
}

type OpenAIClient = InstanceType<typeof import("openai").default>;

async function transcribeOne(
  openai: OpenAIClient,
  row: TranscribableRow,
): Promise<string[] | null> {
  const urls = slideUrls(row);
  if (urls.length === 0) return null;

  const images = (await Promise.all(urls.map(toDataUrl))).filter(
    (d): d is string => d !== null,
  );
  if (images.length === 0) return null;

  const completion = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [
      { role: "system", content: SYSTEM },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: `Transcribe these ${images.length} slides, in order.`,
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
      json_schema: { name: "slide_texts", strict: true, schema: SCHEMA },
    },
  });

  const parsed = JSON.parse(
    completion.choices[0]?.message?.content ?? "{}",
  ) as { texts?: unknown };
  const raw = parsed.texts;
  if (!Array.isArray(raw)) return null;

  // Pin the length to the images we actually sent, so a model that drops or
  // invents an entry can't silently shift every caption onto the wrong slide.
  const texts = Array.from({ length: images.length }, (_, i) =>
    String(raw[i] ?? "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, MAX_CAPTION_CHARS),
  );
  // Returned even when every entry is "" — that is a real answer ("this deck
  // has no overlay text"), not a failure, and the caller persists it so the
  // post is never paid for twice. Genuine failures above return null instead
  // and stay eligible: a post whose images 403'd today (TikTok's signed CDN
  // URLs expire in ~a day) can be transcribed on a later run that re-scrapes it
  // with fresh links. null = never successfully attempted; [] = nothing there.
  return texts;
}

/**
 * Transcribes on-slide text for each row, newest-and-biggest first.
 * Returns id → per-slide text. Rows absent from the map keep `slide_texts`
 * null; callers must treat that as "fall back to the description".
 */
export async function transcribeSlideTexts(
  rows: TranscribableRow[],
  deadlineAt = Date.now() + BUDGET_MS,
): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  const apiKey = process.env.OPENAI_API_KEY;
  if (rows.length === 0 || !apiKey || apiKey.includes("REPLACE_ME")) return out;

  const { default: OpenAI } = await import("openai");
  const openai = new OpenAI({ apiKey, timeout: 60_000, maxRetries: 1 });

  // Biggest posts first: if the cap or the clock bites, the rows that reach the
  // top of the feed — and therefore the copy model — are the transcribed ones.
  const queue = [...rows]
    .filter((r) => slideUrls(r).length > 0)
    .sort((a, b) => b.views - a.views)
    .slice(0, MAX_ROWS);
  const total = queue.length;
  let failed = 0;

  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, queue.length) }, () =>
      (async () => {
        for (;;) {
          if (Date.now() > deadlineAt) return;
          const row = queue.shift();
          if (!row) return;
          try {
            const texts = await transcribeOne(openai, row);
            if (texts) out.set(row.id, texts);
          } catch {
            failed++; // fail open: this post keeps slide_texts null
          }
        }
      })(),
    ),
  );

  const skipped = queue.length;
  if (failed || skipped) {
    console.warn(
      `[trends] slide-text pass: transcribed ${out.size}/${total}` +
        (failed ? `, ${failed} failed` : "") +
        (skipped ? `, ${skipped} left after the ${BUDGET_MS}ms budget` : ""),
    );
  }
  return out;
}
