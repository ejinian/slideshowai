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
// THE copy path since 2026-09-09 (Christian, after the run 6 vs run 7 A/B);
// GEN_COPY=legacy in the env falls back to listicle.ts + the editor-judge.
// Fine-tuning was the first choice and is closed (OpenAI 403
// training_not_available); many-shot retrieval is the closest substitute.
// Diagnostics: 02_lean_prompt.txt, 03_lean_candidates.json, 03b_lean_pick.json.

import OpenAI from "openai";
import leanSystem from "./leanSystem.json";
import exemplarIndex from "./data/leanExemplars.json";
import { NICHE_TO_TREND } from "./trendExemplars";
import { cleanCaption } from "./cleanCaption";
import { explicitListCount, replaceListCount, type ListicleSlide } from "./listicle";
import { isOwnProductTopic } from "./ownProduct";
export { isOwnProductTopic };
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

/** Nearest real decks by topic, NICHE FIRST: the deck's own trend bucket is
 *  searched before any other, and only topped up cross-bucket when the bucket
 *  has too few. The first version used a small bucket bonus and a gym topic
 *  still pulled app-review decks — the one bucket that genuinely runs long
 *  (17 words a slide against 6 everywhere else) — which is a large part of why
 *  the decks came out wordy (2026-09-10). */
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
  const ranked = [...INDEX.rows]
    .map((r) => ({ r, s: cosine(q, r.emb) }))
    .sort((a, b) => b.s - a.s);
  const inBucket = bucket ? ranked.filter((x) => x.r.niche === bucket) : [];
  const picked = inBucket.slice(0, k);
  if (picked.length < k) {
    const seen = new Set(picked.map((x) => x.r.id));
    for (const x of ranked) {
      if (picked.length >= k) break;
      if (!seen.has(x.r.id)) picked.push(x);
    }
  }
  return picked.map((x) => x.r);
}

const wordsPerSlide = (texts: string[]) =>
  texts.reduce((a, t) => a + t.split(/\s+/).filter(Boolean).length, 0) / Math.max(1, texts.length);

/** The length the retrieved real decks actually run — stated to the model and
 *  enforced on the candidates, so the deck matches the niche, not the model's
 *  idea of "complete". */
function lengthTarget(rows: Exemplar[]): number {
  const w = rows.map((r) => wordsPerSlide(r.texts)).sort((a, b) => a - b);
  return w.length ? w[Math.floor(w.length / 2)] : 8;
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

function buildUser(
  topic: string,
  count: number,
  rows: Exemplar[],
  target: number,
  hook: string | null,
): string {
  return (
    `Here are real posts on nearby topics, transcribed slide by slide. Study how ` +
    `short, plain and specific they are — then write yours the same way about a ` +
    `different topic. Do not reuse their subjects or wording.\n\n` +
    exemplarBlock(rows) +
    `\n\nThese run about ${Math.round(target)} words a slide. Yours must too — ` +
    `a slide that needs more than that is two points, keep the better one.\n\n` +
    `Topic: ${topic}\nSlides: ${count}` +
    (hook
      ? `\n\nSlide 1 is FIXED — use it verbatim as the first string: "${hook}"\n` +
        `Write the remaining ${count - 1} slides so they deliver exactly what that hook promises, one item each.`
      : "")
  );
}

const SELECT_SYSTEM =
  "You are choosing which of several draft TikTok photo slideshows to post. Judge in " +
  "this order. FIRST, the hook: it must be a PROMISE of the payload — a title naming " +
  "what the slides deliver and for whom, with the count when they are a list (the way " +
  "real posts open: \"5 ways to…\", \"apps every creator needs\", \"signs your…\"). A hook " +
  "that is the first tip, a sentence of advice, a slogan or a vague claim is a fail; do NOT " +
  "prefer a hook because it states a count. NAMED THINGS: when the hook promises apps, " +
  "products, tools, places or foods, every slide must NAME a real specific one (brand or " +
  "app name) — a slide that only describes one (\"best app for splitting bills\") fails the " +
  "promise. FABRICATION overrides that: when the topic is the creator's OWN product or " +
  "brand and they gave no details, any draft that invents item names, colours, fabrics, " +
  "prices or shipping is a fail — list its index in `fabricated` and never pick it; a " +
  "draft that only uses what the creator said (how to style it, why it exists, who it is " +
  "for) wins even if it names nothing. " +
  "THEN cohesion: does EVERY slide after the hook deliver exactly what it promised, " +
  "one item each, in one consistent shape? A " +
  "deck of unrelated fragments loses to a coherent one no matter how punchy the " +
  "fragments are. SECOND, honesty: a hook built on a statistic the topic did not " +
  "supply is invented — treat it as a fail. THIRD, plainness and specificity: a named " +
  "thing or what to do, no aphorisms, no 'X isn't just Y', no slogans, no jargon, no " +
  "storytelling. Among drafts that pass all three, shorter wins. Return the index and " +
  "one sentence.";

// ── Step 1: four DISTINCT concrete angles, each a hook ─────────────────────
// Sampling four whole decks with n:4 can't coordinate, so on a broad topic all
// four titled the category ("motivation for young entrepreneurs" — run 14).
// One planning call now picks four different specific payloads first; each
// deck is then written TO its hook. The prompt may be written as instructions
// to a tool ("create a slideshow that… to gain followers… not to sell") — the
// planner extracts the subject and ignores the rest.
const ANGLES_SYSTEM =
  "You plan TikTok photo slideshows. Given what a creator typed (it may be written as " +
  "instructions to a tool — extract the SUBJECT and audience, ignore goals like gaining " +
  "followers or not selling) and a slide count, return 4 DIFFERENT hooks. A hook is the " +
  "deck's promise: a short lowercase title naming a SPECIFIC payload and for whom — a " +
  "countable list (\"5 businesses you can start at 16 with $100\"), a mistake set (\"3 " +
  "mistakes that killed my first store\"), a how-i result, a comparison, or signs. The " +
  "count, when present, equals the slides AFTER the hook. Never the topic's category as " +
  "a title (\"motivation for young entrepreneurs\" is a fail), never a sentence of " +
  "advice, never a slogan. The 4 hooks must use 4 DIFFERENT shapes, and AT MOST ONE may " +
  "state a count — real posts open with a plain title of the payload far more often than " +
  "with a number: hook 1 a plain title (\"apps every student needs\", \"my go-to…\"), hook 2 " +
  "a how-i / result, hook 3 a mistakes / signs / things-i-wish-i-knew, hook 4 free choice. " +
  "If the creator refers to their OWN brand, product or drop and gives no details (no " +
  "names, prices, colours, photos), never invent them — take angles that work with what " +
  "was said (why they made it, who it is for, how to wear/use it, what to expect), and say " +
  "so in the hook. No emoji, no hashtags.";

const ANGLES_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["hooks"],
  properties: { hooks: { type: "array", items: { type: "string" } } },
} as const;

