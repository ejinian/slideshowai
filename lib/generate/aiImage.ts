import OpenAI from "openai";

// Last-resort background: generate a bespoke, on-topic photo when neither the
// user's uploads nor live Pexels can supply an image that actually depicts the
// caption. This is the only path that GUARANTEES the image matches the caption
// (it draws exactly the subject). Gated to paid plans by the caller — image gen
// costs real money and is slow (~15s). Returns null on any failure so the
// caller can fall back to the best available stock photo.

export async function generateBackground(
  caption: string,
  keywords: string[],
): Promise<Buffer | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || apiKey.includes("REPLACE_ME")) return null;

  const subject = keywords
    .map((k) => k.trim())
    .filter(Boolean)
    .slice(0, 3)
    .join(", ");
  const prompt =
    "Candid, photorealistic vertical phone photo for a TikTok slideshow " +
    `background. Subject: ${subject || caption}. A real, natural scene shot on ` +
    "an iPhone — authentic lighting, slightly imperfect, NOT a polished studio " +
    "stock photo. Leave calm negative space for a caption overlay. Absolutely no " +
    "text, letters, words, watermarks, or logos in the image.";

  try {
    const openai = new OpenAI({ apiKey, timeout: 120_000, maxRetries: 0 });
    const res = await openai.images.generate({
      model: "gpt-image-1",
      prompt,
      size: "1024x1536", // portrait; compositor crops to 1080x1920
      quality: "low",
    });
    const b64 = res.data?.[0]?.b64_json;
    return b64 ? Buffer.from(b64, "base64") : null;
  } catch {
    return null;
  }
}
