import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { GENERATOR_NICHES } from "@/lib/generator-options";
import type { AnatomyBeat } from "@/lib/trends";

// "Remix this trend": transplant a trending post's FORMAT onto the user's own
// business. gpt-4o-mini writes a Generator-ready topic prompt from the trend's
// caption + anatomy + the user's onboarding profile; the client drops it into
// the Generator's draft-restore slot and navigates there.
export const runtime = "nodejs";

// Trends business type → Generator niche option value.
const TREND_TO_GENERATOR_NICHE: Record<string, string> = {
  "Gym & Fitness": "gym",
  "Food & Dining": "food",
  "E-commerce": "ecommerce",
  "B2C App": "ecommerce",
  "Local Service": "ecommerce",
};

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["prompt", "slide_count"],
  properties: {
    prompt: { type: "string" },
    slide_count: { type: "integer" },
  },
} as const;

const SYSTEM = `You help a small-business owner remix a trending TikTok photo-slideshow FORMAT for their own business. You are given the trend (caption, format label, slide-by-slide anatomy) and the owner's business.

Write "prompt": 1-2 sentences of instructions for a slideshow generator, telling it what to make — the SAME format mechanic (hook type, structure, payoff) applied to THIS business. Concrete and specific to the business, never a copy of the trend's subject. Example: trend "POV: day 1 at the gym vs day 180" for a coffee shop becomes "A transformation-arc slideshow: our cafe on opening day vs today — start with the empty room, end with the morning rush and a 'come see day 1000' invite."

Write "slide_count": the trend's slide count when known (clamp 4-8), else 6.`;

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = (await request.json().catch(() => ({}))) as { id?: string };
  if (!id) return NextResponse.json({ error: "Missing trend id." }, { status: 400 });

  interface TrendRow {
    title: string;
    niche: string;
    slide_count: number;
    why_it_works?: string | null;
    hook_type?: string | null;
    anatomy?: AnatomyBeat[] | null;
  }
  let trend = (
    await supabase
      .from("trending_posts")
      .select("title, niche, slide_count, why_it_works, hook_type, anatomy")
      .eq("id", id)
      .maybeSingle()
  ).data as TrendRow | null;
  if (!trend) {
    // Inspiration (hall of fame) posts remix the same way.
    trend = (
      await supabase
        .from("inspiration_posts")
        .select("title, niche, slide_count, why_it_works, hook_type, anatomy")
        .eq("id", id)
        .maybeSingle()
    ).data as TrendRow | null;
  }
  if (!trend) {
    // Insight columns may not be migrated yet — remix works from basics too.
    trend = (
      await supabase
        .from("trending_posts")
        .select("title, niche, slide_count")
        .eq("id", id)
        .maybeSingle()
    ).data as TrendRow | null;
  }
  if (!trend) return NextResponse.json({ error: "Trend not found." }, { status: 404 });

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
    niche: (meta.niche as string) || trend.niche,
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
          trend: {
            caption: trend.title,
            niche: trend.niche,
            hook_type: trend.hook_type,
            why_it_works: trend.why_it_works,
            slide_count: trend.slide_count || null,
            anatomy: (trend.anatomy as AnatomyBeat[] | null) ?? undefined,
          },
          business,
        }),
      },
    ],
    response_format: {
      type: "json_schema",
      json_schema: { name: "remix", strict: true, schema: SCHEMA },
    },
  });

  const parsed = JSON.parse(
    completion.choices[0]?.message?.content ?? "{}",
  ) as { prompt?: string; slide_count?: number };
  const prompt = (parsed.prompt ?? "").trim();
  if (!prompt) {
    return NextResponse.json({ error: "Remix failed — try again." }, { status: 502 });
  }

  const slides = Math.min(8, Math.max(4, parsed.slide_count ?? 6));
  const genNiche =
    TREND_TO_GENERATOR_NICHE[trend.niche] ?? GENERATOR_NICHES[0].value;

  return NextResponse.json({ prompt, slides: String(slides), niche: genNiche });
}