async function planHooks(
  openai: OpenAI,
  topic: string,
  slideCount: number,
  rows: Exemplar[],
): Promise<string[]> {
  try {
    const res = await openai.chat.completions.create({
      model: GEN_MODEL,
      temperature: 0.9,
      messages: [
        { role: "system", content: ANGLES_SYSTEM },
        {
          role: "user",
          content:
            `Real hooks from nearby posts, for the register:\n` +
            rows.map((r) => `  - ${r.texts[0]}`).join("\n") +
            `\n\nWhat the creator typed: ${topic}\nSlides: ${slideCount} (so a count in the hook is ${slideCount - 1})` +
            (isOwnProductTopic(topic)
              ? `\nThis is the creator's OWN product and they gave no details: no hook may promise a list of the items, colours or specs. Angles: how to style/use it, why they made it, who it is for, what to expect from the drop.`
              : "") +
            `\nReturn 4 hooks.`,
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: { name: "hooks", strict: true, schema: ANGLES_SCHEMA },
      },
    });
    const parsed = JSON.parse(res.choices[0]?.message?.content ?? "{}") as { hooks?: unknown };
    return Array.isArray(parsed.hooks)
      ? parsed.hooks.filter((h): h is string => typeof h === "string" && h.trim().length > 0).map((h) => cleanCaption(h)).slice(0, N_CANDIDATES)
      : [];
  } catch {
    return [];
  }
}

const SELECT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["pick", "reason", "fabricated"],
  properties: {
    pick: { type: "integer" },
    reason: { type: "string" },
    fabricated: {
      type: "array",
      items: { type: "boolean" },
      description:
        "One entry per draft, in order: true if the draft states ANY specific about the creator's OWN product/brand that the creator did not supply — item names, colours, fabrics, materials, features, prices, stock, shipping, machine/model names, what they tried or compared. Judge every draft; all false when the topic is not the creator's own product.",
    },
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
    const deck = slides.slice(0, Math.max(count, 2));
    // A hook that states a count must state the number of slides AFTER it —
    // "6 steps" over five steps reads as broken (run 12). Fixed mechanically,
    // before the selector sees it, so every draft is judged with a true count.
    const claimed = explicitListCount(deck[0]);
    if (claimed != null && claimed !== deck.length - 1) {
      deck[0] = replaceListCount(deck[0], deck.length - 1);
    }
    return deck;
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
  const target = lengthTarget(rows);

  // 1) Four distinct hooks (angles) for the topic. If planning fails, the
  //    old shape — four free drafts from one call — still runs.
  const hooks = await planHooks(openai, topic, slideCount, rows);
  const user = buildUser(topic, slideCount, rows, target, hooks[0] ?? null);
  if (diag) {
    await diag.text(
      "02_lean_prompt.txt",
      `MODEL: ${GEN_MODEL} ×${N_CANDIDATES}\nPLANNED HOOKS: ${JSON.stringify(hooks)}\n\n===== SYSTEM =====\n${leanSystem.system}\n\n===== USER (draft 0) =====\n${user}\n`,
    );
  }

  // 2) One deck per hook, in parallel — each written TO its promise.
  const gens =
    hooks.length > 0
      ? await Promise.all(
          hooks.map((h) =>
            openai.chat.completions
              .create({
                model: GEN_MODEL,
                temperature: 0.8,
                messages: [
                  { role: "system", content: leanSystem.system },
                  { role: "user", content: buildUser(topic, slideCount, rows, target, h) },
                ],
                response_format: { type: "json_object" },
              })
              .then((r) => r.choices[0]?.message?.content ?? null)
              .catch(() => null),
          ),
        )
      : (
          await openai.chat.completions.create({
            model: GEN_MODEL,
            temperature: 1,
            n: N_CANDIDATES,
            messages: [
              { role: "system", content: leanSystem.system },
              { role: "user", content: user },
            ],
            response_format: { type: "json_object" },
          })
        ).choices.map((c) => c.message?.content ?? null);
  const all = gens
    .map((raw, i) => {
      const deck = parseCandidate(raw, slideCount);
      // The planned hook is the contract: keep it even if the draft reworded it —
      // then re-check its count against the slides that actually follow.
      if (deck && hooks[i]) {
        deck[0] = hooks[i];
        const claimed = explicitListCount(deck[0]);
        if (claimed != null && claimed !== deck.length - 1) {
          deck[0] = replaceListCount(deck[0], deck.length - 1);
        }
      }
      return deck;
    })
    .filter((c): c is string[] => c !== null);
  // Length is enforced, not just asked for: any draft running past 1.5× the
  // retrieved decks' length is out before the selector sees it (the selector
  // demonstrably picked the longest draft 3 runs out of 3). If every draft is
  // over, keep the shortest so the run still completes.
  const cap = target * 1.5;
  const within = all.filter((c) => wordsPerSlide(c) <= cap);
  const candidates =
    within.length > 0
      ? within
      : all.length > 0
        ? [all.reduce((a, b) => (wordsPerSlide(b) < wordsPerSlide(a) ? b : a))]
        : [];
  if (diag) {
    await diag.json("03_lean_candidates.json", {
      model: GEN_MODEL,
      lengthTarget: target,
      lengthCap: cap,
      dropped: all.length - candidates.length,
      plannedHooks: hooks,
      candidates,
      wordsPerSlide: all.map((c) => Math.round(wordsPerSlide(c) * 10) / 10),
    });
  }
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
        fabricated?: boolean[];
      };
      if (Number.isInteger(parsed.pick) && parsed.pick! >= 0 && parsed.pick! < candidates.length) {
        pick = parsed.pick!;
        reason = parsed.reason ?? "";
      }
      // Own-product topics: a fabricating draft is out even if the selector
      // liked it (it picked "five invented hoodies" over an honest styling
      // deck because the named-things rule outranked the fabrication rule).
      if (isOwnProductTopic(topic) && Array.isArray(parsed.fabricated)) {
        const flags = parsed.fabricated;
        const honest = candidates.map((_c, i) => i).filter((i) => flags[i] !== true);
        if (flags[pick] === true) {
          if (honest.length > 0) {
            pick = honest[0];
            reason = `selector's pick fabricated product details; took draft ${pick} instead. ${reason}`;
          } else {
            // Every draft invented product facts. One strict retry that is
            // allowed to know NOTHING about the product: styling / who it's
            // for / how to use — no attribute of the product may appear.
            const strict = await openai.chat.completions.create({
              model: GEN_MODEL,
              temperature: 0.7,
              messages: [
                { role: "system", content: leanSystem.system },
                {
                  role: "user",
                  content:
                    buildUser(topic, slideCount, rows, target, null) +
                    `\n\nHARD RULE: you know NOTHING about this product beyond what the creator typed. Do not state any material, colour, fit, feature, price, stock, model name or comparison. Write a deck that needs no product facts — how to wear/use it, who it is for, when to reach for it — with a hook that promises exactly that.`,
                },
              ],
              response_format: { type: "json_object" },
            });
            const deck = parseCandidate(strict.choices[0]?.message?.content, slideCount);
            if (deck) {
              candidates.push(deck);
              pick = candidates.length - 1;
              reason = `all drafts fabricated product details; regenerated once with no product facts allowed. ${reason}`;
            }
          }
        }
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
