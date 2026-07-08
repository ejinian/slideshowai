import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { GENERATOR_NICHES } from "@/lib/generator-options";
import { TEMPLATES } from "@/lib/templates";

// "Use template": personalize a curated format to the user's business.
// gpt-4o-mini writes a Generator-ready prompt from the template's mechanic +
// anatomy + the user's onboarding profile; the client drops it into the
// Generator's draft-restore slot (same handoff as trend remix).
export const runtime = "nodejs";

// Onboarding niche → Generator niche option value.
const ONBOARDING_TO_GENERATOR: Record<string, string> = {
  "Gym & Fitness": "gym",
  "Food & Dining": "food",
  "E-commerce": "ecommerce",
  "SaaS / Apps": "ecommerce",
  "Coaching & Services": "ecommerce",
  "Fashion & Beauty": "fashion",
  "Real Estate": "realestate",
};

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["prompt"],
  properties: {
    prompt: { type: "string" },
  },
} as const;

const SYSTEM = `You help a small-business owner apply a proven TikTok photo-slideshow FORMAT to their own business. You are given the format (name, mechanic, slide-by-slide anatomy, example hook) and the owner's business.

Write "prompt": 1-2 sentences of instructions for a slideshow generator, telling it what to make — this exact format mechanic applied to THIS business, concrete and specific. Reference real-feeling specifics a business of that kind would have. Never copy the example hook verbatim; adapt its mechanic.`;

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = (await request.json().catch(() => ({}))) as { id?: string };
  const template = TEMPLATES.find((t) => t.id === id);
  if (!template) {
    return NextResponse.json({ error: "Template not found." }, { status: 404 });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || apiKey.includes("REPLACE_ME")) {
    return NextResponse.json(
      { error: "OPENAI_API_KEY is not configured." },
      { status: 500 },
    );
  }

  const meta = user.user_metadata ?? {};
  const business = {
    name: (meta.business_name as string) || "my business",
    niche: (meta.niche as string) || "small business",
    goal: (meta.goal as string) || null,
  };

  const { default: OpenAI } = await import("openai");
  const openai = new OpenAI({ apiKey, timeout: 45_000, maxRetries: 1 });
  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: SYSTEM },
      {
        role: "user",
        content: JSON.stringify({
          format: {
            name: template.name,
            mechanic: template.mechanic,
            anatomy: template.anatomy,
            example_hook: template.exampleHook,
            slide_count: template.slideCount,
          },
          business,
        }),
      },
    ],
    response_format: {
      type: "json_schema",
      json_schema: { name: "template_apply", strict: true, schema: SCHEMA },
    },
  });

  const parsed = JSON.parse(
    completion.choices[0]?.message?.content ?? "{}",
  ) as { prompt?: string };
  const prompt = (parsed.prompt ?? "").trim();
  if (!prompt) {
    return NextResponse.json(
      { error: "Personalization failed — try again." },
      { status: 502 },
    );
  }

  const niche =
    ONBOARDING_TO_GENERATOR[business.niche] ?? GENERATOR_NICHES[0].value;

  return NextResponse.json({
    prompt,
    slides: String(template.slideCount),
    niche,
    layout: template.layout,
  });
}
