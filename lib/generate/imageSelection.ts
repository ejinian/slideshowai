import type { SupabaseClient } from "@supabase/supabase-js";
import sharp from "sharp";

// Caption-aware background selection from the `library_images` table.
//
// Strategy ladder (each rung degrades gracefully to the next):
//   1. "vision"   — one gpt-4o vision call that actually SEES thumbnails of the
//                   candidates and matches each slide to a photo (best relevance;
//                   can reject fake-looking staged stock that text can't detect).
//   2. "llm"      — one gpt-4o-mini call matches by alt/query TEXT metadata only.
//   3. "keywords" — deterministic token-overlap scoring (no API call).
//   4. "random"   — pre-metadata behavior (rows lack alt/query, e.g. the
//                   20260714100000 migration/backfill hasn't run yet).
//
// Within a slideshow no image is ever used twice; across slideshows of the
// same request reuse is allowed (they're independent posts).

const CANDIDATE_POOL = 120; // rows offered to the text ranker
const VISION_POOL = 12; // candidates actually shown to the vision model
const THUMB_W = 384; // thumbnail width sent to vision (keeps tokens/latency low)
const FETCH_CONCURRENCY = 8;
const MIN_SOURCE_W = 1080; // quality floor (matches scripts/ingest-library.mjs)
const MIN_SOURCE_H = 1440;

export interface SlideIntent {
  caption: string;
  keywords: string[];
}

export interface SelectedBackgrounds {
  /** buffers[ssIdx][slideIdx] — parallel to the requested slideshows. */
  buffers: Buffer[][];
  strategy: "vision" | "llm" | "keywords" | "random";
}

// Shared JSON schema for both rankers: per-slideshow list of candidate indices.
const PICKS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["slideshows"],
  properties: {
    slideshows: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["picks"],
        properties: { picks: { type: "array", items: { type: "integer" } } },
      },
    },
  },
} as const;

interface Candidate {
  url: string;
  alt: string;
  query: string;
}

function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

const tokenize = (s: string): Set<string> =>
  new Set(
    s
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2)
      .map((w) => w.replace(/s$/, "")),
  );

// Deterministic fallback: keyword overlap (LLM keywords weighted over caption
// prose), greedy per slide, no reuse within a slideshow.
function rankByKeywords(slides: SlideIntent[], candidates: Candidate[]): number[] {
  const candTokens = candidates.map((c) => tokenize(`${c.alt} ${c.query}`));
  const used = new Set<number>();
  return slides.map((slide) => {
    const kw = tokenize(slide.keywords.join(" "));
    const cap = tokenize(slide.caption);
    let best = -1;
    let bestScore = -1;
    for (let i = 0; i < candidates.length; i++) {
      if (used.has(i)) continue;
      let score = Math.random() * 0.5; // tie-break jitter
      for (const t of candTokens[i]) {
        if (kw.has(t)) score += 2;
        else if (cap.has(t)) score += 1;
      }
      if (score > bestScore) {
        bestScore = score;
        best = i;
      }
    }
    if (best === -1) best = Math.floor(Math.random() * candidates.length);
    used.add(best);
    return best;
  });
}

