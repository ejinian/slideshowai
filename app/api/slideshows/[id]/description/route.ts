import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { createAdminClient } from "@/utils/supabase/admin";
import { isAdminEmail } from "@/lib/admins";
import { claimRateWindow, guardUnavailable } from "@/lib/billing/usage";
import { stripEmoji } from "@/lib/generate/cleanCaption";

// Writes the text that goes UNDER a TikTok post — description + hashtags.
//
// Posts used to go out with the first slide's caption alone, which read as no
// description at all on TikTok. This writes one from the deck's slides (one or
// two lowercase lines + #fyp-style tags) and stores it on the deck
// (gen_meta.postDescription) so re-opening the post modal is instant. The modal
// sends the final text as post_info.description — for PHOTO posts that is the
// field TikTok reads hashtags from (there is no separate tag field).
//
// UNPRICED on purpose: gpt-4o-mini over ~400 tokens is ~0.01¢ — two orders of
// magnitude under the AI stock fallback that is already absorbed unpriced — and
// charging a credit to caption a post the user already paid 3 credits for is
// friction in the one flow that earns the product its keep. Throttled like the
// other model routes (shared per-user window); admins bypass the throttle.
export const runtime = "nodejs";

const THROTTLE_WINDOW_SECS = 5 * 60;
const THROTTLE_MAX = 30;
// The schedule route clamps captions to 2200 (TikTok's video limit); photo
// posts allow 4000. Staying under the smaller one means one description works
// everywhere it can be pasted.
const MAX_CHARS = 2200;
const TOPICAL_TAGS = 4;
// Discovery tags every post carries. Appended AFTER the topical ones so the
// subject-specific tags lead, the way real posts are written.
const ALWAYS_TAGS = ["fyp", "foryou", "foryoupage"];

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["description", "hashtags"],
  properties: {
    description: { type: "string" },
    hashtags: { type: "array", items: { type: "string" } },
  },
} as const;

const SYSTEM = `You write the text that sits UNDER a TikTok photo slideshow (the post's description) and its hashtags. You are shown the slides.

DESCRIPTION
- One or two short lines, at most 25 words in total. The slides already carry the content; this just tells someone scrolling what the post gives them.
- Written by the person who made the slides, in their voice: all lowercase, plain everyday words, no exclamation marks, no emojis, no title case.
- Say the promise or the one takeaway the way a real person would type it under their own post. Do not repeat the first slide word for word, and do not summarise every slide.
- Never write: "swipe", "link in bio", "follow for more", "save this", "you need to", "game-changer", "let's", a question to the reader, or any fact the slides do not state.

HASHTAGS
- Exactly ${TOPICAL_TAGS} tags about the subject of THIS post: the two most specific first (e.g. "armworkout", "proteinintake", "cafehopping", "skincareroutine"), then two broader ones for its world (e.g. "gymtok", "foodtok", "smallbusiness").
- Lowercase, letters and digits only, no spaces, no "#".
- Do NOT include fyp, foryou or foryoupage — they are added automatically.
- Nothing off-subject, no brand names the slides do not mention, nothing misleading.`;

interface Body {
  /** true = write a fresh one even when a stored description exists. */
  rewrite?: boolean;
}

interface SlideRow {
  position: number;
  caption: string | null;
  body: string | null;
}

interface DeckRow {
  id: string;
  title: string | null;
  description: string | null;
  niche: string | null;
  gen_meta: Record<string, unknown> | null;
}

function normalizeTag(raw: string): string {
  return raw
    .trim()
    .replace(/^#+/, "")
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "")
    .slice(0, 40);
}

