// LEAN copy path — the "rules subtract, examples add" experiment (2026-09-09).
//
// The main path (listicle.ts) sends ~24k characters of rules, bans, caps and
// registers, then an editor-judge rewrites slides one at a time. After a
// season of that the decks were still aphorisms ("cardio alone just makes you
// smaller") stitched together with no through-line. This path inverts it:
//
//   1. RETRIEVE the nearest real decks by topic (lib/generate/data/
//      leanExemplars.json — ~320 curated, transcribed viral decks with an
//      inferred topic each; built by scripts/build-lean-exemplars.mjs) and
//      show them WHOLE, as (topic → slides) pairs. The model sees what a real
//      post on a nearby topic actually says, not a description of it.
//   2. GENERATE N whole candidate decks from a ~1.5k-character prompt.
//   3. SELECT one whole deck (gpt-4.1) instead of editing — selection keeps
//      coherence; editing is what produced the frankenstein decks.
//
// Local A/B only: GEN_COPY=lean in .env.local (route.ts). Fine-tuning was the
// first choice and is closed (OpenAI 403 training_not_available); many-shot
// retrieval is the closest substitute. Diagnostics: 02_lean_prompt.txt,
// 03_lean_candidates.json, 03b_lean_pick.json.

import OpenAI from "openai";
import leanSystem from "./leanSystem.json";
import exemplarIndex from "./data/leanExemplars.json";
import { NICHE_TO_TREND } from "./trendExemplars";
import { cleanCaption } from "./cleanCaption";
import type { ListicleSlide } from "./listicle";
import type { RunLogger } from "./diagnostics";

const GEN_MODEL = process.env.LEAN_COPY_MODEL || "gpt-4.1";
const SELECT_MODEL = "gpt-4.1";
const EMBED_MODEL = "text-embedding-3-small";
const K_EXEMPLARS = 6;
const N_CANDIDATES = 4;

interface Exemplar {
  id: string;
  niche: string;
  views: number;
  topic: string;
  texts: string[];
  emb: number[];
}
const INDEX = exemplarIndex as { dims: number; rows: Exemplar[] };

export interface LeanResult {
  deck: ListicleSlide[];
  candidates: string[][];
  pick: number;
  reason: string;
  exemplars: { topic: string; niche: string }[];
  model: string;
}

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}

/** Nearest real decks by topic. Same trend bucket gets a small bonus so a
 *  gym topic prefers gym decks, but a closer topic from another bucket still
 *  wins — the register of the nearest post matters more than the label. */
async function retrieve(
  openai: OpenAI,
  topic: string,
  nicheSlug: string,
  k: number,
): Promise<Exemplar[]> {
  const res = await openai.embeddings.create({
    model: EMBED_MODEL,
    input: topic,
    dimensions: INDEX.dims,
  });
  const q = res.data[0].embedding;
  const bucket = NICHE_TO_TREND[nicheSlug] ?? null;
  return [...INDEX.rows]
    .map((r) => ({ r, s: cosine(q, r.emb) + (bucket && r.niche === bucket ? 0.05 : 0) }))
    .sort((a, b) => b.s - a.s)
    .slice(0, k)
    .map((x) => x.r);
}

function exemplarBlock(rows: Exemplar[]): string {
  return rows
    .map(
      (r, i) =>
        `REAL POST ${i + 1} — topic: ${r.topic}\n` +
        r.texts.map((t, j) => `  slide ${j + 1}: ${t}`).join("\n"),
    )
    .join("\n\n");
}

function buildUser(topic: string, count: number, rows: Exemplar[]): string {
  return (
    `Here are real posts on nearby topics, transcribed slide by slide. Study how ` +
    `specific and plain they are and how each one is ONE person's take with a ` +
    `through-line — then write yours the same way about a different topic. Do not ` +
    `reuse their subjects or wording.\n\n` +
    exemplarBlock(rows) +
    `\n\nTopic: ${topic}\nSlides: ${count}`
  );
}

const SELECT_SYSTEM =
  "You are choosing which of several draft TikTok photo slideshows to post. Pick the " +
  "ONE that reads most like a real creator's post: it knows something concrete " +
  "(numbers, named things, what to actually do), it is one person's take with a " +
  "through-line from the hook to the last slide, it is plain rather than clever, and " +
  "none of it reads as generated (no aphorisms, no 'X isn't just Y', no lecture). " +
  "Judge the deck as a whole, not slide by slide. Return the index and one sentence.";

const SELECT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["pick", "reason"],
  properties: {
    pick: { type: "integer" },
    reason: { type: "string" },
  },
} as const;

const KEYWORDS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["slides"],
  properties: {
    slides: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["keywords"],
        properties: { keywords: { type: "array", items: { type: "string" } } },
      },
    },
  },
} as const;

