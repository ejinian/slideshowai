import type OpenAI from "openai";
import sharp from "sharp";
import { tryCopyModel } from "./copyModel";
import { POOL_AUDIT_SYSTEM } from "./imageFirst";

// Collection decks are COPY-FIRST with a per-caption image ladder (Christian,
// 2026-08-28): the captions are written by the full listicle machinery from
// the topic alone, and THEN each caption shops the ladder — the creator's
// collection first (this module), live stock second, AI generation last. The
// old flow (a pre-narrowing pool pick + image-first vision writing captions
// around the photos) is gone for collections; hand-staged uploads keep the
// image-first path unchanged.
//
// This module is tier 1: one vision call matches every caption against the
// WHOLE pool (up to 60 photos), then the pool-fit audit re-checks each chosen
// pair in isolation — the same two-pass shape as the stock judge, because a
// single ranking call demonstrably leaks. A slide that ends -1 falls to the
// route's faceless stock→AI gap chain. Returns null on total failure so the
// caller can fall back to positional assignment — this can never break a run.

const THUMB_W = 384;

const MATCH_SYSTEM =
  "You match a TikTok slideshow's captions to the creator's photo collection. " +
  "You get the deck's topic, every caption in order, and the whole pool.\n" +
  "• Per caption, return the pool index of the photo that best accompanies " +
  "it, or -1 if nothing in the pool fits. A -1 slide gets a stock or " +
  "generated image matched to its caption, so -1 beats a wrong photo.\n" +
  "• The photo is a BACKDROP the caption must be compatible with, not an " +
  "illustration: the creator's physique or training shot fits training, " +
  "habit, sleep, mindset and results captions (it is their proof). Return " +
  "-1 ONLY when the caption's POINT is a concrete other subject — food, a " +
  "meal, a drink, a supplement, a product, a place, an object — and no photo " +
  "in the pool shows it. Otherwise ALWAYS pick a photo: the creator chose " +
  "this collection, and a backdrop that merely sits behind the caption is a " +
  "match.\n" +
  "• Slide 0 is the hook: give it the single most scroll-stopping, on-topic " +
  "photo in the pool.\n" +
  "• Prefer shots of the creator IN ACTION over equipment-only or empty-scene " +
  "shots — a person mid-curl beats dumbbells on the floor for any training " +
  "caption. Equipment/scene shots are a last resort, never an equal choice.\n" +
  "• Never reuse a photo across slides. Skip blurry or accidental shots.\n" +
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

// The audit must NAME the concrete subject it thinks is missing. Demotion is
// then mechanical on that name: a "no" with nothing nameable is a keep. This
// is what stops "training without tracking progress" being demoted off a gym
// photo (run 2, 2026-09-09) while "chicken, rice, potatoes" still is.
const AUDIT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["verdicts"],
  properties: {
    verdicts: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["keep", "missing"],
        properties: {
          keep: { type: "boolean" },
          missing: {
            type: "string",
            description:
              "When keep is false: the concrete subject the photo lacks, in 1-2 words (e.g. \"food\", \"protein shake\", \"product\"). \"\" when keep is true.",
          },
        },
      },
    },
  },
} as const;

/** A demotion only counts when the named missing subject is genuinely a
 *  concrete OTHER thing. Anything else ("effort", "sleep", "progress") is the
 *  audit over-reaching, and the creator's photo stays. */
const CONCRETE_MISSING =
  /\b(food|meal|meals|eat|eating|diet|nutrition|protein|carb|carbs|rice|chicken|snack|breakfast|lunch|dinner|drink|coffee|water|shake|supplement|creatine|vitamin|product|bottle|package|place|kitchen|restaurant|store|shop|office|bed|bedroom|object|phone|book|scale|watch|equipment|dumbbell|barbell|machine|shoes|clothes|outfit)\b/i;

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
  /** Per caption: pool photo index, or -1 = fall to the stock→AI ladder. */
  assign: number[];
  /** Pairs the audit demoted (1-based slide numbers) + the concrete subject
   *  it named as missing, for diagnostics. */
  demoted: { slide: number; caption: string; missing?: string }[];
  model: string;
}

/**
 * Collection-ONLY decks (source = my photos, 2026-09-09): every slide comes
 * from the pool, full stop. A -1 from the matcher (or an unassigned slide on
 * matcher failure) takes the first unused pool photo in the user's pick
 * order; once the pool is exhausted, photos repeat, least-used first. Nothing
 * here ever reaches stock or AI — that is the whole point of the mode.
 */