/** Final post text: description, blank line, hashtags. */
function assemble(description: string, hashtags: string[]): string {
  const desc = stripEmoji(description)
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300);
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const raw of [...hashtags, ...ALWAYS_TAGS]) {
    const t = normalizeTag(raw);
    if (t.length < 2 || seen.has(t)) continue;
    seen.add(t);
    tags.push(t);
    if (tags.length >= TOPICAL_TAGS + ALWAYS_TAGS.length) break;
  }
  // The fixed tags must always make it in, even if the model returned junk.
  for (const t of ALWAYS_TAGS) if (!seen.has(t)) tags.push(t);
  return [desc, tags.map((t) => `#${t}`).join(" ")]
    .filter(Boolean)
    .join("\n\n")
    .slice(0, MAX_CHARS);
}

export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as Body;
  const rewrite = body.rewrite === true;

  // RLS scopes this to the owner. A malformed id (the e2e mock deck, for one)
  // errors at the uuid cast — same answer as a missing row.
  const { data: deck } = await supabase
    .from("slideshows")
    .select("id, title, description, niche, gen_meta")
    .eq("id", id)
    .maybeSingle<DeckRow>();
  if (!deck) return NextResponse.json({ error: "Slideshow not found." }, { status: 404 });

  const stored = deck.gen_meta?.postDescription;
  if (!rewrite && typeof stored === "string" && stored.trim()) {
    return NextResponse.json({ description: stored, cached: true });
  }

  const { data: slides } = await supabase
    .from("slides")
    .select("position, caption, body")
    .eq("slideshow_id", id)
    .order("position", { ascending: true })
    .returns<SlideRow[]>();
  const lines = (slides ?? [])
    .map((s) => {
      const cap = (s.caption ?? "").trim();
      const bod = (s.body ?? "").trim().replace(/\s+/g, " ");
      return cap || bod ? `${s.position + 1}. ${[cap, bod].filter(Boolean).join(" — ")}` : null;
    })
    .filter((l): l is string => !!l);
  if (lines.length === 0) {
    return NextResponse.json({ error: "This slideshow has no text to describe." }, { status: 400 });
  }

  const admin = createAdminClient();
  if (!isAdminEmail(user.email)) {
    const win = await claimRateWindow(admin, user.id, THROTTLE_MAX, THROTTLE_WINDOW_SECS);
    if (!win.ok) {
      if (win.reason === "error") return guardUnavailable(win.detail);
      return NextResponse.json({ error: "Slow down a moment." }, { status: 429 });
    }
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || apiKey.includes("REPLACE_ME")) {
    return NextResponse.json({ error: "OPENAI_API_KEY is not configured." }, { status: 500 });
  }

  const brief = [
    deck.title ? `Title: ${deck.title}` : null,
    deck.description ? `Topic the creator typed: ${deck.description}` : null,
    deck.niche ? `Niche: ${deck.niche}` : null,
    "Slides:",
    ...lines,
  ]
    .filter(Boolean)
    .join("\n");

  try {
    const { default: OpenAI } = await import("openai");
    const openai = new OpenAI({ apiKey, timeout: 20_000, maxRetries: 1 });
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: brief },
      ],
      response_format: {
        type: "json_schema",
        json_schema: { name: "post_description", strict: true, schema: SCHEMA },
      },
    });
    const parsed = JSON.parse(completion.choices[0]?.message?.content ?? "{}") as {
      description?: string;
      hashtags?: string[];
    };
    const description = assemble(parsed.description ?? "", parsed.hashtags ?? []);
    if (!description) throw new Error("empty description");

    // Store it on the deck. The browser's update grant on slideshows excludes
    // gen_meta (20260806130000), so this goes through the admin client after the
    // owner check above. Best-effort: a failed write just means the next open
    // writes a fresh one.
    const { error: saveErr } = await admin
      .from("slideshows")
      .update({ gen_meta: { ...(deck.gen_meta ?? {}), postDescription: description } })
      .eq("id", deck.id);
    if (saveErr) console.warn("[slideshows/description] not stored", saveErr.message);

    return NextResponse.json({ description, cached: false });
  } catch (e) {
    console.error("[slideshows/description] failed", {
      id,
      error: e instanceof Error ? e.message : String(e),
    });
    return NextResponse.json(
      { error: "Couldn't write a description — try again." },
      { status: 502 },
    );
  }
}
