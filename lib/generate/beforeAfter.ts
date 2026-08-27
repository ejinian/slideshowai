import type OpenAI from "openai";
import sharp from "sharp";
import type { RunLogger } from "./diagnostics";
import { cleanCaption } from "./cleanCaption";
import { tryCopyModel } from "./copyModel";
import { detectPlug, namesBrand } from "./plugRequest";
import type { SlidePos } from "./layout";
import type { ListicleSlide } from "./listicle";

// The BEFORE/AFTER format — the "i went from X to Y" transformation post
// (2026-08-27, Christian). Real viral transformation decks are tiny and
// deadpan: slide 1 states both ends of the change, slide 2 is the ONE thing
// that changed, and that's the whole post. The listicle machinery can't
// express this (its minimum is 3 slides and its doctrine numbers/values every
// slide), so — like showcase — it gets its own lane instead of loosening the
// shared prompts.
//
// Unlike showcase this lane works WITHOUT uploads too: a text transformation
// ("i went from 4 hours of sleep to 8") over stock/AI backgrounds is the
// common case. With uploads, the before photo carries slide 1 and the after
// photo carries the payoff.
//
// Returns null on ANY failure — including a hook that names a promoted brand —
// so the caller falls back to the normal path, which enforces everything
// mechanically. This lane can never break a generation.

export interface BeforeAfterSlide extends ListicleSlide {
  photoIndex: number;
  pos?: SlidePos | null;
}

/** Does the prompt read as a personal transformation? Conservative on
 *  purpose — a how-to prompt must stay a value deck. */
const TRANSFORM_CUES =
  /\b(i went from|went from [^.,;]{1,50} to |before (and|&|vs\.?) after|before\/after|transformation|glow[ -]?up|used to (be|have|weigh|look|feel)|ago vs\.? (now|today)|then vs\.? now)\b/i;

export function detectBeforeAfter(prompt: string): boolean {
  return TRANSFORM_CUES.test(prompt || "");
}

const HOOK_POS: SlidePos = { x: 0.5, y: 0.22, align: "center" };
const PAYOFF_POS: SlidePos = { x: 0.5, y: 0.5, align: "center" };

const SYSTEM =
  "You write TikTok before/after transformation slideshows — the " +
  "\"i went from X to Y\" format. They are tiny and deadpan: TWO slides, " +
  "three only when a second beat genuinely earns it.\n" +
  "• Slide 1 — the transformation itself, first person, at most 10 words, " +
  "all lowercase, no exclamation marks: \"i went from 4 hours of sleep to " +
  "8\". It states BOTH ends — where they started and where they landed. " +
  "Never phrase it as a list, a question, or \"here's how\".\n" +
  "• Slide 2 — the ONE thing that changed, just as short and fully " +
  "concrete: \"all i changed was no caffeine after noon\". This is the line " +
  "a viewer screenshots. When a strong after photo carries the slide it can " +
  "be 1-4 words, or empty.\n" +
  "• Optional slide 3 — only for a genuinely distinct second beat. When in " +
  "doubt, two slides.\n" +
  "• Voice: nonchalant, like someone typing fast. No hashtags, no CTA, no " +
  "\"follow for more\", no Title Case, no marketing adjectives.\n" +
  "• If the topic promotes a named product or brand, it may be named ONLY " +
  "on the payoff slide — NEVER slide 1. A branded opener is an ad, not a " +
  "story.\n" +
  "• WITH PHOTOS: set each slide's `photo` to the index of its photo — the " +
  "most clearly \"before\" shot on slide 1, the most impressive \"after\" " +
  "on the last slide. List every unused photo in excluded_photos.\n" +
  "• WITHOUT PHOTOS: photo = -1 on every slide, and give 2-3 " +
  "image_keywords per slide — slide 1 describes the struggle state, the " +
  "payoff describes the result state.\n" +
  "• No emojis anywhere — they cannot render.";

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["slides", "excluded_photos"],
  properties: {
    slides: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["text", "image_keywords", "photo"],
        properties: {
          text: { type: "string" },
          image_keywords: { type: "array", items: { type: "string" } },
          photo: {
            type: "integer",
            description: "Uploaded-photo index for this slide, or -1.",
          },
        },
      },
    },
    excluded_photos: { type: "array", items: { type: "integer" } },
  },
} as const;

