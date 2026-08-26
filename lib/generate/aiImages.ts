import OpenAI from "openai";

// AI-generated backgrounds — the third image source ("Upload" / "Our photos" /
// "AI images"). Reintroduced 2026-08-25 (the gpt-image-1 version was cut from
// MVP on 2026-07-17); the API surface follows liveImages: per-slide best-effort,
// null on any failure, never throws — a failed image falls back to stock so a
// generation can never die on this path.
//
// Model and quality are env-tunable so repricing is a config change, not a
// deploy: AI_IMAGE_MODEL (default gpt-image-2) + AI_IMAGE_QUALITY (default
// low — the ONLY tier the costOf() surcharge prices; see the margin note
// there before raising it). Prices per PORTRAIT 1024x1536 image, verified
// 2026-08-25:
//   gpt-image-2        low $0.005   medium $0.041   high $0.165
//   gpt-image-1-mini   low ~$0.006  medium $0.015   high ~$0.052
//   gpt-image-1 (deprecates 2026-10-23) low $0.016 medium $0.063 high $0.25
// The billing surcharge in costOf() must cover the WORST path (10 slides) at
// the configured tier — see the margin doctrine in CLAUDE.md before changing
// either knob.

const CONCURRENCY = 3;

export function aiImageModel(): { model: string; quality: "low" | "medium" | "high" } {
  const model = process.env.AI_IMAGE_MODEL || "gpt-image-2";
  const q = (process.env.AI_IMAGE_QUALITY || "low").toLowerCase();
  const quality = q === "medium" || q === "high" ? q : "low";
  return { model, quality };
}

function buildPrompt(caption: string, keywords: string[], topic: string): string {
  const subject = keywords
    .map((k) => k.trim())
    .filter(Boolean)
    .slice(0, 3)
    .join(", ");
  // Caption-FIRST, keywords second. The whole point of paying for a generated
  // image is that it can depict the caption's precise moment — "not pushing to
  // failure" should render a grinding final rep, not a tidy lockout. Keywords
  // are search terms; they flatten that nuance, so they only ride as support.
  return (
    "Candid, photorealistic vertical phone photo for a TikTok slideshow " +
    `background. The deck is about: ${topic || caption}. This slide's caption ` +
    `reads: "${caption}". Depict the EXACT moment the caption describes — the ` +
    "specific action, effort, or state it names, not just the general setting. " +
    "If the caption names a struggle, mistake, or intensity, SHOW it happening " +
    "(straining mid-rep, the wrong form, the messy counter) rather than a calm " +
    "posed version of the scene. " +
    (subject ? `Supporting subjects: ${subject}. ` : "") +
    "A real, natural scene shot on a phone — authentic lighting, slightly " +
    "imperfect, NOT a polished studio stock photo. Leave calm negative space " +
    "for a caption overlay. Absolutely no text, letters, words, watermarks, or " +
    "logos in the image."
  );
}

// A neutral scene prompt with NO quoted caption. The safety system reads
// "photorealistic phone photo" + casual person-words in a caption ("this
// little guy…") as a request to depict a real child and rejects the call
// (reproduced live, error type image_generation_user_error). The caption is
// the trigger, so the retry drops it and renders the scene from keywords.
// Keywords that themselves trip the safety system: a PHOTOREALISTIC render of
// a "cartoon character" reads as a character-likeness request and is refused
// (reproduced live — the caption-free retry still 400'd until these were
// dropped). Person-words like "guy" are only risky inside the quoted caption,
// which the fallback already omits.
const UNSAFE_KEYWORD = /cartoon|animated|character|mascot|anime|superhero|celebrit|famous/i;

function fallbackPrompt(keywords: string[], topic: string): string | null {
  const safe = keywords
    .map((k) => k.trim())
    .filter((k) => k && !UNSAFE_KEYWORD.test(k))
    .slice(0, 3);
  if (safe.length === 0) return null;
  return (
    "Candid, photorealistic vertical phone photo for a TikTok slideshow " +
    `background, showing: ${safe.join(", ")}. A real, natural scene shot on a ` +
    "phone — authentic lighting, slightly imperfect, NOT a polished studio " +
    "stock photo. Leave calm negative space for a caption overlay. Absolutely " +
    "no text, letters, words, watermarks, or logos in the image."
  );
}

/** One image; null on any failure. Exported for the quality probe script. */
export async function generateOne(
  caption: string,
  keywords: string[],
  topic: string,
): Promise<Buffer | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || apiKey.includes("REPLACE_ME")) return null;
  const { model, quality } = aiImageModel();
  const openai = new OpenAI({ apiKey, timeout: 90_000, maxRetries: 1 });
  const attempt = async (prompt: string): Promise<Buffer | null> => {
    const res = await openai.images.generate({
      model,
      prompt,
      size: "1024x1536", // portrait; the compositor covers to 1080x1920
      quality,
    });
    const b64 = res.data?.[0]?.b64_json;
    return b64 ? Buffer.from(b64, "base64") : null;
  };
  try {
    return await attempt(buildPrompt(caption, keywords, topic));
  } catch (e) {
    const err = e as { status?: number; message?: string };
    console.error(
      `[aiImages] ${model}/${quality} rejected: ${err.status ?? "?"} ${String(err.message ?? e).slice(0, 160)}`,
    );
    // Safety rejections are prompt-shaped, not transient — retry WITHOUT the
    // caption text instead of failing the slide.
    if (err.status === 400) {
      const fb = fallbackPrompt(keywords, topic);
      if (!fb) return null;
      try {
        return await attempt(fb);
      } catch (e2) {
        console.error(
          `[aiImages] caption-free retry also rejected: ${String((e2 as Error).message).slice(0, 160)}`,
        );
      }
    }
    return null;
  }
}

/**
 * Generate a background per slide, shaped like the deck. Runs CONCURRENCY
 * images at a time (each takes ~10-20s; a 10-slide deck fully serial would
 * blow the route's time budget). Slides that fail come back null — the caller
 * fills those from stock.
 */
export async function generateAiBackgrounds(
  content: { caption: string; keywords: string[] }[][],
  topic: string,
  emit?: (done: number, total: number) => void,
): Promise<(Buffer | null)[][]> {
  const flat: { ss: number; i: number; caption: string; keywords: string[] }[] = [];
  content.forEach((slides, ss) =>
    slides.forEach((s, i) => flat.push({ ss, i, ...s })),
  );
  const out: (Buffer | null)[][] = content.map((slides) => slides.map(() => null));
  let done = 0;
  let cursor = 0;
  const worker = async () => {
    for (;;) {
      const idx = cursor++;
      if (idx >= flat.length) return;
      const f = flat[idx];
      out[f.ss][f.i] = await generateOne(f.caption, f.keywords, topic);
      done++;
      emit?.(done, flat.length);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, flat.length) }, worker),
  );
  return out;
}
