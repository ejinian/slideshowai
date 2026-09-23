import OpenAI from "openai";
import type { SupabaseClient } from "@supabase/supabase-js";
import { renderSlideJpeg } from "@/lib/generate/renderSlide";

// The last check before a deck is offered for posting: one vision call over
// the slides exactly as they will render, plus the post description. It is a
// recommendation, not a gate — semi-automatic mode parks every deck for a
// human, and this verdict tells them where to look first. Distinct from the
// Supercharge judge inside generation (which edits copy): this one sees the
// FINISHED slides, so it catches what only shows up after compositing —
// caption over baked-in text, unreadable contrast, a photo that plainly
// doesn't belong.

export interface AutopilotReview {
  verdict: "post" | "hold";
  score: number;
  issues: string[];
  summary: string;
  model: string;
}

const REVIEW_MODEL = process.env.AUTOPILOT_REVIEW_MODEL || "gpt-4o";
const RENDER_WIDTH = 540;

const SYSTEM =
  "You are the final check before a TikTok photo slideshow is posted from a real account. " +
  "You see every slide exactly as it will appear, in order, plus the text that goes under the post.\n" +
  "Judge, in this order:\n" +
  "1. Legibility — every caption is readable over its photo; nothing cut off, nothing empty.\n" +
  "2. Collision — no caption sits on top of text that is already in the photo (screen text, quotes, signs).\n" +
  "3. Fit — each photo can plausibly sit behind its caption. It is a backdrop, not an illustration, so a " +
  "gym photo under a training tip is fine; a plainly unrelated or absurd pairing is not.\n" +
  "4. Promise — the first slide promises something and the rest deliver it; no filler, no contradiction.\n" +
  "5. Description — the text under the post matches the deck and has no obvious error.\n" +
  "verdict 'post' means you would let it go out exactly as-is. 'hold' means a person should look first. " +
  "score is 1-10 overall. issues: one short line per real problem, naming the slide number; empty when clean. " +
  "summary: one plain sentence. No emoji.";

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["verdict", "score", "issues", "summary"],
  properties: {
    verdict: { type: "string", enum: ["post", "hold"] },
    score: { type: "integer" },
    issues: { type: "array", items: { type: "string" } },
    summary: { type: "string" },
  },
} as const;

export async function reviewSlideshow(
  admin: SupabaseClient,
  slideshowId: string,
  topic: string,
  description: string,
): Promise<AutopilotReview> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not set.");

  const { data: slides, error } = await admin
    .from("slides")
    .select("position, caption")
    .eq("slideshow_id", slideshowId)
    .order("position", { ascending: true });
  if (error) throw new Error(error.message);
  if (!slides?.length) throw new Error("Slideshow has no slides.");

  const renders = await Promise.all(
    slides.map((s) => renderSlideJpeg(admin, slideshowId, s.position as number, RENDER_WIDTH)),
  );

  const content: Array<
    | { type: "text"; text: string }
    | { type: "image_url"; image_url: { url: string; detail: "high" } }
  > = [
    {
      type: "text",
      text: `Topic the deck was generated from: ${topic}\n\nText under the post:\n${description || "(none)"}\n\n${slides.length} slides follow, in order.`,
    },
  ];
  renders.forEach((r, i) => {
    content.push({ type: "text", text: `slide ${i + 1} — caption: "${(slides[i].caption as string | null) ?? ""}"` });
    if (r.ok) {
      content.push({
        type: "image_url",
        image_url: { url: `data:image/jpeg;base64,${r.jpeg.toString("base64")}`, detail: "high" },
      });
    } else {
      content.push({ type: "text", text: "(this slide failed to render)" });
    }
  });

  const openai = new OpenAI({ apiKey, timeout: 90_000, maxRetries: 1 });
  const completion = await openai.chat.completions.create({
    model: REVIEW_MODEL,
    temperature: 0,
    messages: [
      { role: "system", content: SYSTEM },
      { role: "user", content },
    ],
    response_format: {
      type: "json_schema",
      json_schema: { name: "autopilot_review", strict: true, schema: SCHEMA },
    },
  });
  const parsed = JSON.parse(completion.choices[0]?.message?.content ?? "{}") as Partial<AutopilotReview>;
  const rendersFailed = renders.filter((r) => !r.ok).length;
  const issues = (parsed.issues ?? []).map((s) => String(s).trim()).filter(Boolean).slice(0, 12);
  if (rendersFailed > 0) issues.unshift(`${rendersFailed} slide(s) failed to render for review.`);
  return {
    verdict: parsed.verdict === "post" && rendersFailed === 0 ? "post" : "hold",
    score: Math.min(10, Math.max(1, Math.round(Number(parsed.score) || 1))),
    issues,
    summary: String(parsed.summary ?? "").trim().slice(0, 300),
    model: REVIEW_MODEL,
  };
}
