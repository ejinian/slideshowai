import OpenAI from "openai";
import sharp from "sharp";
import { createAdminClient } from "@/utils/supabase/admin";
import type { RunLogger } from "./diagnostics";

// Live, on-demand stock sourcing for the LIBRARY/stock flow. Instead of matching
// captions against a frozen offline pool (which may lack the exact subject — e.g.
// no bench-press photos in the "gym" collection), we search Pexels AT RUNTIME
// with each slide's own keywords, then let a vision judge pick the result that
// actually DEPICTS the caption — or flag "none fit" (-1) so the caller can
// escalate to AI generation. Pexels is license-clean for commercial posts.

const PER_SLIDE = 4; // Pexels results per slide shown to the judge
const AESTHETIC_EXTRA = 2; // extra results from the "<subject> aesthetic" query variant
const PINTEREST_PER_SLIDE = 3; // curated-pool candidates per slide
const THUMB_W = 448;
const DL_CONCURRENCY = 8;

export interface LiveIntent {
  caption: string;
  keywords: string[];
}

export interface LiveResult {
  /** vision-approved photo that depicts the caption, or null (no good fit). */
  approved: Buffer | null;
  /** best-effort top Pexels result, used when AI-gen isn't available. */
  fallback: Buffer | null;
}

interface Cand {
  url: string;
  buf?: Buffer;
  thumb?: string;
  /** "pinterest" = curated aesthetic pool (own storage); else live Pexels. */
  origin: "pexels" | "pinterest";
}

/* ── Curated aesthetic pool (Pinterest ingest, scripts/ingest-pinterest.mjs) ──
   These live in our own `library` bucket, so candidates cost nothing to fetch.
   Vibe over subject: keyword-matched rows first, random pool fills the rest —
   the strict judge still decides whether one actually fits the caption. */

interface PoolRow {
  url: string;
  alt: string | null;
  query: string | null;
}

async function pinterestPool(collection: string | undefined): Promise<PoolRow[]> {
  if (!collection || collection === "other") return [];
  try {
    const admin = createAdminClient();
    const { data } = await admin
      .from("library_images")
      .select("url, alt, query")
      .eq("collection", collection)
      .eq("source", "pinterest")
      .limit(400);
    return (data as PoolRow[] | null) ?? [];
  } catch {
    return [];
  }
}

function poolCandidates(pool: PoolRow[], intent: LiveIntent): string[] {
  if (pool.length === 0) return [];
  const kw = (intent.keywords ?? []).map((k) => k.toLowerCase()).filter(Boolean);
  const matches = pool.filter((r) => {
    const hay = `${r.alt ?? ""} ${r.query ?? ""}`.toLowerCase();
    return kw.some((k) => hay.includes(k));
  });
  const picked: string[] = matches.slice(0, PINTEREST_PER_SLIDE).map((r) => r.url);
  // Fill with random pool picks so vibe slides (hooks/CTAs, no keyword hits)
  // still see the aesthetic pool.
  while (picked.length < PINTEREST_PER_SLIDE && picked.length < pool.length) {
    const r = pool[Math.floor(Math.random() * pool.length)];
    if (!picked.includes(r.url)) picked.push(r.url);
  }
  return picked;
}

function slideQuery(intent: LiveIntent, niche: string): string {
  const kw = (intent.keywords ?? []).map((k) => k.trim()).filter(Boolean);
  // The first 1-2 keywords are the concrete subject (e.g. "incline dumbbell
  // press"); that's the best Pexels query. Fall back to the niche.
  return kw.slice(0, 2).join(" ") || niche || "lifestyle";
}

async function pexelsSearch(query: string): Promise<string[]> {
  const key = process.env.PEXELS_API_KEY;
  if (!key) return [];
  try {
    const res = await fetch(
      `https://api.pexels.com/v1/search?query=${encodeURIComponent(
        query,
      )}&orientation=portrait&per_page=${PER_SLIDE}`,
      { headers: { Authorization: key }, signal: AbortSignal.timeout(12_000) },
    );
    if (!res.ok) return [];
    const json = (await res.json()) as {
      photos?: { src?: { large2x?: string; large?: string; portrait?: string } }[];
    };
    return (json.photos ?? [])
      .map((p) => p.src?.large2x || p.src?.large || p.src?.portrait || "")
      .filter(Boolean);
  } catch {
    return [];
  }
}

