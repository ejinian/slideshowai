import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { createAdminClient } from "@/utils/supabase/admin";
import { isAdminEmail } from "@/lib/admins";
import { claimRateWindow, guardUnavailable } from "@/lib/billing/usage";
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

  // This route had NO throttle at all — the auth check was its only guard, and
  // it calls gpt-4o-mini on every request.
  if (!isAdminEmail(user.email)) {
    const win = await claimRateWindow(createAdminClient(), user.id, 30, 5 * 60);
    if (!win.ok) {
      if (win.reason === "error") return guardUnavailable(win.detail);
      return NextResponse.json(
        { error: "Slow down a moment and try again." },
        { status: 429 },
      );
    }
  }

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

  // user_metadata is BROWSER-WRITABLE (supabase.auth.updateUser with the anon
  // key) and onboarding never clamped it, so these strings are attacker-
  // controlled and land straight in the prompt. Clamp every one.
  //
  // Reading the profile here at all is the deliberate exception to "the
  // onboarding profile must never enter a creative prompt" — remixing a trend
  // FOR YOUR BUSINESS is the whole feature. See CLAUDE.md.
  const meta = user.user_metadata ?? {};
  const metaStr = (v: unknown, max: number) =>
    typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null;
  const business = {
    name: metaStr(meta.business_name, 80) || "my business",
    niche: metaStr(meta.niche, 40) || trend.niche,
    goal: metaStr(meta.goal, 40),
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
  // Open library niches (Self Improvement, StudyTok, …) have no fixed
  // generator collection — "other" makes image selection lean on the prompt.
  const genNiche = TREND_TO_GENERATOR_NICHE[trend.niche] ?? "other";

  return NextResponse.json({
    prompt,
    slides: String(slides),
    niche: genNiche,
    // The trend's format recipe rides along so /api/generate can mirror the
    // trend's mechanic slide-by-slide instead of just the prompt's vibe.
    format: {
      hookType: trend.hook_type ?? null,
      exemplarCaption: trend.title || null,
      anatomy: (trend.anatomy as AnatomyBeat[] | null) ?? null,
    },
  });
}