export function fillGapsFromPool(
  assign: number[],
  poolSize: number,
  /** "unused": only hand out photos nobody has yet; once the pool is spent
   *  a gap stays -1 (collection-FIRST mode, where -1 still has stock to go
   *  to). "repeat" (default): the pool is the only source, so cycle it. */
  policy: "repeat" | "unused" = "repeat",
): number[] {
  if (poolSize <= 0) return assign;
  const uses = new Array<number>(poolSize).fill(0);
  for (const p of assign) if (p >= 0 && p < poolSize) uses[p] += 1;
  return assign.map((p) => {
    if (p >= 0 && p < poolSize) return p;
    let best = 0;
    for (let i = 1; i < poolSize; i++) if (uses[i] < uses[best]) best = i;
    if (policy === "unused" && uses[best] > 0) return -1;
    uses[best] += 1;
    return best;
  });
}

export async function matchPoolToCaptions(
  topic: string,
  captions: { text: string }[],
  images: Buffer[],
  /**
   * "first" (default, source = our photos): a slide leaves the collection ONLY
   * through the audit naming a concrete missing subject. Pass-1 -1s are first
   * backfilled from UNUSED pool photos (the matcher over-returns -1 for plain
   * training captions — run 3, 2026-09-09: three -1s with two photos unused),
   * so the audit is the single gate; a -1 survives only when the pool is spent
   * or the audit fails the pair.
   * "only" (source = my photos): every slide is a pool photo, repeats allowed,
   * no audit — a -1 has nowhere to go, so demoting would only lose the match.
   */
  opts: { mode?: "first" | "only" } = {},
): Promise<PoolMatch | null> {
  const mode = opts.mode ?? "first";
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
    // The matcher's -1 is advisory. What decides whether a slide leaves the
    // collection is the audit below (mode "first") or nothing at all (mode
    // "only") — see the opts doc.
    let assign = fillGapsFromPool(
      picked,
      images.length,
      mode === "only" ? "repeat" : "unused",
    );

    // ── Pass 2 (mode "first" only): audit each chosen pair in isolation
    //    (rules leak; this holds the bar mechanically, exactly like the stock
    //    judge's verify pass). Runs in ROUNDS: a demotion frees a photo, and a
    //    still-empty slide may be fine with it (a photo demoted off a food
    //    slide is a perfectly good backdrop for a sleep slide — run 4,
    //    2026-09-09 left the sleep slide on stock with two photos free). Each
    //    round only audits pairs it has not seen; two rounds is the cap. ────
    const demoted: { slide: number; caption: string; missing?: string }[] = [];
    if (mode === "first") {
      const audited = new Set<string>();
      for (let round = 0; round < 2; round++) {
        const pairs = assign
          .map((p, i) => ({ i, p, t: p >= 0 ? thumbs[p] : null }))
          .filter(
            (x): x is { i: number; p: number; t: string } =>
              !!x.t && !audited.has(`${x.i}:${x.p}`),
          );
        if (pairs.length === 0) break;
        pairs.forEach((x) => audited.add(`${x.i}:${x.p}`));
        let demotedThisRound = 0;
        try {
          const auditContent: Array<
            | { type: "text"; text: string }
            | { type: "image_url"; image_url: { url: string; detail: "low" } }
          > = [];
          pairs.forEach((x, j) => {
            auditContent.push({
              type: "text",
              text: `Slide ${j} — caption: "${captions[x.i].text}". Its photo:`,
            });
            auditContent.push({
              type: "image_url",
              image_url: { url: x.t, detail: "low" },
            });
          });
          auditContent.push({
            type: "text",
            text: `Return verdicts: one entry per slide in order (0..${pairs.length - 1}); keep=true keeps the photo, keep=false names the missing subject.`,
          });
          const audit = await (cm.client as OpenAI).chat.completions.create({
            model: cm.model,
            messages: [
              { role: "system", content: POOL_AUDIT_SYSTEM },
              { role: "user", content: auditContent },
            ],
            response_format: {
              type: "json_schema",
              json_schema: { name: "pool_audit", strict: true, schema: AUDIT_SCHEMA },
            },
          });
          const verdicts = (
            JSON.parse(audit.choices[0]?.message?.content ?? "{}") as {
              verdicts?: { keep?: boolean; missing?: string }[];
            }
          ).verdicts;
          pairs.forEach((x, j) => {
            const v = verdicts?.[j];
            const missing = (v?.missing ?? "").trim();
            if (v?.keep === false && CONCRETE_MISSING.test(missing)) {
              assign[x.i] = -1;
              demotedThisRound += 1;
              demoted.push({ slide: x.i + 1, caption: captions[x.i].text, missing });
            }
          });
        } catch {
          break; // audit fails open — current assignments stand
        }
        if (demotedThisRound === 0) break;
        // Freed photos → still-empty slides, then audit those new pairs.
        assign = fillGapsFromPool(assign, images.length, "unused");
      }
    }

    return { assign, demoted, model: cm.label };
  } catch {
    return null;
  }
}
