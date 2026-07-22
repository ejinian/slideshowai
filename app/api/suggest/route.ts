import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import {
  GENERATOR_NICHES,
  GOALS,
  LAYOUTS,
  SLIDE_COUNTS,
} from "@/lib/generator-options";

// "Let AI decide" — the frictionless planner. The user drops in photos (and an
// OPTIONAL prompt) and this endpoint proposes ONE concrete direction: which
// niche the photos fit, the angle/hook, how many slides, which layout, and the
// goal. It is a CONFIG PLANNER only — it never writes slide captions. The user
// approves (or nudges up to 3×) and the UNCHANGED /api/generate does the actual
// slideshow with these values. Keeping generation separate is what guarantees
// the good caption prompts are never touched (see the plan / CLAUDE.md).
export const runtime = "nodejs";

const NICHE_VALUES = GENERATOR_NICHES.map((n) => n.value);
const LAYOUT_VALUES = LAYOUTS.map((l) => l.value);
const SLIDES_MIN = Math.min(...SLIDE_COUNTS);
const SLIDES_MAX = Math.max(...SLIDE_COUNTS);
const MAX_IMAGES = 10;
const MAX_ROUNDS = 3; // suggestion + up to 2 refines; round is 0-based

// Best-effort soft throttle against scripted hammering. In-memory (per server
// instance) — it resets on cold start, which is fine: the real guards are the
// login gate and the 3-round cap. Just stops a single client spamming the model.
const HITS = new Map<string, number[]>();
const THROTTLE_WINDOW_MS = 5 * 60 * 1000;
const THROTTLE_MAX = 20;
function throttled(userId: string, now: number): boolean {
  const recent = (HITS.get(userId) ?? []).filter((t) => now - t < THROTTLE_WINDOW_MS);
  recent.push(now);
  HITS.set(userId, recent);
  return recent.length > THROTTLE_MAX;
}

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["niche", "slides", "layout", "goal", "angle", "prompt", "rationale"],
  properties: {
    niche: { type: "string", enum: NICHE_VALUES },
    slides: { type: "integer" },
    layout: { type: "string", enum: LAYOUT_VALUES },
    goal: { type: "string", enum: GOALS },
    angle: { type: "string" },
    prompt: { type: "string" },
    rationale: { type: "string" },
  },
} as const;

const SYSTEM = `You are a viral TikTok Photo Mode creative director. The user hands you some photos (maybe) and an optional line of direction. Your job is to decide the single best slideshow to make from what they gave you — you are choosing SETTINGS, not writing the slides.

Return exactly one plan:
- "niche": the closest niche value from the allowed enum for this content. Use "other" only if nothing else fits.
- "slides": how many slides best fits the idea (${SLIDES_MIN}-${SLIDES_MAX}). Prefer 5-7 unless the angle clearly needs more or fewer.
- "layout": the best layout value from the allowed enum for this angle.
- "goal": the single most valuable goal from the allowed enum for this creator.
- "angle": the concrete hook/direction in ONE short line (under 12 words), plain and punchy. This is what you'll pitch to the user. No hashtags, no emojis, no Title Case, no exclamation marks.
- "prompt": 1-2 sentences stating the TOPIC this deck must deliver. Use the photos to work out what the creator actually does, then write about that SUBJECT — never describe, list or refer to the pictures themselves (banned: "images showcase...", "photos highlight...", "using images that..."). It has to read as a topic brief that would still make sense to someone who never saw the photos. Not addressed to the user. This is what drives every slide.
- "rationale": ONE plain sentence telling the user why this direction fits their photos/idea (builds trust). No jargon.

Rules: Look at the ACTUAL photos and describe a slideshow they can genuinely carry — never invent things not present. If the user gave a direction, honor it. If they gave none, infer the most scroll-stopping angle from the photos. When you are given a PREVIOUS plan plus the user's change request, ADJUST that plan toward what they asked rather than starting over. Never write the individual slide captions here.`;

interface PreviousPlan {
  niche?: string;
  angle?: string;
  slides?: number;
  goal?: string;
  prompt?: string;
}

interface Body {
  prompt?: string;
  images?: string[];
  source?: "upload" | "stock";
  round?: number;
  previous?: PreviousPlan;
}