async function thumb(buf: Buffer): Promise<string | null> {
  try {
    const o = await sharp(buf)
      .resize({ width: 512, withoutEnlargement: true })
      .jpeg({ quality: 70 })
      .toBuffer();
    return `data:image/jpeg;base64,${o.toString("base64")}`;
  } catch {
    return null;
  }
}

export async function generateBeforeAfter(
  description: string,
  images: Buffer[],
  diag?: RunLogger | null,
): Promise<{ slideshows: BeforeAfterSlide[][]; excluded: number[] } | null> {
  const cm = tryCopyModel({ timeoutMs: 60_000 });
  if (!cm) return null;

  try {
    const content: Array<
      | { type: "text"; text: string }
      | { type: "image_url"; image_url: { url: string; detail: "low" } }
    > = [
      {
        type: "text",
        text:
          `THE TRANSFORMATION (the creator's own words): ${description}\n` +
          (images.length > 0
            ? `Their ${images.length} photos follow, numbered 0..${images.length - 1}.`
            : "They uploaded no photos — set photo to -1 and rely on image_keywords."),
      },
    ];
    if (images.length > 0) {
      const thumbs = await Promise.all(images.map(thumb));
      thumbs.forEach((t, i) => {
        content.push({ type: "text", text: `photo ${i}:` });
        if (t) content.push({ type: "image_url", image_url: { url: t, detail: "low" } });
        else content.push({ type: "text", text: "(unreadable)" });
      });
    }

    const completion = await (cm.client as OpenAI).chat.completions.create({
      model: cm.model,
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content },
      ],
      response_format: {
        type: "json_schema",
        json_schema: { name: "before_after", strict: true, schema: SCHEMA },
      },
    });
    const parsed = JSON.parse(
      completion.choices[0]?.message?.content ?? "{}",
    ) as {
      slides?: { text?: string; image_keywords?: string[]; photo?: number }[];
      excluded_photos?: number[];
    };

    const raw = (parsed.slides ?? []).slice(0, 3);
    if (raw.length < 2) return null;

    const hook = cleanCaption(raw[0].text ?? "");
    if (!hook || hook.split(/\s+/).length > 12 || /\r?\n/.test(hook)) return null;
    // A branded hook falls back to the normal path, whose plugInHook retry
    // enforces the middle-slide rule mechanically.
    const plug = detectPlug(description);
    if (plug.requested && namesBrand(hook, plug.target)) return null;

    const usedPhotos = new Set<number>();
    const slides: BeforeAfterSlide[] = raw.map((s, i) => {
      const text = i === 0 ? hook : cleanCaption(s.text ?? "");
      let photoIndex =
        Number.isInteger(s.photo) && s.photo! >= 0 && s.photo! < images.length
          ? (s.photo as number)
          : -1;
      if (photoIndex >= 0 && usedPhotos.has(photoIndex)) photoIndex = -1;
      if (photoIndex >= 0) usedPhotos.add(photoIndex);
      return {
        role: i === 0 ? ("title" as const) : ("reason" as const),
        number: null,
        text: text.split(/\s+/).length > 12 ? "" : text,
        imageKeywords: (s.image_keywords ?? []).slice(0, 3),
        body: null,
        photoIndex,
        pos: i === 0 ? HOOK_POS : text ? PAYOFF_POS : null,
      };
    });

    const excluded = images
      .map((_b, i) => i)
      .filter((i) => !usedPhotos.has(i));

    if (diag) {
      await diag.json("03_before_after.json", {
        note:
          "BEFORE/AFTER format — 2-3 slide transformation post; slide counts " +
          "from the Slides pill are deliberately ignored in this lane.",
        model: cm.label,
        slides: slides.map((s) => ({
          text: s.text,
          photoIndex: s.photoIndex,
          keywords: s.imageKeywords,
        })),
        excludedPhotos: excluded,
      });
    }
    return { slideshows: [slides], excluded };
  } catch {
    return null;
  }
}
