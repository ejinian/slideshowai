import sharp from "sharp";
import { tryCopyModel } from "./copyModel";
import { SLIDE_W, SLIDE_H } from "./layout";
import type { Theme } from "./productExplainer";

// HIGGSFIELD EXPERIMENT — generated art behind the designed carousels.
//
// LOCAL-ONLY, opt-in: HIGGSFIELD_ART=on in .env.local plus a key pair from
// console.higgsfield.ai (HIGGSFIELD_API_KEY_ID / HIGGSFIELD_API_KEY_SECRET).
// Never runs on Vercel, whatever the env says — it is unpriced (no costOf
// term) and unproven, the same footing as GEN_JUDGE=off.
//
// What it does: one cinematic 9:16 still per deck from Higgsfield Soul
// (text-to-image), themed to the business/product, used as the backdrop of
// every slide under a veil in the deck's colours. What it deliberately does
// NOT do: touch the business's own photos. A restyled listing photo or a
// re-rendered headshot misrepresents a real house or a real person; the art
// is atmosphere only — no people, no buildings that could pass for a listing,
// no text.
//
// API (docs.higgsfield.ai, OpenAPI checked 2026-10-07): POST
// https://api.higgsfield.ai/<model> with `Authorization: Key <id>:<secret>`
// → {status, request_id, status_url}; poll status_url until status is
// completed | failed | nsfw | canceled; the result is images[0].url.

const BASE = "https://api.higgsfield.ai";
const SUBMIT_TIMEOUT_MS = 15_000;
const TOTAL_BUDGET_MS = 100_000;

export function higgsfieldEnabled(): boolean {
  if (process.env.HIGGSFIELD_ART !== "on") return false;
  if (process.env.VERCEL || process.env.VERCEL_ENV) return false;
  if (process.env.NODE_ENV === "production") return false;
  return !!(process.env.HIGGSFIELD_API_KEY_ID && process.env.HIGGSFIELD_API_KEY_SECRET);
}

function model(): string {
  return (process.env.HIGGSFIELD_MODEL || "higgsfield-ai/soul/standard").replace(/^\/+|\/+$/g, "");
}

function authHeader(): string {
  return `Key ${process.env.HIGGSFIELD_API_KEY_ID}:${process.env.HIGGSFIELD_API_KEY_SECRET}`;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface BackdropResult {
  image: Buffer | null;
  prompt: string;
  model: string;
  requestId: string | null;
  status: string;
  error: string | null;
  ms: number;
}

/** Submit one text-to-image job and poll it to the end. Never throws. */
export async function generateBackdrop(prompt: string): Promise<BackdropResult> {
  const started = Date.now();
  const out: BackdropResult = { image: null, prompt, model: model(), requestId: null, status: "not_started", error: null, ms: 0 };
  const done = () => ({ ...out, ms: Date.now() - started });
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), SUBMIT_TIMEOUT_MS);
    const res = await fetch(`${BASE}/${model()}`, {
      method: "POST",
      signal: ctl.signal,
      headers: { Authorization: authHeader(), "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ prompt, aspect_ratio: "9:16", resolution: "2K", num_images: 1 }),
    }).finally(() => clearTimeout(t));
    const body = (await res.json().catch(() => ({}))) as {
      status?: string;
      request_id?: string;
      status_url?: string;
      detail?: string;
      images?: { url?: string }[];
    };
    if (!res.ok) {
      out.status = `http_${res.status}`;
      out.error = body.detail ?? `submit failed (${res.status})`;
      return done();
    }
    out.requestId = body.request_id ?? null;
    out.status = body.status ?? "queued";
    let last = body;
    const statusUrl = body.status_url ?? (body.request_id ? `${BASE}/requests/${body.request_id}/status` : null);
    // 2s, growing to 10s, with jitter — the docs' recommended polling shape.
    let wait = 2000;
    while (statusUrl && !["completed", "failed", "nsfw", "canceled"].includes(out.status)) {
      if (Date.now() - started > TOTAL_BUDGET_MS) {
        out.error = "timed out waiting for the image";
        return done();
      }
      await sleep(wait + Math.random() * 400);
      wait = Math.min(10_000, Math.round(wait * 1.5));
      const s = await fetch(statusUrl, { headers: { Authorization: authHeader(), Accept: "application/json" } });
      last = (await s.json().catch(() => ({}))) as typeof body;
      if (!s.ok) {
        out.status = `http_${s.status}`;
        out.error = last.detail ?? "status check failed";
        return done();
      }
      out.status = last.status ?? out.status;
    }
    if (out.status !== "completed") {
      out.error = (last as { error?: string }).error ?? `ended as ${out.status}`;
      return done();
    }
    const url = last.images?.[0]?.url;
    if (!url) {
      out.error = "completed with no image url";
      return done();
    }
    const img = await fetch(url);
    if (!img.ok) {
      out.error = `image download ${img.status}`;
      return done();
    }
    out.image = await sharp(Buffer.from(await img.arrayBuffer()))
      .resize(SLIDE_W, SLIDE_H, { fit: "cover", position: "attention" })
      .jpeg({ quality: 90 })
      .toBuffer();
    return done();
  } catch (e) {
    out.error = e instanceof Error ? e.message : String(e);
    return done();
  }
}

