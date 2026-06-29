import OpenAI from "openai";
// SlideRole lives in the pure layout module (no server deps) so the client-side
// drag editor can share it. Re-exported here to keep existing import sites working.
import type { SlideRole } from "./layout";

// Server-only. Generates a TikTok Photo Mode "listicle" per slideshow:
//   title (numbered hook) → N numbered reasons (one is a native product plug) → CTA.
// Uses OpenAI structured outputs; validates + retries once; then enforces the
// role/number structure by position so compositing styling is always correct.

export type { SlideRole };

export interface ListicleSlide {
  role: SlideRole;
  number: number | null;
  text: string;
}

export interface ListicleRequest {
  niche: string;
  description: string; // the user's "angle / product" box
  slideCount: number;
  slideshowCount: number;
}

interface Structure {
  count: number;
  reasonCount: number;
  plugIndex: number; // 0-based slide index of the plug (a reason slide)
}

// reasonCount = slideCount - 2 (title + cta). Plug defaults to the 3rd slide
// (0-based index 2), clamped to the middle reason when the deck is small.
export function listicleStructure(slideCount: number): Structure {
  const count = Math.min(Math.max(Math.floor(slideCount) || 6, 3), 10);
  const reasonCount = count - 2;
  const firstReason = 1;
  const lastReason = count - 2;
  let plugIndex = 2;
  if (plugIndex < firstReason || plugIndex > lastReason) {
    plugIndex = firstReason + Math.floor((reasonCount - 1) / 2);
  }
  return { count, reasonCount, plugIndex };
}

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    slides: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          role: { type: "string", enum: ["title", "reason", "plug", "cta"] },
          number: { type: ["integer", "null"] },
          text: { type: "string" },
        },
        required: ["role", "number", "text"],
      },
    },
  },
  required: ["slides"],
} as const;

const SYSTEM =
  'You write TikTok Photo Mode "listicle" slideshows for small businesses. ' +
  "Voice: punchy, generic, scroll-stopping, conversational. Short lines (most " +
  "under ~12 words). No hashtags. At most one emoji in the entire slideshow.\n" +
  "A listicle is: a numbered TITLE hook, several numbered REASON slides (generic, " +
  "broadly true, NOT about any product), exactly one PLUG reason that natively " +
  "works in the user's product, and a CTA.\n" +
  "The PLUG must read like just another reason on the list — a reason the product " +
  "happens to solve. It must NOT sound like an ad: no \"buy now\", no brand hype, " +
  "no hard selling. Same tone and length as the other reasons. Only the plug slide " +
  "may reference the product; every other reason stays product-agnostic.";

function buildUser(
  req: ListicleRequest,
  s: Structure,
  variant: number,
): string {
  const plugSlideNumber = s.plugIndex + 1; // 1-based slide position
  const plugReasonNumber = s.plugIndex; // its number among reasons
  return (
    `Niche: ${req.niche}\n` +
    `Product / angle to plug (use ONLY on the plug slide): ${
      req.description ||
      "(none given — make the plug a strong generic reason that implies a simple fix or tool exists, without naming a product)"
    }\n\n` +
    `Build EXACTLY ${s.count} slides, in order:\n` +
    `1. role "title", number ${s.reasonCount}: a numbered listicle hook for this niche. ` +
    `The headline number MUST be ${s.reasonCount} (e.g. "${s.reasonCount} reasons you're ...", "${s.reasonCount} mistakes ..."). Make it a relatable problem or curiosity hook.\n` +
    `2. Slides 2–${s.count - 1}: role "reason", numbered 1..${s.reasonCount}, EXCEPT slide ${plugSlideNumber}, ` +
    `which is role "plug" (number ${plugReasonNumber}). Each reason is one punchy, generic point.\n` +
    `   • The plug (slide ${plugSlideNumber}, reason #${plugReasonNumber}) uses the same reason format but subtly weaves in the product/angle above as the reason — native, not salesy.\n` +
    `3. Slide ${s.count}: role "cta", number null: a short call to action, e.g. "Try it free → link in bio".\n` +
    (variant > 0
      ? `\nThis is variation #${variant + 1}; choose a different hook angle than the other variations.`
      : "")
  );
}

function expectedRole(i: number, s: Structure): SlideRole {
  if (i === 0) return "title";
  if (i === s.count - 1) return "cta";
  return i === s.plugIndex ? "plug" : "reason";
}

function isValid(raw: ListicleSlide[], s: Structure): boolean {
  if (raw.length !== s.count) return false;
  if (raw[0]?.role !== "title") return false;
  if (raw[s.count - 1]?.role !== "cta") return false;
  if (raw.filter((x) => x.role === "plug").length !== 1) return false;
  if (raw[s.plugIndex]?.role !== "plug") return false;
  for (let i = 1; i < s.count - 1; i++) {
    if (i !== s.plugIndex && raw[i]?.role !== "reason") return false;
  }
  return new RegExp(`\\b${s.reasonCount}\\b`).test(raw[0]?.text ?? "");
}

