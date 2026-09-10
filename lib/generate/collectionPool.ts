import type OpenAI from "openai";
import sharp from "sharp";
import { tryCopyModel } from "./copyModel";

// Collection decks are COPY-FIRST (Christian, 2026-08-28) and the collection
// is the ONLY image source (Christian, 2026-09-09: "when the collection is
// selected it should be impossible for any other image to be used"). The
// captions are written by the full listicle machinery from the topic alone,
// then ONE vision call matches every caption against the whole pool (up to
// 60 photos) — hook gets the most scroll-stopping shot, creator-in-action
// beats equipment-only. A caption the matcher can't place still gets a pool
// photo (first unused, then least-used — repeats when the pool is smaller
// than the deck). No audit, no -1, no stock, no AI: there is nowhere else a
// slide is allowed to go. Returns null on total failure so the caller can
// fall back to positional assignment — this can never break a run.
//
// History: 08-27→09-09 ran a collection → stock → AI ladder gated by a
// per-pair audit. It shipped 4-5 of 6 slides on stock under a pick the user
// had just made, and a softer "collection first" variant still leaked one or
// two. Removed outright; the toggle no longer has a say once a pick exists.

// 320px / q60: a 60-photo pool must fit one vision request reliably on Vercel.
// At 384/q68 the call silently failed on production and the deck fell back to
// "photos 0..N in pick order" — the "same first photos every time" complaint.
const THUMB_W = 320;

const MATCH_SYSTEM =
  "You match a TikTok slideshow's captions to the creator's photo collection. " +
  "You get the deck's topic, every caption in order, and the whole pool.\n" +
  "• Per caption, return the pool index of the photo that best accompanies " +
  "it.\n" +
  "• The photo is a BACKDROP the caption must be compatible with, not an " +
  "illustration: the creator's physique or training shot fits training, " +
  "habit, sleep, mindset and results captions (it is their proof). The pool " +
  "is the ONLY image source for this deck — the creator chose it — so pick " +
  "the best-fitting photo for EVERY caption; a backdrop that merely sits " +
  "behind the caption is a match. Return -1 only if literally nothing in the " +
  "pool could sit behind it (it will be filled from the pool anyway).\n" +
  "• Slide 0 is the hook: give it the single most scroll-stopping, on-topic " +
  "photo in the pool.\n" +
  "• Prefer shots of the creator IN ACTION over equipment-only or empty-scene " +
  "shots — a person mid-curl beats dumbbells on the floor for any training " +
  "caption. Equipment/scene shots are a last resort, never an equal choice.\n" +
  "• Never reuse a photo across slides. Skip blurry or accidental shots.\n" +
  "• If a list of RECENTLY USED photos is given, those already appeared in " +
  "this creator's last few posts — pick others unless one is clearly the " +
  "only fit. Their followers should not see the same photos again.\n" +
  "Return one index per caption, in caption order.";

const MATCH_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["picks"],
  properties: {
    picks: {
      type: "array",
      items: { type: "integer" },
      description: "One pool index per caption in order, or -1.",
    },
  },
} as const;

async function thumb(buf: Buffer): Promise<string | null> {
  try {
    const o = await sharp(buf)
      .resize({ width: THUMB_W, withoutEnlargement: true })
      .jpeg({ quality: 60 })
      .toBuffer();
    return `data:image/jpeg;base64,${o.toString("base64")}`;
  } catch {
    return null;
  }
}

export interface PoolMatch {
  /** Per caption: pool photo index. Never -1 — the pool is the only source. */
  assign: number[];
  /** Captions the matcher itself could not place (1-based), for diagnostics;
   *  they were backfilled from the pool. */
  unplaced: number[];
  model: string;
}

/**
 * Every slide comes from the pool, full stop. A -1 from the matcher (or an
 * unassigned slide on matcher failure) takes the first unused pool photo in
 * the user's pick order; once the pool is exhausted, photos repeat, least-used
 * first. Nothing here ever reaches stock or AI.
 */