// Only genuine image data URLs may reach the model — drop anything else so we
// never forward junk (or huge non-image blobs) to OpenAI.
function validImages(images: unknown): string[] {
  if (!Array.isArray(images)) return [];
  return images
    .filter((s): s is string => typeof s === "string" && s.startsWith("data:image/"))
    .slice(0, MAX_IMAGES);
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as Body;
  const text = (body.prompt ?? "").trim().slice(0, 600);
  const images = validImages(body.images);
  const round = Number.isFinite(body.round) ? Math.max(0, Math.floor(body.round as number)) : 0;

  // Server-side enforcement of the 3-suggestion cap (client enforces too).
  if (round >= MAX_ROUNDS) {
    return NextResponse.json(
      {
        code: "suggest_cap",
        error: "You've reached the 3-suggestion limit — generate, or edit your inputs to start over.",
      },
      { status: 429 },
    );
  }

  // Need SOMETHING to reason about: at least a photo or a few words of direction.
  if (images.length === 0 && text.length < 8) {
    return NextResponse.json(
      { error: "Add a photo or a few words of direction first." },
      { status: 400 },
    );
  }

  const now = Date.now();
  if (throttled(user.id, now)) {
    return NextResponse.json(
      { error: "Slow down a moment and try again." },
      { status: 429 },
    );
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || apiKey.includes("REPLACE_ME")) {
    return NextResponse.json(
      { error: "OPENAI_API_KEY is not configured." },
      { status: 500 },
    );
  }

  // Onboarding profile enriches the context when present.
  const meta = user.user_metadata ?? {};
  const profile = {
    business_name: (meta.business_name as string) || null,
    niche: (meta.niche as string) || null,
    goal: (meta.goal as string) || null,
  };

  const brief = {
    direction: text || null,
    source: body.source === "stock" ? "stock" : "upload",
    photo_count: images.length,
    profile,
    // On a refine, hand the model its own last plan + what the user wants changed.
    previous: body.previous ?? null,
  };

  const userContent: Array<
    | { type: "text"; text: string }
    | { type: "image_url"; image_url: { url: string; detail: "low" } }
  > = [{ type: "text", text: JSON.stringify(brief) }];
  if (images.length > 0) {
    userContent.push({ type: "text", text: "The user's photos:" });
    images.forEach((url, i) => {
      userContent.push({ type: "text", text: `Photo ${i}:` });
      userContent.push({ type: "image_url", image_url: { url, detail: "low" } });
    });
  }

  try {
    const { default: OpenAI } = await import("openai");
    const openai = new OpenAI({ apiKey, timeout: 45_000, maxRetries: 1 });
    const completion = await openai.chat.completions.create({
      // Vision when there are photos to look at; the cheaper text model otherwise.
      model: images.length > 0 ? "gpt-4o" : "gpt-4o-mini",
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: userContent },
      ],
      response_format: {
        type: "json_schema",
        json_schema: { name: "slideshow_plan", strict: true, schema: SCHEMA },
      },
    });

    const raw = JSON.parse(completion.choices[0]?.message?.content ?? "{}") as {
      niche?: string;
      slides?: number;
      layout?: string;
      goal?: string;
      angle?: string;
      prompt?: string;
      rationale?: string;
    };

    const angle = (raw.angle ?? "").trim();
    const genPrompt = (raw.prompt ?? "").trim();
    if (!angle || !genPrompt) {
      return NextResponse.json(
        { error: "Couldn't read a clear direction — try adding a word or two." },
        { status: 502 },
      );
    }

    // Validate + clamp every field so a bad model value can never poison
    // /api/generate. Unknown enum → first allowed value; slides clamped to range.
    const suggestion = {
      niche: NICHE_VALUES.includes(raw.niche ?? "")
        ? (raw.niche as string)
        : NICHE_VALUES.includes(body.previous?.niche ?? "")
          ? (body.previous!.niche as string)
          : NICHE_VALUES[0],
      slides: Math.min(
        SLIDES_MAX,
        Math.max(SLIDES_MIN, Math.round(raw.slides || 6)),
      ),
      layout: LAYOUT_VALUES.includes(raw.layout ?? "")
        ? (raw.layout as string)
        : LAYOUT_VALUES[0],
      goal: GOALS.includes(raw.goal ?? "") ? (raw.goal as string) : GOALS[0],
      angle,
      prompt: genPrompt,
      rationale: (raw.rationale ?? "").trim(),
    };

    return NextResponse.json({ suggestion, round });
  } catch {
    return NextResponse.json(
      { error: "The planner is busy — try again in a moment." },
      { status: 502 },
    );
  }
}