async function downloadAll(urls: string[]): Promise<Map<string, Buffer>> {
  const out = new Map<string, Buffer>();
  const queue = [...new Set(urls)];
  await Promise.all(
    Array.from({ length: DL_CONCURRENCY }, async () => {
      for (;;) {
        const url = queue.shift();
        if (!url) return;
        try {
          const r = await fetch(url, { signal: AbortSignal.timeout(15_000) });
          if (r.ok) out.set(url, Buffer.from(await r.arrayBuffer()));
        } catch {
          /* skip */
        }
      }
    }),
  );
  return out;
}

async function thumbnail(buf: Buffer): Promise<string | null> {
  try {
    const o = await sharp(buf)
      .resize({ width: THUMB_W, withoutEnlargement: true })
      .jpeg({ quality: 64 })
      .toBuffer();
    return `data:image/jpeg;base64,${o.toString("base64")}`;
  } catch {
    return null;
  }
}

const SYSTEM =
  "You are a TikTok art director. For each slide you get its caption and a few " +
  "candidate photos. Return, per slide, the candidate that best fits.\n" +
  "• If the caption names a SPECIFIC subject (an exercise, dish, product, place — " +
  "e.g. 'incline dumbbell press', 'cable fly'), the photo MUST genuinely depict " +
  "that subject. A random on-theme shot (any gym photo) is NOT a match — return " +
  "-1 if none actually show it.\n" +
  "• If the caption is a GENERIC hook or call-to-action with no specific subject " +
  "(e.g. '3 exercises you haven't tried', 'follow for more'), any strong on-theme " +
  "photo is fine — pick the best one, don't return -1.\n" +
  "• Candidates marked (curated) come from a hand-picked aesthetic pool with the " +
  "candid, non-stocky look that performs on TikTok — when a curated candidate and " +
  "a stock one fit the caption equally well, prefer the curated one.\n" +
  "Return -1 only when a specific subject genuinely isn't depicted by any candidate.";

const PICKS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["picks"],
  properties: { picks: { type: "array", items: { type: "integer" } } },
} as const;

/**
 * For each slide, search Pexels with its keywords and have a vision judge pick
 * the result that depicts the caption (or flag -1 = generate instead). Returns
 * null when PEXELS_API_KEY is absent so the caller falls back to the library.
 * `slideshows` is parallel to the requested decks (usually one).
 */