export function fillGapsFromPool(assign: number[], poolSize: number): number[] {
  if (poolSize <= 0) return assign;
  const uses = new Array<number>(poolSize).fill(0);
  for (const p of assign) if (p >= 0 && p < poolSize) uses[p] += 1;
  return assign.map((p) => {
    if (p >= 0 && p < poolSize) return p;
    let best = 0;
    for (let i = 1; i < poolSize; i++) if (uses[i] < uses[best]) best = i;
    uses[best] += 1;
    return best;
  });
}

/** Matcher-failure fallback: an evenly spread slice of the pool starting at a
 *  random offset, so a failed call still varies the photos between runs
 *  instead of always handing back the first N in pick order. */
export function spreadFallback(count: number, poolSize: number): number[] {
  if (poolSize <= 0) return Array.from({ length: count }, () => -1);
  const step = Math.max(1, Math.floor(poolSize / Math.max(1, count)));
  const offset = Math.floor(Math.random() * poolSize);
  return Array.from({ length: count }, (_v, i) => (offset + i * step) % poolSize);
}

export async function matchPoolToCaptions(
  topic: string,
  captions: { text: string }[],
  images: Buffer[],
  /** Pool indices that appeared in this creator's recent decks (avoid). */
  opts: { recentlyUsed?: number[] } = {},
): Promise<PoolMatch | null> {
  const cm = tryCopyModel({ timeoutMs: 90_000 });
  if (!cm || captions.length === 0 || images.length === 0) return null;

  try {
    const thumbs = await Promise.all(images.map(thumb));

    // ── Pass 1: match every caption against the whole pool ──────────────────
    const content: Array<
      | { type: "text"; text: string }
      | { type: "image_url"; image_url: { url: string; detail: "low" } }
    > = [
      {
        type: "text",
        text:
          `TOPIC of the deck: ${topic || "(none given)"}\n` +
          `Captions, in slide order:\n` +
          captions.map((c, i) => `${i}: "${c.text}"`).join("\n") +
          (opts.recentlyUsed?.length
            ? `\nRECENTLY USED (avoid unless clearly the only fit): photos ${opts.recentlyUsed.join(", ")}.`
            : "") +
          `\nThe creator's ${images.length} photos follow, numbered 0..${images.length - 1}.`,
      },
    ];
    thumbs.forEach((t, i) => {
      content.push({ type: "text", text: `photo ${i}:` });
      if (t) content.push({ type: "image_url", image_url: { url: t, detail: "low" } });
      else content.push({ type: "text", text: "(unreadable)" });
    });

    const completion = await (cm.client as OpenAI).chat.completions.create({
      model: cm.model,
      messages: [
        { role: "system", content: MATCH_SYSTEM },
        { role: "user", content },
      ],
      response_format: {
        type: "json_schema",
        json_schema: { name: "pool_match", strict: true, schema: MATCH_SCHEMA },
      },
    });
    const parsed = JSON.parse(
      completion.choices[0]?.message?.content ?? "{}",
    ) as { picks?: number[] };

    const used = new Set<number>();
    const picked = captions.map((_c, i) => {
      const p = parsed.picks?.[i];
      if (!Number.isInteger(p) || p! < 0 || p! >= images.length || used.has(p!)) {
        return -1;
      }
      used.add(p!);
      return p as number;
    });
    if (picked.every((p) => p < 0)) return null; // total miss → let caller fall back
    // The matcher's -1 is advisory: the pool is the only source, so every
    // unplaced caption takes a pool photo anyway.
    const unplaced = picked.flatMap((p, i) => (p < 0 ? [i + 1] : []));
    const assign = fillGapsFromPool(picked, images.length);

    return { assign, unplaced, model: cm.label };
  } catch (e) {
    // Loud: a silent null here is what produced "the first photos every time".
    console.error("[collection] matcher failed — falling back to a spread", {
      pool: images.length,
      captions: captions.length,
      error: e instanceof Error ? e.message : String(e),
    });
    return null;
  }
}
