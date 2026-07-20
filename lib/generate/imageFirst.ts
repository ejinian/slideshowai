import OpenAI from "openai";
import sharp from "sharp";
import type { RunLogger } from "./diagnostics";
import { listicleStructure, type ListicleSlide, type SlideRole } from "./listicle";

// Image-first generation for USER-UPLOADED photos.
//
// The uploads ARE the content, so this inverts the library flow: one gpt-4o
// vision call SEES every photo, writes captions grounded in what's actually
// shown, assigns each slide its best photo, orders for the hook, and EXCLUDES
// photos that don't fit the story (or are low quality). Slides with no fitting
// photo get photoIndex = -1 so the caller can fill them from the stock library.
//
// Structure/roles mirror the listicle (title → reasons → one plug → cta) so
// everything downstream (compositing, editor, posting) is unchanged.

const THUMB_W = 512; // grounding needs more detail than library matching

export interface ImageFirstRequest {
  niche: string;
  description: string;
  slideCount: number;
  slideshowCount: number;
  exemplars?: string;
}

export interface ImageFirstSlide extends ListicleSlide {
  /** index into the uploaded photos, or -1 = fill this slide from stock. */
  photoIndex: number;
}

export interface ImageFirstResult {
  slideshows: ImageFirstSlide[][];
  /** photo indices no variation used (unrelated / low quality). */
  excluded: number[];
}

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
        required: ["slides", "excluded_photos"],
        properties: {
          slides: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["role", "number", "text", "image_keywords", "photo_index"],
              properties: {
                role: { type: "string", enum: ["title", "reason", "plug", "cta"] },
                number: { type: ["integer", "null"] },
                text: { type: "string" },
                image_keywords: { type: "array", items: { type: "string" } },
                photo_index: { type: "integer" },
              },
            },
          },
          excluded_photos: { type: "array", items: { type: "integer" } },
        },
      },
    },
  },
} as const;

const SYSTEM =
  "You are a world-class TikTok Photo Mode strategist. You are handed the user's " +
  "OWN photos (numbered) and must build a scroll-stopping slideshow FROM them.\n" +
  "THE USER'S TOPIC DRIVES EVERY SLIDE. The whole slideshow must deliver on the " +
  "topic they gave — the hook and every caption. Never invent a different subject " +
  "just because the photos suggest one, and never confine the topic to one slide.\n" +
  "PROCESS:\n" +
  "1. Look at EVERY photo and understand what it actually shows.\n" +
  "2. Write the slideshow that delivers the user's TOPIC, then pick the photo that " +
  "best accompanies each caption.\n" +
  "3. SLIDE 1 IS THE HOOK: pick the single most scroll-stopping photo and write a " +
  "pattern-interrupt hook for it (bold/contrarian claim, curiosity gap, or callout). " +
  "If slide 1 is boring, nothing else matters.\n" +
  "4. Assign each slide exactly one photo via photo_index, and ORDER them for " +
  "maximum swipe-through. Never assign the same photo to two slides.\n" +
  "CAPTIONS MUST NOT NARRATE THE PHOTO. The caption carries the idea; the photo is " +
  "just the backdrop. It only has to be COMPATIBLE with the image — it must never " +
  "describe what is literally happening in it. NEVER prefix a caption with a label " +
  "of the photo's contents (banned: \"mirror check-in:\", \"gym data:\", \"arm " +
  "flex:\", \"meal prep:\"). A mirror selfie does NOT require the word 'mirror'; a " +
  "treadmill photo does NOT require the words 'gym data'.\n" +
  "VOICE — sound like a real creator, not a brand: NO exclamation marks (none); no " +
  "Title Case headlines (write the way a person texts, sentence case); ban clichés " +
  "and filler (\"you're probably making\", \"did you know\", \"game-changer\", " +
  "\"unlock\", \"elevate\", \"level up\"). Short lines (most under ~12 words). No " +
  "hashtags. At most one emoji per slideshow. Be concrete and a little contrarian.\n" +
  "STRUCTURE (listicle): a numbered TITLE hook, then numbered REASON slides that " +
  "each deliver one concrete point of the topic, and a CTA last. There is NO ad or " +
  "product slide — every middle slide is pure value.\n" +
  "For every slide also return image_keywords: 3-5 concrete visual words.";

