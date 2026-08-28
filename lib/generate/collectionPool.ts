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
  "habit, and results captions (it is their proof). But a caption whose " +
  "POINT is a concrete other subject — food, meals, a product, a place, " +
  "sleep — needs a photo of THAT, and if the pool has none, return -1.\n" +
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

const AUDIT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["verdicts"],
  properties: {
    verdicts: { type: "array", items: { type: "boolean" } },
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
  /** Per caption: pool photo index, or -1 = fall to the stock→AI ladder. */
  assign: number[];
  /** Pairs the audit demoted (1-based slide numbers), for diagnostics. */
  demoted: { slide: number; caption: string }[];
  model: string;
}

export async function matchPoolToCaptions(
  topic: string,
  captions: { text: string }[],
  images: Buffer[],
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
    const assign = captions.map((_c, i) => {
      const p = parsed.picks?.[i];
      if (!Number.isInteger(p) || p! < 0 || p! >= images.length || used.has(p!)) {
        return -1;
      }
      used.add(p!);
      return p as number;
    });
    if (assign.every((p) => p < 0)) return null; // total miss → let caller fall back

    // ── Pass 2: audit each chosen pair in isolation (rules leak; this holds
    //    the bar mechanically, exactly like the stock judge's verify pass) ───
    const pairs = assign
      .map((p, i) => ({ i, p, t: p >= 0 ? thumbs[p] : null }))
      .filter((x): x is { i: number; p: number; t: string } => !!x.t);
    const demoted: { slide: number; caption: string }[] = [];
    if (pairs.length > 0) {
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
          text: `Return verdicts: one boolean per slide in order (0..${pairs.length - 1}); true = keep the photo.`,
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
            verdicts?: boolean[];
          }
        ).verdicts;
        pairs.forEach((x, j) => {
          if (verdicts?.[j] === false) {
            assign[x.i] = -1;
            demoted.push({ slide: x.i + 1, caption: captions[x.i].text });
          }
        });
      } catch {
        // audit fails open — pass-1 assignments stand
      }
    }

    return { assign, demoted, model: cm.label };
  } catch {
    return null;
  }
}