// One cheap LLM call assigns every slide (across all slideshows) its best
// candidate. Falls back to keyword ranking on any failure.
async function rankByLlm(
  slideshows: SlideIntent[][],
  candidates: Candidate[],
): Promise<number[][] | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || apiKey.includes("REPLACE_ME")) return null;

  const SYSTEM =
    "You match TikTok slideshow captions to background photos. You get a numbered " +
    "list of candidate photos (their descriptions and the search query that found " +
    "them) and one or more slideshows, each a list of slides with a caption and " +
    "desired visual keywords.\n" +
    "For each slideshow return picks: one candidate NUMBER per slide, in slide " +
    "order. Rules: the photo must visually fit the slide's message and keywords; " +
    "prefer candid, atmospheric, real-scene photos; AVOID anything that reads as " +
    "staged studio stock (white/plain backgrounds, posed models looking at camera, " +
    "isolated product shots) unless the slide explicitly calls for it; never repeat " +
    "a candidate within the same slideshow.";

  try {
    const { default: OpenAI } = await import("openai");
    const openai = new OpenAI({ apiKey, timeout: 25_000, maxRetries: 0 });
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: SYSTEM },
        {
          role: "user",
          content: JSON.stringify({
            candidates: candidates.map((c, i) => ({
              n: i,
              description: c.alt || undefined,
              found_by_search: c.query || undefined,
            })),
            slideshows: slideshows.map((slides) => ({
              slides: slides.map((s) => ({
                caption: s.caption,
                keywords: s.keywords,
              })),
            })),
          }),
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: { name: "picks", strict: true, schema: PICKS_SCHEMA },
      },
    });
    const parsed = JSON.parse(
      completion.choices[0]?.message?.content ?? "{}",
    ) as { slideshows?: { picks?: number[] }[] };

    // Validate shape; repair bad/duplicate picks with unused candidates.
    return slideshows.map((slides, ssIdx) => {
      const picks = parsed.slideshows?.[ssIdx]?.picks ?? [];
      const used = new Set<number>();
      return slides.map((_, i) => {
        let p = picks[i];
        if (!Number.isInteger(p) || p < 0 || p >= candidates.length || used.has(p)) {
          p = candidates.findIndex((_, ci) => !used.has(ci));
          if (p === -1) p = Math.floor(Math.random() * candidates.length);
        }
        used.add(p);
        return p;
      });
    });
  } catch {
    return null; // fall back to keyword ranking
  }
}

// Choose which candidates the vision model sees: prefer keyword-relevant photos
// (once alt/query metadata is backfilled), else a random slice (the pool is
// pre-shuffled). This surfaces the most on-topic images the library actually
// has — so a "bench press" slide gets shown weights, not random treadmills —
// instead of a blind random 12.
function pickVisionCandidates(
  pool: Candidate[],
  slideshows: SlideIntent[][],
  count: number,
): Candidate[] {
  if (pool.length <= count) return pool;
  const want = new Set<string>();
  for (const ss of slideshows)
    for (const s of ss) {
      for (const t of tokenize(s.keywords.join(" "))) want.add(t);
      for (const t of tokenize(s.caption)) want.add(t);
    }
  const anyMeta = pool.some((c) => c.alt || c.query);
  if (!anyMeta || want.size === 0) return pool.slice(0, count);
  return pool
    .map((c) => {
      const ct = tokenize(`${c.alt} ${c.query}`);
      let score = 0;
      for (const t of ct) if (want.has(t)) score++;
      return { c, score: score + Math.random() * 0.4 }; // jitter for diversity
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, count)
    .map((x) => x.c);
}

// Downscale candidate buffers to small JPEG data URLs for the vision call.
// Returns null per buffer that fails to decode (skipped as a candidate).
async function makeThumbnails(buffers: Buffer[]): Promise<(string | null)[]> {
  return Promise.all(
    buffers.map(async (b) => {
      try {
        const out = await sharp(b)
          .resize({ width: THUMB_W, withoutEnlargement: true })
          .jpeg({ quality: 62 })
          .toBuffer();
        return `data:image/jpeg;base64,${out.toString("base64")}`;
      } catch {
        return null;
      }
    }),
  );
}

// Repair a raw picks array into valid, in-range, no-repeat indices over `size`.
function repairPicks(raw: number[], count: number, size: number): number[] {
  const used = new Set<number>();
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    let p = raw[i];
    if (!Number.isInteger(p) || p < 0 || p >= size || used.has(p)) {
      p = -1;
      for (let c = 0; c < size; c++) {
        if (!used.has(c)) {
          p = c;
          break;
        }
      }
      if (p === -1) p = i % size; // more slides than candidates — allow reuse
    }
    used.add(p);
    out.push(p);
  }
  return out;
}

