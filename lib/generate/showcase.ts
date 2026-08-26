import OpenAI from "openai";
import sharp from "sharp";
import type { RunLogger } from "./diagnostics";
import { stripEmoji } from "./cleanCaption";
import type { SlidePos } from "./layout";
import type { ListicleSlide } from "./listicle";

// The SHOWCASE format — a product-drop deck where the PHOTOS are the content
// and the text nearly disappears. Modeled directly on a real viral reference
// (Neboa matcha drop: hook "girls run to rossman for this new neboa
// collection!!", slide 2 just "I'm obsessed.", slide 3 silent). This is the
// photo_dump / product_promo mechanic our hook taxonomy deliberately excludes
// from steering VALUE decks — for an announcement with real photos it is the
// right format, so it gets its own lane instead.
//
// A separate module on purpose: the listicle/imageFirst prompts encode the
// value doctrine (every slide actionable, no exclamation marks, lowercase
// deadpan). Showcase register is the opposite — hype, "!!" allowed — and
// relaxing those rules inside the shared prompts would leak into value decks.
// Returns null on ANY failure so the caller falls back to the normal
// image-first path; this can never break a generation.

export interface ShowcaseSlide extends ListicleSlide {
  photoIndex: number;
  pos?: SlidePos | null;
}

/** Words that read as a drop/announcement rather than a topic to teach. */
const DROP_CUES =
  /\b(new (collection|drop|line|launch|flavor|flavour|arrivals?)|just (dropped|launched|landed|got|found|restocked)|restock(ed)?|back in stock|now (at|in|available)|run to|launch(es|ing|ed)?|limited edition|in stores?|on shelves|came out|obsessed with)\b/i;

/**
 * Should this generation use the showcase format? Deliberately conservative:
 * real photos present AND the prompt reads as announcing a thing — a how-to or
 * tips prompt with uploads must stay a value deck.
 */
export function detectShowcase(prompt: string, hasPhotos: boolean): boolean {
  if (!hasPhotos) return false;
  return DROP_CUES.test(prompt || "");
}

const HOOK_POS: SlidePos = { x: 0.5, y: 0.2, align: "center" };
const FRAGMENT_POS: SlidePos = { x: 0.5, y: 0.45, align: "center" };

const SYSTEM =
  "You write TikTok product-drop slideshows where the PHOTOS do the selling " +
  "and text nearly disappears. You are shown the creator's real photos.\n" +
  "FORMAT — exactly this, nothing more:\n" +
  "• ONE hook line for slide 1: hype register, names the product (and the " +
  "store/place if the prompt gives one), tells people to go get it. 6-12 " +
  "words. Casual, like a girl texting her group chat — exclamation marks " +
  "genuinely welcome (\"girls run to rossman for this new neboa " +
  "collection!!\"). Lowercase preferred.\n" +
  "• AT MOST TWO tiny reaction fragments on later slides — 1-5 words " +
  "(\"i'm obsessed.\", \"the packaging??\"). Every other slide stays " +
  "COMPLETELY SILENT: empty text. Silence is the aesthetic; do not fill it.\n" +
  "• Order the photos so the most scroll-stopping shot is slide 1.\n" +
  "• No emojis (they cannot render). No hashtags. Never invent facts, " +
  "prices, or store names the prompt or photos don't show.";

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    photo_order: {
      type: "array",
      items: { type: "integer" },
      description: "Every photo index exactly once, best hook shot first.",
    },
    hook: { type: "string" },
    fragments: {
      type: "array",
      maxItems: 2,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          slide: { type: "integer", description: "0-based slide position (not photo index)." },
          text: { type: "string" },
        },
        required: ["slide", "text"],
      },
    },
  },
  required: ["photo_order", "hook", "fragments"],
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

/** Showcase cleanup: casual case + emoji stripped, but "!!" SURVIVES —
 *  cleanCaption is built for the value voice and would be wrong here. */
function cleanFragment(s: string): string {
  const out = stripEmoji(s).replace(/[ \t]{2,}/g, " ").trim();
  // Reuse cleanCaption's sentence-initial-lowercase behaviour without its
  // other value-deck normalizations by simply lowercasing a leading capital
  // followed by a lowercase letter (acronyms survive).
  return out.replace(/^([A-Z])(?![A-Z])/, (m) => m.toLowerCase());
}

export async function generateShowcase(
  description: string,
  images: Buffer[],
  diag?: RunLogger | null,
): Promise<{ slideshows: ShowcaseSlide[][]; excluded: number[] } | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || apiKey.includes("REPLACE_ME") || images.length === 0) return null;

  try {
    const thumbs = await Promise.all(images.map(thumb));
    const content: Array<
      | { type: "text"; text: string }
      | { type: "image_url"; image_url: { url: string; detail: "low" } }
    > = [
      {
        type: "text",
        text:
          `THE DROP (the creator's own words): ${description}\n` +
          `Their ${images.length} photos follow, numbered 0..${images.length - 1}.`,
      },
    ];
    thumbs.forEach((t, i) => {
      content.push({ type: "text", text: `photo ${i}:` });
      if (t) content.push({ type: "image_url", image_url: { url: t, detail: "low" } });
      else content.push({ type: "text", text: "(unreadable)" });
    });

    const openai = new OpenAI({ apiKey, timeout: 60_000, maxRetries: 1 });
    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content },
      ],
      response_format: {
        type: "json_schema",
        json_schema: { name: "showcase", strict: true, schema: SCHEMA },
      },
    });
    const parsed = JSON.parse(
      completion.choices[0]?.message?.content ?? "{}",
    ) as {
      photo_order?: number[];
      hook?: string;
      fragments?: { slide: number; text: string }[];
    };

    const hook = cleanFragment(parsed.hook ?? "");
    if (!hook || hook.split(/\s+/).length > 14) return null;

    // Every photo exactly once; a bad permutation falls back to given order.
    const seen = new Set<number>();
    let order = (parsed.photo_order ?? []).filter(
      (i) => Number.isInteger(i) && i >= 0 && i < images.length && !seen.has(i) && (seen.add(i), true),
    );
    if (order.length !== images.length) order = images.map((_b, i) => i);

    const fragments = new Map<number, string>();
    for (const f of (parsed.fragments ?? []).slice(0, 2)) {
      const t = cleanFragment(f.text ?? "");
      if (f.slide > 0 && f.slide < images.length && t && t.split(/\s+/).length <= 6) {
        fragments.set(f.slide, t);
      }
    }

    const slides: ShowcaseSlide[] = order.map((photoIndex, i) => ({
      role: i === 0 ? ("title" as const) : ("reason" as const),
      number: null,
      text: i === 0 ? hook : fragments.get(i) ?? "",
      photoIndex,
      pos: i === 0 ? HOOK_POS : fragments.has(i) ? FRAGMENT_POS : null,
    }));

    if (diag) {
      await diag.json("03_showcase.json", {
        note: "SHOWCASE format — photos carry the deck, text nearly silent.",
        hook,
        fragments: [...fragments.entries()],
        photoOrder: order,
      });
    }
    return { slideshows: [slides], excluded: [] };
  } catch {
    return null;
  }
}