export async function selectLiveBackgrounds(
  slideshows: LiveIntent[][],
  niche: string,
  collection?: string,
  diag?: RunLogger | null,
): Promise<LiveResult[][] | null> {
  if (!process.env.PEXELS_API_KEY) {
    if (diag) {
      await diag.text(
        "04_stock_selection.txt",
        "PEXELS_API_KEY absent — live sourcing skipped, fell back to the frozen library (imageSelection.ts).",
      );
    }
    return null;
  }

  // 1) Per slide, in parallel: the subject query, an "<subject> aesthetic"
  //    variant (de-stockifies results), and curated-pool picks.
  const flat: { ss: number; i: number; intent: LiveIntent }[] = [];
  slideshows.forEach((slides, ss) =>
    slides.forEach((intent, i) => flat.push({ ss, i, intent })),
  );
  const pool = await pinterestPool(collection);
  const perSlide = await Promise.all(
    flat.map(async (f) => {
      const q = slideQuery(f.intent, niche);
      const [plain, aesthetic] = await Promise.all([
        pexelsSearch(q),
        pexelsSearch(`${q} aesthetic`),
      ]);
      const pexels = [
        ...plain,
        ...aesthetic.filter((u) => !plain.includes(u)).slice(0, AESTHETIC_EXTRA),
      ];
      return { pexels, pinterest: poolCandidates(pool, f.intent) };
    }),
  );

  // 2) Download every candidate once.
  const downloaded = await downloadAll(
    perSlide.flatMap((s) => [...s.pinterest, ...s.pexels]),
  );
  // Curated pool first: when two candidates fit equally, the judge's pick
  // order naturally favors the aesthetic pool.
  const candsPerSlide: Cand[][] = perSlide.map((s) =>
    [
      ...s.pinterest.map((u) => ({ url: u, origin: "pinterest" as const })),
      ...s.pexels.map((u) => ({ url: u, origin: "pexels" as const })),
    ]
      .filter((c) => downloaded.has(c.url))
      .map((c) => ({ ...c, buf: downloaded.get(c.url) as Buffer })),
  );

  // 3) Thumbnail candidates for the judge.
  await Promise.all(
    candsPerSlide.flat().map(async (c) => {
      c.thumb = (await thumbnail(c.buf as Buffer)) ?? undefined;
    }),
  );

  // 4) One vision call judges every slide's candidates.
  const picks = await judge(flat, candsPerSlide);

  // 5) Assemble.
  const results: LiveResult[][] = slideshows.map((slides) =>
    slides.map(() => ({ approved: null, fallback: null }) as LiveResult),
  );
  const audit: unknown[] = [];
  flat.forEach((f, idx) => {
    const cands = candsPerSlide[idx].filter((c) => c.thumb);
    // Fallback stays the top PEXELS result: for a rejected specific subject,
    // "closest stock match" beats "random aesthetic shot".
    const firstPexels = cands.find((c) => c.origin === "pexels") ?? cands[0];
    const fallback = firstPexels?.buf ?? candsPerSlide[idx][0]?.buf ?? null;
    const p = picks[idx];
    const approved =
      p != null && p >= 0 && p < cands.length ? (cands[p].buf ?? null) : null;
    results[f.ss][f.i] = { approved, fallback };
    audit.push({
      slideshow: f.ss,
      slide: f.i,
      caption: f.intent.caption,
      keywords: f.intent.keywords,
      pexelsQuery: slideQuery(f.intent, niche),
      candidatesReturned: candsPerSlide[idx].length,
      candidates: cands.map((c) => `[${c.origin}] ${c.url}`),
      judgePick: p,
      verdict:
        p < 0
          ? "NO CANDIDATE DEPICTS THE CAPTION → used best-effort fallback"
          : `approved candidate #${p} (${cands[p]?.origin ?? "?"})`,
      imageUsed: approved ? cands[p]?.url : (firstPexels?.url ?? null),
    });
  });
  if (diag) {
    await diag.json("04_stock_selection.json", audit);
  }
  return results;
}

async function judge(
  flat: { intent: LiveIntent }[],
  candsPerSlide: Cand[][],
): Promise<number[]> {
  const apiKey = process.env.OPENAI_API_KEY;
  const noJudge = flat.map(() => 0); // default: take Pexels' top result
  if (!apiKey || apiKey.includes("REPLACE_ME")) return noJudge;

  const content: Array<
    | { type: "text"; text: string }
    | { type: "image_url"; image_url: { url: string; detail: "low" } }
  > = [];
  flat.forEach((f, g) => {
    const cands = candsPerSlide[g].filter((c) => c.thumb);
    content.push({
      type: "text",
      text: `Slide ${g} — caption: "${f.intent.caption}". Candidates:`,
    });
    cands.forEach((c, ci) => {
      content.push({
        type: "text",
        text: `${g}.${ci}${c.origin === "pinterest" ? " (curated)" : ""}:`,
      });
      content.push({ type: "image_url", image_url: { url: c.thumb as string, detail: "low" } });
    });
  });
  content.push({
    type: "text",
    text:
      "Return picks: one entry per slide in order (slide 0.." +
      `${flat.length - 1}), each the candidate index that truly depicts that ` +
      "slide's caption, or -1 if none do.",
  });

  try {
    const openai = new OpenAI({ apiKey, timeout: 35_000, maxRetries: 0 });
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
    ) as { picks?: number[] };
    const picks = parsed.picks ?? [];
    return flat.map((_, g) => (Number.isInteger(picks[g]) ? picks[g] : 0));
  } catch {
    return noJudge;
  }
}
