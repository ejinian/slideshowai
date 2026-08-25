// Quality/cost probe for the AI-image feature: renders ONE test image per
// candidate (model, quality) so the default can be picked by eye.
//   node --env-file=.env.local scripts/probe-ai-images.mjs
import OpenAI from "openai";
import { writeFile, mkdir } from "node:fs/promises";

const CANDS = [
  ["gpt-image-2", "low"],
  ["gpt-image-2", "medium"],
  ["gpt-image-1-mini", "medium"],
];
const prompt =
  "Candid, photorealistic vertical phone photo for a TikTok slideshow background. " +
  "The deck is about: 5 gym mistakes keeping your bench press stuck. This slide " +
  "shows: bench press, barbell, dark gym. A real, natural scene shot on a phone — " +
  "authentic lighting, slightly imperfect, NOT a polished studio stock photo. Leave " +
  "calm negative space for a caption overlay. Absolutely no text, letters, words, " +
  "watermarks, or logos in the image.";

const openai = new OpenAI({ timeout: 120_000 });
await mkdir("diagnostics/ai-image-probe", { recursive: true });
for (const [model, quality] of CANDS) {
  const t0 = Date.now();
  try {
    const res = await openai.images.generate({ model, prompt, size: "1024x1536", quality });
    const b64 = res.data?.[0]?.b64_json;
    if (!b64) { console.log(`${model}/${quality}: NO IMAGE`, JSON.stringify(res).slice(0,200)); continue; }
    const f = `diagnostics/ai-image-probe/${model}-${quality}.png`;
    await writeFile(f, Buffer.from(b64, "base64"));
    console.log(`${model}/${quality}: ok ${((Date.now()-t0)/1000).toFixed(1)}s → ${f}`);
  } catch (e) {
    console.log(`${model}/${quality}: ERROR ${e?.status ?? ""} ${String(e?.message ?? e).slice(0,140)}`);
  }
}