// Top rung: one gpt-4o vision call that SEES thumbnails of the candidate photos
// and assigns each slide its best image, honoring viral-slideshow anatomy (the
// hook slide gets the most scroll-stopping photo) and rejecting fake-looking
// staged stock. Returns indices into `candBuffers`, or null to fall back.
async function rankByVision(
  slideshows: SlideIntent[][],
  candBuffers: Buffer[],
): Promise<number[][] | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || apiKey.includes("REPLACE_ME")) return null;

  const thumbs = await makeThumbnails(candBuffers);
  const usable = thumbs
    .map((t, i) => ({ t, i }))
    .filter((x): x is { t: string; i: number } => x.t !== null);
  const slidesPerShow = Math.max(...slideshows.map((s) => s.length), 1);
  if (usable.length < slidesPerShow) return null;

  const SYSTEM =
    "You are an expert TikTok Photo Mode art director. You see a numbered set of " +
    "candidate background PHOTOS, then one or more slideshows (each slide has a " +
    "caption and desired visual keywords). Assign every slide the photo that best " +
    "fits it.\n" +
    "Rules of a viral slideshow you MUST follow:\n" +
    "• The slide marked HOOK is slide 1 and decides everything — give it the single " +
    "most scroll-stopping, visually striking photo in the set.\n" +
    "• Every other slide's photo must visually match that slide's caption/keywords.\n" +
    "• Strongly prefer candid, real-scene, atmospheric photos. REJECT anything that " +
    "looks like fake or staged studio stock — plain white backgrounds, models posed " +
    "smiling at the camera, obvious isolated product shots — unless the caption " +
    "explicitly needs it.\n" +
    "• Never use the same photo twice within one slideshow.\n" +
    "Return picks: for each slideshow, one candidate NUMBER per slide, in slide order.";

  const content: Array<
    | { type: "text"; text: string }
    | { type: "image_url"; image_url: { url: string; detail: "low" } }
  > = [{ type: "text", text: "Candidate photos:" }];
  usable.forEach((u, n) => {
    content.push({ type: "text", text: `Photo ${n}:` });
    content.push({ type: "image_url", image_url: { url: u.t, detail: "low" } });
  });
  content.push({
    type: "text",
    text:
      "Slideshows (assign a Photo number to each slide):\n" +
      JSON.stringify(
        slideshows.map((slides) => ({
          slides: slides.map((s, i) => ({
            position:
              i === 0
                ? "HOOK (slide 1)"
                : i === slides.length - 1
                  ? "CTA (last slide)"
                  : `slide ${i + 1}`,
            caption: s.caption,
            keywords: s.keywords,
          })),
        })),
      ),
  });

  try {
    const { default: OpenAI } = await import("openai");
    const openai = new OpenAI({ apiKey, timeout: 30_000, maxRetries: 0 });
    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content },
      ],
      response_format: {
        type: "json_schema",
        json_schema: { name: "picks", strict: true, schema: PICKS_SCHEMA },
      },
    });
    const parsed = JSON.parse(
      completion.choices[0]?.message?.content ?? "{}",
    ) as { slideshows?: { picks?: number[] }[] };

    // picks index into `usable`; map back to the original candBuffers index.
    return slideshows.map((slides, ssIdx) => {
      const repaired = repairPicks(
        parsed.slideshows?.[ssIdx]?.picks ?? [],
        slides.length,
        usable.length,
      );
      return repaired.map((u) => usable[u].i);
    });
  } catch {
    return null;
  }
}

async function downloadAll(urls: string[]): Promise<Map<string, Buffer>> {
  const out = new Map<string, Buffer>();
  const queue = [...new Set(urls)];
  await Promise.all(
    Array.from({ length: FETCH_CONCURRENCY }, async () => {
      for (;;) {
        const url = queue.shift();
        if (!url) return;
        try {
          const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
          if (res.ok) out.set(url, Buffer.from(await res.arrayBuffer()));
        } catch {
          // tolerated — caller substitutes another candidate
        }
      }
    }),
  );
  return out;
}

/**
 * Pick one background per slide, matched to the slide's caption/keywords.
 * Returns null when the collection has no library rows (caller falls back to
 * the bundled local set).
 */