function parseCandidate(raw: string | null | undefined, count: number): string[] | null {
  try {
    const parsed = JSON.parse(raw ?? "{}") as { slides?: unknown };
    const slides = Array.isArray(parsed.slides)
      ? parsed.slides.map((s) => (typeof s === "string" ? cleanCaption(s) : "")).filter(Boolean)
      : [];
    if (slides.length < 2) return null;
    // A deck one slide off still shows the register; hard-trim/keep as is.
    return slides.slice(0, Math.max(count, 2));
  } catch {
    return null;
  }
}

export async function generateLean(
  topic: string,
  slideCount: number,
  nicheSlug: string,
  diag?: RunLogger | null,
): Promise<LeanResult | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not set (lean copy path).");
  const openai = new OpenAI({ apiKey, timeout: 90_000, maxRetries: 1 });

  const rows = await retrieve(openai, topic, nicheSlug, K_EXEMPLARS);
  const user = buildUser(topic, slideCount, rows);
  if (diag) {
    await diag.text(
      "02_lean_prompt.txt",
      `MODEL: ${GEN_MODEL} ×${N_CANDIDATES}\n\n===== SYSTEM =====\n${leanSystem.system}\n\n===== USER =====\n${user}\n`,
    );
  }

  // 2) N whole candidates in one call. Temperature 1: we want spread, the
  //    selector does the narrowing.
  const gen = await openai.chat.completions.create({
    model: GEN_MODEL,
    temperature: 1,
    n: N_CANDIDATES,
    messages: [
      { role: "system", content: leanSystem.system },
      { role: "user", content: user },
    ],
    response_format: { type: "json_object" },
  });
  const candidates = gen.choices
    .map((c) => parseCandidate(c.message?.content, slideCount))
    .filter((c): c is string[] => c !== null);
  if (diag) await diag.json("03_lean_candidates.json", { model: GEN_MODEL, candidates });
  if (candidates.length === 0) return null;

  // 3) Select one whole deck.
  let pick = 0;
  let reason = "only one candidate";
  if (candidates.length > 1) {
    try {
      const sel = await openai.chat.completions.create({
        model: SELECT_MODEL,
        temperature: 0,
        messages: [
          { role: "system", content: SELECT_SYSTEM },
          {
            role: "user",
            content:
              `Topic: ${topic}\n\n` +
              candidates
                .map((c, i) => `DRAFT ${i}\n` + c.map((t, j) => `  slide ${j + 1}: ${t}`).join("\n"))
                .join("\n\n"),
          },
        ],
        response_format: {
          type: "json_schema",
          json_schema: { name: "deck_pick", strict: true, schema: SELECT_SCHEMA },
        },
      });
      const parsed = JSON.parse(sel.choices[0]?.message?.content ?? "{}") as {
        pick?: number;
        reason?: string;
      };
      if (Number.isInteger(parsed.pick) && parsed.pick! >= 0 && parsed.pick! < candidates.length) {
        pick = parsed.pick!;
        reason = parsed.reason ?? "";
      }
    } catch {
      // selector failed → first candidate
    }
  }
  if (diag) await diag.json("03b_lean_pick.json", { pick, reason, selector: SELECT_MODEL });

  // 4) Image keywords per slide — the image pipeline searches Pexels with them.
  const texts = candidates[pick];
  let keywords: string[][] = texts.map(() => []);
  try {
    const kw = await openai.chat.completions.create({
      model: "gpt-4.1-mini",
      temperature: 0,
      messages: [
        {
          role: "system",
          content:
            "For each slide caption of a TikTok photo slideshow, give 3-5 concrete visual " +
            "search keywords for a background photo that fits it (things, actions, places — " +
            "never abstract words). One entry per slide, in order.",
        },
        {
          role: "user",
          content: `Topic: ${topic}\n` + texts.map((t, i) => `${i + 1}. ${t}`).join("\n"),
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: { name: "slide_keywords", strict: true, schema: KEYWORDS_SCHEMA },
      },
    });
    const parsed = JSON.parse(kw.choices[0]?.message?.content ?? "{}") as {
      slides?: { keywords?: string[] }[];
    };
    keywords = texts.map((_t, i) => parsed.slides?.[i]?.keywords?.slice(0, 5) ?? []);
  } catch {
    // no keywords → the stock pipeline falls back to the caption text
  }

  // Roles by position. `number` stays null: real decks that number their
  // slides carry the digits in the text already, and layoutSlide only adds a
  // prefix when `number` is set.
  const deck: ListicleSlide[] = texts.map((text, i) => ({
    role: i === 0 ? "title" : "reason",
    number: null,
    text,
    imageKeywords: keywords[i],
    body: null,
  }));
  return {
    deck,
    candidates,
    pick,
    reason,
    exemplars: rows.map((r) => ({ topic: r.topic, niche: r.niche })),
    model: GEN_MODEL,
  };
}