const PROMPT_SYSTEM =
  "You write ONE image prompt for a text-to-image model. The image is the dark, " +
  "atmospheric BACKDROP of a designed social-media carousel about the subject " +
  "below — big white type and cards will sit on top of it, so it must be calm " +
  "and mostly dark with one area of light. Write 30-55 words: a cinematic " +
  "photograph of a SETTING or MOOD that belongs to the subject (the light, " +
  "the place, the materials, the time of day), shot on film, shallow depth of " +
  "field, deep shadows, rich colour — think textures, light and landscape " +
  "(hills at dusk, warm light on stone, rain on glass, paper and ink), never " +
  "objects that claim something. MUST NOT APPEAR, and do not mention them even " +
  "as silhouettes or in the distance: people, faces, hands, text, letters, " +
  "logos, signs, screens, monitors, phones, houses, homes, buildings, " +
  "storefronts, products. (A house in the art of a realtor's deck reads as one " +
  "of their listings — it isn't.) End the prompt with: no people, no " +
  "buildings, no screens, no text. Return only the prompt.";

/** The scene prompt for a deck. Falls back to a plain template. */
export async function backdropPrompt(subject: string): Promise<string> {
  const fallback =
    `cinematic dark atmospheric backdrop evoking ${subject.slice(0, 120)}, ` +
    "shot on film, deep shadows, soft rim light, shallow depth of field, no people, no text";
  const cm = tryCopyModel({ timeoutMs: 20_000 });
  if (!cm) return fallback;
  try {
    const c = await cm.client.chat.completions.create({
      model: cm.model,
      temperature: 0.8,
      messages: [
        { role: "system", content: PROMPT_SYSTEM },
        { role: "user", content: subject.slice(0, 1200) },
      ],
    });
    const p = c.choices[0]?.message?.content?.trim();
    return p && p.length > 20 ? p.slice(0, 600) : fallback;
  } catch {
    return fallback;
  }
}

/**
 * The deck's theme over art: cards get a near-opaque fill (a 4% white card
 * vanishes on a photo) and a slightly stronger stroke.
 */
export function backdropTheme(theme: Theme): Theme {
  return { ...theme, card: "rgba(8,10,12,0.72)" };
}

/**
 * Start the deck's backdrop job (runs alongside the copy call). Null when the
 * experiment is off and no override was given. `override` lets a local script
 * test the look with any image, no key needed.
 */
export function startBackdrop(subject: string, override?: Buffer | null): Promise<BackdropResult | null> {
  if (override) {
    return sharp(override)
      .resize(SLIDE_W, SLIDE_H, { fit: "cover", position: "attention" })
      .jpeg({ quality: 90 })
      .toBuffer()
      .then((image) => ({ image, prompt: "(override)", model: "override", requestId: null, status: "completed", error: null, ms: 0 }));
  }
  if (!higgsfieldEnabled()) return Promise.resolve(null);
  return backdropPrompt(subject).then(generateBackdrop);
}

/** Diagnostics for a backdrop run (the image itself + what happened). */
export async function logBackdrop(
  diag: { json(n: string, o: unknown): Promise<void>; image(n: string, b: Buffer): Promise<void> } | null | undefined,
  bd: BackdropResult | null,
): Promise<void> {
  if (!diag || !bd) return;
  await diag.json("03h_higgsfield_backdrop.json", { ...bd, image: bd.image ? `${bd.image.length} bytes` : null });
  if (bd.image) await diag.image("images/higgsfield_backdrop", bd.image);
}
