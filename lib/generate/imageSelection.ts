import type { SupabaseClient } from "@supabase/supabase-js";

// Caption-aware background selection from the `library_images` table.
//
// Strategy ladder (each rung degrades gracefully to the next):
//   1. "llm"      — one gpt-4o-mini call matches every slide to its best
//                   candidate using the library's alt/query metadata.
//   2. "keywords" — deterministic token-overlap scoring (no API call).
//   3. "random"   — pre-metadata behavior (rows lack alt/query, e.g. the
//                   20260714100000 migration/backfill hasn't run yet).
//
// Within a slideshow no image is ever used twice; across slideshows of the
// same request reuse is allowed (they're independent posts).

const CANDIDATE_POOL = 120; // rows offered to the ranker
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
  strategy: "llm" | "keywords" | "random";
}

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

  const SCHEMA = {
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
          properties: {
            picks: { type: "array", items: { type: "integer" } },
          },
        },
      },
    },
  } as const;

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
        json_schema: { name: "picks", strict: true, schema: SCHEMA },
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

  // Without descriptive metadata (pre-backfill) ranking is meaningless.
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