export async function selectBackgrounds(opts: {
  supabase: SupabaseClient;
  collection: string;
  slideshows: SlideIntent[][];
}): Promise<SelectedBackgrounds | null> {
  let { data, error } = await opts.supabase
    .from("library_images")
    .select("url, alt, query, source_w, source_h")
    .eq("collection", opts.collection)
    .limit(1000);
  if (error) {
    // Metadata columns absent (20260714100000 migration not run yet) — fetch
    // plain urls so behavior degrades to the pre-ranking random selection.
    const plain = await opts.supabase
      .from("library_images")
      .select("url")
      .eq("collection", opts.collection)
      .limit(1000);
    data = (plain.data ?? []).map((r) => ({
      url: (r as { url: string }).url,
      alt: null,
      query: null,
      source_w: null,
      source_h: null,
    })) as typeof data;
    error = plain.error;
  }
  if (error || !data || data.length === 0) return null;

  const slidesPerShow = Math.max(...opts.slideshows.map((s) => s.length), 1);

  // Quality floor — only when metadata exists and enough survive the cut.
  let rows = data as {
    url: string;
    alt: string | null;
    query: string | null;
    source_w: number | null;
    source_h: number | null;
  }[];
  const highRes = rows.filter(
    (r) => (r.source_w ?? 0) >= MIN_SOURCE_W && (r.source_h ?? 0) >= MIN_SOURCE_H,
  );
  if (highRes.length >= slidesPerShow * 3) rows = highRes;

  const pool: Candidate[] = shuffle(
    rows.map((r) => ({ url: r.url, alt: r.alt ?? "", query: r.query ?? "" })),
  ).slice(0, CANDIDATE_POOL);

  // Top rung: vision. Download a small candidate set up front and let gpt-4o
  // actually SEE them. Works even pre-backfill (needs no alt/query — it reads
  // pixels). On success the picked buffers are already in hand, so we return
  // without a second download round.
  const visionCount = Math.min(pool.length, Math.max(VISION_POOL, slidesPerShow + 4));
  const visionCands = pickVisionCandidates(pool, opts.slideshows, visionCount);
  const visionDl = await downloadAll(visionCands.map((c) => c.url));
  const ready = visionCands.filter((c) => visionDl.has(c.url));
  if (ready.length >= slidesPerShow) {
    const readyBufs = ready.map((c) => visionDl.get(c.url) as Buffer);
    const vpicks = await rankByVision(opts.slideshows, readyBufs);
    if (vpicks) {
      return {
        buffers: vpicks.map((idxs) => idxs.map((p) => readyBufs[p])),
        strategy: "vision",
      };
    }
  }

  // Without descriptive metadata (pre-backfill) text ranking is meaningless.
  const withMeta = pool.filter((c) => c.alt || c.query).length;
  let strategy: SelectedBackgrounds["strategy"];
  let picks: number[][];

  if (withMeta < Math.max(slidesPerShow, pool.length * 0.3)) {
    strategy = "random";
    // Pool is pre-shuffled: consecutive slices = distinct random picks.
    picks = opts.slideshows.map((slides, ssIdx) =>
      slides.map((_, i) => (ssIdx * slidesPerShow + i) % pool.length),
    );
  } else {
    const llm = await rankByLlm(opts.slideshows, pool);
    if (llm) {
      strategy = "llm";
      picks = llm;
    } else {
      strategy = "keywords";
      picks = opts.slideshows.map((slides) => rankByKeywords(slides, pool));
    }
  }

  const wanted = picks.flat().map((p) => pool[p].url);
  const downloaded = await downloadAll(wanted);
  // Substitutes for failed downloads: any other pool image we did fetch, else
  // retry-download of unpicked candidates.
  const spareUrls = pool.map((c) => c.url).filter((u) => !downloaded.has(u));
  const spares = await (async () => {
    if (downloaded.size >= new Set(wanted).size) return new Map<string, Buffer>();
    return downloadAll(spareUrls.slice(0, slidesPerShow * 2));
  })();

  const anyBuffer = [...downloaded.values(), ...spares.values()];
  if (anyBuffer.length === 0) return null;

  const buffers = picks.map((idxs) => {
    const used = new Set<string>();
    return idxs.map((p) => {
      const url = pool[p].url;
      let buf = downloaded.get(url);
      if (!buf || used.has(url)) {
        const alt =
          [...downloaded.entries(), ...spares.entries()].find(([u]) => !used.has(u)) ??
          null;
        if (alt) {
          used.add(alt[0]);
          return alt[1];
        }
        buf = anyBuffer[Math.floor(Math.random() * anyBuffer.length)];
        return buf;
      }
      used.add(url);
      return buf;
    });
  });

  return { buffers, strategy };
}
