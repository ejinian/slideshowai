import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { getValidToken, slideProxyUrl } from "@/utils/tiktok";

export const runtime = "nodejs";

const PRIVACY_LEVELS = [
  "PUBLIC_TO_EVERYONE",
  "MUTUAL_FOLLOW_FRIENDS",
  "FOLLOWER_OF_CREATOR",
  "SELF_ONLY",
] as const;
type PrivacyLevel = (typeof PRIVACY_LEVELS)[number];

interface PostBody {
  slideshowId?: string;
  caption?: string;
  privacyLevel?: PrivacyLevel;
  coverIndex?: number;
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: PostBody;
  try {
    body = (await request.json()) as PostBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const { slideshowId, caption = "", privacyLevel = "SELF_ONLY", coverIndex = 0 } = body;
  if (!slideshowId) return NextResponse.json({ error: "slideshowId is required." }, { status: 400 });
  if (!PRIVACY_LEVELS.includes(privacyLevel as PrivacyLevel)) {
    return NextResponse.json({ error: "Invalid privacy level." }, { status: 400 });
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (!appUrl) {
    return NextResponse.json({ error: "NEXT_PUBLIC_APP_URL is not configured." }, { status: 500 });
  }

  // RLS automatically scopes this to the owner
  const { data: slides, error: slidesErr } = await supabase
    .from("slides")
    .select("position")
    .eq("slideshow_id", slideshowId)
    .order("position", { ascending: true });

  if (slidesErr || !slides?.length) {
    return NextResponse.json({ error: "Slideshow not found or has no slides." }, { status: 404 });
  }

  let accessToken: string;
  try {
    accessToken = await getValidToken(supabase, user.id);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "TikTok auth error." },
      { status: 401 },
    );
  }

  const photoImages = slides.map((s) => slideProxyUrl(appUrl, slideshowId, s.position));
  const safeCover = Math.min(Math.max(0, Math.floor(coverIndex)), photoImages.length - 1);

  const tiktokRes = await fetch(
    "https://open.tiktokapis.com/v2/post/publish/content/init/",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=UTF-8",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        media_type: "PHOTO",
        post_mode: "DIRECT_POST",
        post_info: {
          description: caption,
          privacy_level: privacyLevel,
          photo_cover_index: safeCover,
          auto_add_music: true,
          disable_comment: false,
        },
        source_info: {
          source: "PULL_FROM_URL",
          photo_images: photoImages,
        },
      }),
    },
  );

  const tiktokData = await tiktokRes.json() as {
    data?: { publish_id?: string };
    error?: { code?: string; message?: string };
  };

  if (!tiktokRes.ok || (tiktokData.error?.code && tiktokData.error.code !== "ok")) {
    const code = tiktokData.error?.code ?? "";
    console.error("[tiktok/post] init failed", {
      httpStatus: tiktokRes.status,
      error: tiktokData.error,
    });
    let message = tiktokData.error?.message ?? "TikTok post failed.";
    if (code.includes("rate_limit") || code.includes("spam_risk")) {
      message = "Rate limit reached — wait a minute and try again.";
    } else if (code.includes("unaudited")) {
      message = "App not yet audited — your post will go live as private only. That's fine for testing.";
    } else if (code.includes("url_ownership")) {
      message = "Domain not verified with TikTok. Verify your domain in the TikTok developer portal.";
    }
    const status = tiktokRes.status === 429 ? 429 : tiktokRes.status >= 500 ? 502 : 400;
    return NextResponse.json({ error: message }, { status });
  }

  const publishId = tiktokData.data?.publish_id;
  if (!publishId) return NextResponse.json({ error: "No publish_id in TikTok response." }, { status: 502 });

  return NextResponse.json({ publish_id: publishId });
}