function fallbackText(role: SlideRole, number: number | null): string {
  if (role === "title") return `${number ?? ""} things to know`.trim();
  if (role === "cta") return "Try it free → link in bio";
  return `Reason ${number ?? ""}`.trim();
}

// Enforce role + number by position; keep the model's text (in order).
function normalize(raw: ListicleSlide[], s: Structure): ListicleSlide[] {
  const out: ListicleSlide[] = [];
  for (let i = 0; i < s.count; i++) {
    const role = expectedRole(i, s);
    const number = role === "title" ? s.reasonCount : role === "cta" ? null : i;
    const text = (raw[i]?.text ?? "").trim() || fallbackText(role, number);
    out.push({ role, number, text });
  }
  return out;
}

function isNetworkError(err: unknown): boolean {
  if (!(err instanceof TypeError)) return false;
  const msg = (err as TypeError).message ?? "";
  if (msg.includes("fetch failed") || msg.includes("network")) return true;
  const cause = (err as TypeError & { cause?: unknown }).cause;
  if (cause instanceof Error) {
    const code = (cause as Error & { code?: string }).code ?? "";
    return (
      code.startsWith("UND_ERR") ||
      code === "ECONNRESET" ||
      code === "ECONNREFUSED" ||
      code === "ETIMEDOUT"
    );
  }
  return false;
}

async function callOpenAI(
  openai: OpenAI,
  system: string,
  user: string,
  attempt = 0,
): Promise<ListicleSlide[]> {
  let completion;
  try {
    completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      response_format: {
        type: "json_schema",
        json_schema: { name: "listicle", strict: true, schema: SCHEMA },
      },
    });
  } catch (err) {
    if (err instanceof OpenAI.APIError) {
      if (err.status === 429 || err.code === "insufficient_quota") {
        throw new Error(
          "OpenAI quota exceeded (429). Add credits/billing to your OpenAI account at platform.openai.com → Billing. gpt-4o-mini costs a fraction of a cent per slideshow.",
        );
      }
      if (err.status === 401) {
        throw new Error(
          "OpenAI rejected the API key (401). Double-check OPENAI_API_KEY in .env.local.",
        );
      }
      throw new Error(`OpenAI request failed (${err.status}): ${err.message}`);
    }
    // Transient network error (socket reset, connection drop, etc.) — retry once
    if (isNetworkError(err) && attempt === 0) {
      await new Promise((r) => setTimeout(r, 1500));
      return callOpenAI(openai, system, user, 1);
    }
    if (isNetworkError(err)) {
      throw new Error(
        "Connection to OpenAI dropped twice. This is usually a transient network issue — please try again.",
      );
    }
    throw err;
  }

  const content = completion.choices[0]?.message?.content ?? "{}";
  const parsed = JSON.parse(content) as {
    slides?: { role?: SlideRole; number?: number | null; text?: string }[];
  };
  return (parsed.slides ?? []).map((s) => ({
    role: (s.role ?? "reason") as SlideRole,
    number: s.number ?? null,
    text: (s.text ?? "").trim(),
  }));
}

async function generateOne(
  openai: OpenAI,
  req: ListicleRequest,
  s: Structure,
  variant: number,
): Promise<ListicleSlide[]> {
  const system = SYSTEM;
  let last: ListicleSlide[] = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    const user =
      buildUser(req, s, variant) +
      (attempt > 0
        ? `\n\nYour previous attempt didn't match the required structure. Return EXACTLY ${s.count} slides with roles in order: title, then reasons with the plug at slide ${s.plugIndex + 1}, then cta. The title number must be ${s.reasonCount}.`
        : "");
    last = await callOpenAI(openai, system, user, 0);
    if (isValid(last, s)) return normalize(last, s);
  }
  return normalize(last, s);
}

export async function generateListicle(
  req: ListicleRequest,
): Promise<ListicleSlide[][]> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || apiKey.includes("REPLACE_ME")) {
    throw new Error(
      "OPENAI_API_KEY is not set. Add it to .env.local and restart the dev server.",
    );
  }
  const openai = new OpenAI({ apiKey, timeout: 90_000, maxRetries: 0 });
  const s = listicleStructure(req.slideCount);
  const n = Math.min(Math.max(Math.floor(req.slideshowCount) || 1, 1), 5);

  return Promise.all(
    Array.from({ length: n }, (_, k) => generateOne(openai, req, s, k)),
  );
}