function buildUser(
  req: ImageFirstRequest,
  count: number,
  reasonCount: number,
  nPhotos: number,
): string {
  return (
    (req.exemplars ? `${req.exemplars}\n\n` : "") +
    `Niche: ${req.niche}\n` +
    `TOPIC — what this WHOLE slideshow must be about: ${
      req.description ||
      "(no topic given — pick the most scroll-stopping angle these photos genuinely support)"
    }\n` +
    `You have ${nPhotos} photos, numbered 0..${nPhotos - 1} (shown below).\n\n` +
    `Build ${req.slideshowCount} DISTINCT slideshow variation(s). Each variation:\n` +
    `- EXACTLY ${count} slides in order: slide 1 role "title" (numbered hook, the ` +
    `headline number MUST be ${reasonCount}); slides 2–${count - 1} role "reason" ` +
    `numbered 1..${reasonCount}; slide ${count} role "cta" (number null).\n` +
    `- Assign EVERY slide a real photo_index. You have ${nPhotos} photos for ${count} ` +
    `slides, so a real photo exists for every slide — only use -1 if you genuinely ` +
    `have fewer photos than slides.\n` +
    `- excluded_photos is for leftovers only. NEVER exclude so many that fewer than ` +
    `${count} photos remain.\n` +
    (req.slideshowCount > 1
      ? "Make each variation a genuinely different hook angle and photo order.\n"
      : "")
  );
}

async function thumbnails(buffers: Buffer[]): Promise<(string | null)[]> {
  return Promise.all(
    buffers.map(async (b) => {
      try {
        const out = await sharp(b)
          .resize({ width: THUMB_W, withoutEnlargement: true })
          .jpeg({ quality: 70 })
          .toBuffer();
        return `data:image/jpeg;base64,${out.toString("base64")}`;
      } catch {
        return null;
      }
    }),
  );
}

// No `plug` role: every middle slide is pure value. (SlideRole still allows
// "plug" so previously-stored slideshows keep rendering.)
function expectedRole(i: number, count: number): SlideRole {
  if (i === 0) return "title";
  if (i === count - 1) return "cta";
  return "reason";
}

interface RawSlide {
  role?: SlideRole;
  number?: number | null;
  text?: string;
  image_keywords?: string[];
  photo_index?: number;
}

// Enforce role/number by position (keep the model's text + photo choice), and
// sanitize photo_index: in range or -1, with no repeats within the slideshow.
function normalize(
  raw: RawSlide[],
  count: number,
  reasonCount: number,
  nPhotos: number,
): ImageFirstSlide[] {
  const used = new Set<number>();
  const out: ImageFirstSlide[] = [];
  for (let i = 0; i < count; i++) {
    const role = expectedRole(i, count);
    const number = role === "title" ? reasonCount : role === "cta" ? null : i;
    const text =
      (raw[i]?.text ?? "").trim() ||
      (role === "title"
        ? `${reasonCount} things to know`
        : role === "cta"
          ? "Try it free → link in bio"
          : `Reason ${number ?? ""}`.trim());
    let photoIndex = raw[i]?.photo_index ?? -1;
    if (
      !Number.isInteger(photoIndex) ||
      photoIndex < 0 ||
      photoIndex >= nPhotos ||
      used.has(photoIndex)
    ) {
      photoIndex = -1; // out of range / duplicate → stock fill
    }
    if (photoIndex >= 0) used.add(photoIndex);
    out.push({
      role,
      number,
      text,
      imageKeywords: (raw[i]?.image_keywords ?? [])
        .map((k) => String(k).trim())
        .filter(Boolean)
        .slice(0, 5),
      photoIndex,
    });
  }

  // Backfill: in an Upload run the user expects THEIR photos, never stock. If
  // the model left a slide at -1 (or over-excluded) while unused uploads remain,
  // hand it the next unused one. Stock can only appear when uploads < slides.
  const spare = Array.from({ length: nPhotos }, (_, i) => i).filter(
    (i) => !used.has(i),
  );
  for (const slide of out) {
    if (slide.photoIndex < 0 && spare.length > 0) {
      const next = spare.shift() as number;
      slide.photoIndex = next;
      used.add(next);
    }
  }
  return out;
}

