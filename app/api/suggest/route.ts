import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { createAdminClient } from "@/utils/supabase/admin";
import { isAdminEmail } from "@/lib/admins";
import { claimRateWindow } from "@/lib/billing/usage";
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

// DURABLE throttle. This was an in-memory Map whose own comment said the real
// guard was "the 3-round cap" — but that cap is read off the request body, so
// it never existed server-side: send round:0 forever and nothing stops you. The
// Map itself resets on every cold start and is per-lambda, so the effective
// ceiling was (limit × instances). Now it's a row-locked counter in Postgres.
// This endpoint is gpt-4o VISION with up to 10 images, so it is worth guarding.
const THROTTLE_WINDOW_SECS = 5 * 60;
const THROTTLE_MAX = 20;
/** Longest `previous` plan we'll echo back to the model. */
const MAX_PREVIOUS_CHARS = 1200;

// How many directions the planner pitches at once. Three distinct angles in a
// single call reads far clearer than one plan + a refine loop, and costs less
// than three sequential refines.
const OPTION_COUNT = 3;

const PLAN_SCHEMA = {
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

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["options"],
  properties: {
    options: { type: "array", items: PLAN_SCHEMA },
  },
} as const;

const SYSTEM = `You are a viral TikTok Photo Mode creative director. The user hands you some photos (maybe) and an optional line of direction. Your job is to pitch ${OPTION_COUNT} DIFFERENT slideshows they could make from what they gave you — you are choosing SETTINGS, not writing the slides.

Return "options": an array of exactly ${OPTION_COUNT} plans. They must be genuinely DIFFERENT takes on the same material — different hooks and formats, not three rewordings of one idea. Order them best-first. Each plan:
- "niche": the closest niche value from the allowed enum for this content. Use "other" only if nothing else fits.
- "slides": how many slides best fits the idea (${SLIDES_MIN}-${SLIDES_MAX}). Prefer 5-7 unless the angle clearly needs more or fewer.
- "layout": the best layout value from the allowed enum for this angle.
- "goal": the single most valuable goal from the allowed enum for this creator.
- "angle": the concrete hook/direction in ONE short line (under 12 words), plain and punchy. This is what you'll pitch to the user. No hashtags, no emojis, no Title Case, no exclamation marks.
- "prompt": 1-2 sentences stating the TOPIC this deck must deliver. Use the photos to work out what the creator actually does, then write about that SUBJECT — never describe, list or refer to the pictures themselves (banned: "images showcase...", "photos highlight...", "using images that..."). It has to read as a topic brief that would still make sense to someone who never saw the photos. Not addressed to the user. This is what drives every slide.
- "rationale": ONE plain sentence telling the user why this direction fits their photos/idea (builds trust). No jargon.

Rules: Look at the ACTUAL photos and describe slideshows they can genuinely carry — never invent things not present. If the user gave a direction, every option must honor it (vary the FORMAT, not the subject). If they gave none, infer the most scroll-stopping angles from the photos. When you are given a PREVIOUS plan plus the user's change request, ADJUST toward what they asked — the first option should be the closest fit to that request. Never write the individual slide captions here.

THE SUBJECT IS THE DIRECTION AND THE PHOTOS — NOTHING ELSE. The creator's trade or industry is not the subject and must never be blended into it. If the direction is "cool cars", all three options are about cool cars; do not bend them toward whatever business the creator runs. The "niche" field is only a routing label for picking stock imagery and trend examples — it never changes what the deck is about, so when nothing in the enum fits the actual subject, choose "other" rather than the nearest business-shaped match.`;

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

/**
 * Rebuild `previous` from known fields with hard length limits. Never pass the
 * caller's object through: it is untyped at runtime and gets JSON.stringify'd
 * into the prompt, so its size is its token cost.
 */
function clampPrevious(p: unknown): Record<string, unknown> | null {
  if (!p || typeof p !== "object") return null;
  const src = p as Record<string, unknown>;
  const str = (v: unknown, max: number) =>
    typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined;
  const out = {
    niche: str(src.niche, 40),
    angle: str(src.angle, 200),
    goal: str(src.goal, 40),
    layout: str(src.layout, 40),
    prompt: str(src.prompt, 600),
    slides:
      typeof src.slides === "number" && Number.isFinite(src.slides)
        ? Math.min(Math.max(Math.floor(src.slides), 1), 10)
        : undefined,
  };
  const kept = Object.fromEntries(
    Object.entries(out).filter(([, v]) => v !== undefined),
  );
  if (Object.keys(kept).length === 0) return null;
  // Belt and braces: cap the serialized size too, whatever the field mix.
  return JSON.stringify(kept).length > MAX_PREVIOUS_CHARS ? null : kept;
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
  // `body.round` is the CLIENT's view of the 3-per-build cap and drives its UI.
  // It is NOT a security control — the caller chooses it, so it can always be 0.
  // Trust it only to render a nicer message; the DB window below is the guard.
  const round = Number.isFinite(body.round) ? Math.max(0, Math.floor(body.round as number)) : 0;

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

  // THE actual guard — durable and shared across lambdas, unlike body.round.
  if (
    !isAdminEmail(user.email) &&
    !(await claimRateWindow(
      createAdminClient(),
      user.id,
      THROTTLE_MAX,
      THROTTLE_WINDOW_SECS,
    ))
  ) {
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

  // The onboarding profile is deliberately NOT in this brief. It used to pass
  // business_name / niche / goal from user_metadata, and the model treated the
  // stored niche as part of the subject: a landscaper asking for "cool cars"
  // got back three plans about luxury car LANDSCAPES. What the creator sells is
  // not what this post is about. The topic comes from the prompt and the photos,
  // full stop.
  const brief = {
    direction: text || null,
    source: body.source === "stock" ? "stock" : "upload",
    photo_count: images.length,
    // On a refine, hand the model its own last plan + what the user wants
    // changed. CLAMPED: `previous` is a TypeScript interface only, so at runtime
    // it is whatever the caller sent — a multi-megabyte string here went
    // straight into the gpt-4o prompt and billed accordingly.
    previous: clampPrevious(body.previous),
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

    interface RawPlan {
      niche?: string;
      slides?: number;
      layout?: string;
      goal?: string;
      angle?: string;
      prompt?: string;
      rationale?: string;
    }
    const parsed = JSON.parse(completion.choices[0]?.message?.content ?? "{}") as {
      options?: RawPlan[];
    };

    // Validate + clamp every field so a bad model value can never poison
    // /api/generate. Unknown enum → first allowed value; slides clamped to range.
    const options = (parsed.options ?? [])
      .map((raw) => {
        const angle = (raw.angle ?? "").trim();
        const genPrompt = (raw.prompt ?? "").trim();
        if (!angle || !genPrompt) return null;
        return {
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
      })
      .filter((o): o is NonNullable<typeof o> => o !== null)
      .slice(0, OPTION_COUNT);

    if (options.length === 0) {
      return NextResponse.json(
        { error: "Couldn't read a clear direction — try adding a word or two." },
        { status: 502 },
      );
    }

    // `suggestion` stays in the payload for older clients / callers that only
    // understand a single plan.
    return NextResponse.json({ options, suggestion: options[0], round });
  } catch {
    return NextResponse.json(
      { error: "The planner is busy — try again in a moment." },
      { status: 502 },
    );
  }
}
