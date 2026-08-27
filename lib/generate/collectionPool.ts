import type OpenAI from "openai";
import sharp from "sharp";
import { tryCopyModel } from "./copyModel";

// A big collection pick is a POOL, not a deck (Christian, 2026-08-27). A
// 54-photo collection attached to the composer means "choose from these for
// this prompt" — the old behavior silently used the first ten. This runs ONE
// vision pass over the whole pool and returns the indices of the photos that
// best serve the topic; downstream (image-first ordering, exclusions, stock
// fill) is completely unchanged, the same separation every other reader
// feature keeps. Returns null on any failure so the caller can fall back to
// the old first-N truncation — a broken selector can never break a generation.

const THUMB_W = 384;

const SYSTEM =
  "You curate photos for a TikTok slideshow. You are shown the creator's " +
  "photo pool and the deck's topic, and you pick which photos to use.\n" +
  "• ON-TOPIC FIRST: pick photos that genuinely serve the topic — a photo " +
  "can be great and still wrong for this deck.\n" +
  "• VARIETY: avoid near-duplicates (same pose, same spot, same shirt); a " +
  "deck of lookalike shots reads as filler.\n" +
  "• QUALITY: skip blurry, dark, or accidental-looking shots.\n" +
  "• Put the single most scroll-stopping, on-topic photo FIRST — it may " +
  "become the hook slide.\n" +
  "Return exactly the requested number of photo indices, best first.";

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["picks"],
  properties: {
    picks: {
      type: "array",
      items: { type: "integer" },
      description: "Chosen photo indices, best first, no repeats.",
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

export async function selectFromPool(
  topic: string,
  images: Buffer[],
  want: number,
): Promise<{ chosen: number[]; model: string } | null> {
  const cm = tryCopyModel({ timeoutMs: 90_000 });
  if (!cm || images.length <= want) return null;

  try {
    const thumbs = await Promise.all(images.map(thumb));
    const content: Array<
      | { type: "text"; text: string }
      | { type: "image_url"; image_url: { url: string; detail: "low" } }
    > = [
      {
        type: "text",
        text:
          `TOPIC of the slideshow: ${topic || "(none given — pick the strongest, most varied set)"}\n` +
          `Pick exactly ${want} of the creator's ${images.length} photos, ` +
          `numbered 0..${images.length - 1}. They follow:`,
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
        { role: "system", content: SYSTEM },
        { role: "user", content },
      ],
      response_format: {
        type: "json_schema",
        json_schema: { name: "pool_picks", strict: true, schema: SCHEMA },
      },
    });
    const parsed = JSON.parse(
      completion.choices[0]?.message?.content ?? "{}",
    ) as { picks?: number[] };

    const seen = new Set<number>();
    const chosen = (parsed.picks ?? [])
      .filter(
        (i) =>
          Number.isInteger(i) &&
          i >= 0 &&
          i < images.length &&
          !seen.has(i) &&
          (seen.add(i), true),
      )
      .slice(0, want);
    // Model returned too few: top up from the unpicked pool in given order so
    // the deck is never short a photo.
    for (let i = 0; chosen.length < want && i < images.length; i++) {
      if (!seen.has(i)) {
        seen.add(i);
        chosen.push(i);
      }
    }
    if (chosen.length === 0) return null;
    return { chosen, model: cm.label };
  } catch {
    return null;
  }
}