/**
 * Generate image-first slideshows from the user's uploaded photos. Returns null
 * on any vision failure so the caller can fall back to copy-first + positional
 * uploads (the pre-existing behavior).
 */
export async function generateImageFirst(
  req: ImageFirstRequest,
  photos: Buffer[],
  diag?: RunLogger | null,
): Promise<ImageFirstResult | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || apiKey.includes("REPLACE_ME") || photos.length === 0) return null;

  const thumbs = await thumbnails(photos);
  const usable = thumbs
    .map((t, i) => ({ t, i }))
    .filter((x): x is { t: string; i: number } => x.t !== null);
  if (usable.length === 0) return null;

  const s = listicleStructure(req.slideCount);
  const n = Math.min(Math.max(Math.floor(req.slideshowCount) || 1, 1), 5);

  const content: Array<
    | { type: "text"; text: string }
    | { type: "image_url"; image_url: { url: string; detail: "low" } }
  > = [
    {
      type: "text",
      text: buildUser(
        { ...req, slideshowCount: n },
        s.count,
        s.reasonCount,
        usable.length,
      ),
    },
    { type: "text", text: "Your photos:" },
  ];
  usable.forEach((u, idx) => {
    content.push({ type: "text", text: `Photo ${idx}:` });
    content.push({ type: "image_url", image_url: { url: u.t, detail: "low" } });
  });

  // Dump the exact instructions the vision model got (image data omitted — the
  // photos themselves are saved separately as uploads/upload_N.*).
  if (diag) {
    await diag.text(
      "02_imagefirst_prompt.txt",
      `MODEL: gpt-4o (vision)\nSTRUCTURE: count=${s.count} reasonCount=${s.reasonCount} (no plug slide — every middle slide is pure value)\nPHOTOS SHOWN: ${usable.length} (model index -> original upload index: ${usable
        .map((u, idx) => `${idx}->${u.i}`)
        .join(", ")})\n\n===== SYSTEM =====\n${SYSTEM}\n\n===== USER =====\n${
        content.find((c) => c.type === "text")?.type === "text"
          ? (content[0] as { text: string }).text
          : ""
      }\n`,
    );
  }

  let parsed: {
    slideshows?: { slides?: RawSlide[]; excluded_photos?: number[] }[];
  };
  try {
    const openai = new OpenAI({ apiKey, timeout: 60_000, maxRetries: 0 });
    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content },
      ],
      response_format: {
        type: "json_schema",
        json_schema: { name: "image_first", strict: true, schema: SCHEMA },
      },
    });
    const rawText = completion.choices[0]?.message?.content ?? "{}";
    if (diag) await diag.text("03_imagefirst_raw_response.json", rawText);
    parsed = JSON.parse(rawText);
  } catch (e) {
    if (diag) {
      await diag.text(
        "03_imagefirst_raw_response.json",
        `VISION CALL FAILED — falling back to copy-first + positional.\n${e instanceof Error ? e.message : String(e)}`,
      );
    }
    return null;
  }

  const rawShows = parsed.slideshows ?? [];
  if (rawShows.length === 0) return null;

  // The model indexes photos by their position in `usable`; map back to the
  // caller's original photo indices.
  const toOriginal = (p: number) => (p >= 0 && p < usable.length ? usable[p].i : -1);

  const slideshows: ImageFirstSlide[][] = [];
  for (let k = 0; k < n; k++) {
    const src = rawShows[k] ?? rawShows[rawShows.length - 1];
    const norm = normalize(
      src.slides ?? [],
      s.count,
      s.reasonCount,
      usable.length,
    );
    slideshows.push(
      norm.map((sl) => ({ ...sl, photoIndex: toOriginal(sl.photoIndex) })),
    );
  }

  const usedOriginals = new Set(
    slideshows.flat().map((sl) => sl.photoIndex).filter((p) => p >= 0),
  );
  const excluded = photos.map((_, i) => i).filter((i) => !usedOriginals.has(i));

  return { slideshows, excluded };
}
