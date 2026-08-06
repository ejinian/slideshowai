import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { createAdminClient } from "@/utils/supabase/admin";
import { isAdminEmail } from "@/lib/admins";
import { claimRateWindow } from "@/lib/billing/usage";
import { assessPrompt } from "@/lib/generate/promptStrength";

// Sharpen a vague composer prompt into topics that can actually carry a deck.
//
// Deliberately NOT /api/suggest. That one is a config planner — it also picks
// niche, slides, layout and goal, so adopting one of its ideas quietly
// overrides settings the user already chose. This returns prompt lines and
// nothing else: tapping one changes the text in the box and leaves every other
// control exactly where it was. Text-only and gpt-4o-mini, because it fires
// from a nudge under the composer and has to feel instant.
export const runtime = "nodejs";

const OPTION_COUNT = 3;
const MAX_PROMPT = 300;

// Durable throttle (was an in-memory Map that reset on cold start and was
// per-lambda, so the real ceiling was limit × instances). Cheapest of the model
// endpoints — gpt-4o-mini, text-only, 300-char clamp — hence the roomier limit.
const THROTTLE_WINDOW_SECS = 5 * 60;
const THROTTLE_MAX = 30;

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["options"],
  properties: {
    options: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["prompt", "why"],
        properties: {
          prompt: { type: "string" },
          why: { type: "string" },
        },
      },
    },
  },
} as const;

const SYSTEM = `You rewrite a vague TikTok slideshow idea into ${OPTION_COUNT} sharper ones.

A slideshow spreads because someone finishes it knowing something genuinely useful. A vague subject ("cool cars", "my gym") can only produce slides nobody acts on — "vintage style meets modern design", "consistency is what matters". Your job is to turn the subject into a topic with something to DELIVER.

THE SUBJECT NEVER CHANGES. If they typed "cool cars", all ${OPTION_COUNT} rewrites are about cars. Do not drift to an adjacent topic and do not bend the idea toward any industry or business — you know nothing about who is asking.

Return "options": exactly ${OPTION_COUNT} rewrites. Each:
- "prompt": the sharpened topic, one line, under 90 characters. It must add ONE of: a specific count ("4 …"), a concrete promise or outcome, a named thing, a contrarian claim, or a clear audience. Write it the way the user would type it into a box — a topic, not a sentence addressed to anyone. Plain lowercase phrasing; no Title Case, no exclamation marks, no emojis, no hashtags, no clichés ("game-changer", "you're probably making", "level up").
- "why": at most 8 words on what this version gives a viewer that the original didn't. Plain language.

The ${OPTION_COUNT} must be genuinely different SHAPES — e.g. a numbered list, a myth being corrected, a comparison, a before/after. Not three rewordings of one idea.`;

interface Body {
  prompt?: string;
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as Body;
  const prompt = (body.prompt ?? "").trim().slice(0, MAX_PROMPT);

  if (prompt.length < 2) {
    return NextResponse.json({ error: "Type an idea first." }, { status: 400 });
  }
  // The client gates on this too. Re-checked here so the endpoint can't be used
  // as a general rewriter for prompts that are already specific enough.
  if (!assessPrompt(prompt).weak) {
    return NextResponse.json({ options: [] });
  }

  if (
    !isAdminEmail(user.email) &&
    !(await claimRateWindow(
      createAdminClient(),
      user.id,
      THROTTLE_MAX,
      THROTTLE_WINDOW_SECS,
    ))
  ) {
    return NextResponse.json({ error: "Slow down a moment." }, { status: 429 });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || apiKey.includes("REPLACE_ME")) {
    return NextResponse.json({ error: "OPENAI_API_KEY is not configured." }, { status: 500 });
  }

  try {
    const { default: OpenAI } = await import("openai");
    const openai = new OpenAI({ apiKey, timeout: 20_000, maxRetries: 1 });
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: `Their idea: ${prompt}` },
      ],
      response_format: {
        type: "json_schema",
        json_schema: { name: "sharpened_prompts", strict: true, schema: SCHEMA },
      },
    });

    const parsed = JSON.parse(completion.choices[0]?.message?.content ?? "{}") as {
      options?: { prompt?: string; why?: string }[];
    };

    const options = (parsed.options ?? [])
      .map((o) => ({
        prompt: (o.prompt ?? "").trim().slice(0, 140),
        why: (o.why ?? "").trim().slice(0, 80),
      }))
      // A rewrite that came back just as vague is worse than no suggestion —
      // it would send the user straight back into the same forgettable deck.
      .filter((o) => o.prompt.length > 0 && !assessPrompt(o.prompt).weak)
      .slice(0, OPTION_COUNT);

    return NextResponse.json({ options });
  } catch {
    return NextResponse.json({ error: "Couldn't sharpen that — try again." }, { status: 502 });
  }
}
