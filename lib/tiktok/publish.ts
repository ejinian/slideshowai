import type { SupabaseClient } from "@supabase/supabase-js";
import { getValidToken, slideProxyUrl } from "@/utils/tiktok";

// The publish core, extracted from /api/tiktok/post so the scheduled-post
// publisher (service role, no session) can reuse it. Ownership is checked
// explicitly — do NOT rely on RLS here, the admin client bypasses it.

export const PRIVACY_LEVELS = [
  "PUBLIC_TO_EVERYONE",
  "MUTUAL_FOLLOW_FRIENDS",
  "FOLLOWER_OF_CREATOR",
  "SELF_ONLY",
] as const;
export type PrivacyLevel = (typeof PRIVACY_LEVELS)[number];

export interface PublishOptions {
  slideshowId: string;
  caption?: string;
  privacyLevel?: PrivacyLevel;
  coverIndex?: number;
  // DIRECT_POST = publish immediately; MEDIA_UPLOAD = send to TikTok drafts.
  postMode?: "DIRECT_POST" | "MEDIA_UPLOAD";
  autoAddMusic?: boolean;
  // TikTok UX-compliance fields (chosen by the user in the post modal):
  //  - disableComment: mirrors the "Allow comments" toggle (inverted).
  //  - brandOrganic / brandContent: the commercial-content disclosure.
  disableComment?: boolean;
  brandOrganic?: boolean;
  brandContent?: boolean;
}

export type PublishOutcome =
  | { ok: true; publishId: string; coverIndex: number; draft: boolean }
  | { ok: false; error: string; status: number };

export async function publishSlideshowToTikTok(
  supabase: SupabaseClient,
  userId: string,
  opts: PublishOptions,
): Promise<PublishOutcome> {
  const {
    slideshowId,
    caption = "",
    privacyLevel = "SELF_ONLY",
    coverIndex = 0,
    postMode = "DIRECT_POST",
    autoAddMusic = true,
    disableComment = false,
    brandOrganic = false,
    brandContent = false,
  } = opts;
  const isDraft = postMode === "MEDIA_UPLOAD";

  // Privacy only applies to DIRECT_POST — drafts are finished inside the TikTok
  // app, so no privacy_level is ever sent for them (see post_info below). The
  // post modal deliberately has no default privacy now, so the drafts path
  // arrives here with an unset privacy; validating it would wrongly 400.
  if (!isDraft && !PRIVACY_LEVELS.includes(privacyLevel)) {
    return { ok: false, error: "Invalid privacy level.", status: 400 };
  }
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (!appUrl) {
    return { ok: false, error: "NEXT_PUBLIC_APP_URL is not configured.", status: 500 };
  }

  // Explicit ownership check (service-role safe).
  const { data: show } = await supabase
    .from("slideshows")
    .select("id")
    .eq("id", slideshowId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!show) {
    return { ok: false, error: "Slideshow not found.", status: 404 };
  }

  const { data: slides, error: slidesErr } = await supabase
    .from("slides")
    .select("position")
    .eq("slideshow_id", slideshowId)
    .order("position", { ascending: true });
  if (slidesErr || !slides?.length) {
    return { ok: false, error: "Slideshow has no slides.", status: 404 };
  }

  let accessToken: string;
  try {
    accessToken = await getValidToken(supabase, userId);
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "TikTok auth error.",
      status: 401,
    };
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
        post_mode: isDraft ? "MEDIA_UPLOAD" : "DIRECT_POST",
        // Drafts are finished in the TikTok app, so only prefill the caption —
        // privacy, cover, and sound are chosen there.
        post_info: isDraft
          ? { description: caption }
          : {
              description: caption,
              privacy_level: privacyLevel,
              photo_cover_index: safeCover,
              auto_add_music: autoAddMusic,
              // From the compliant post modal (Allow-comments toggle + the
              // commercial-content disclosure). TikTok requires these to be set
              // by explicit user choice, not hardcoded.
              disable_comment: disableComment,
              brand_organic_toggle: brandOrganic,
              brand_content_toggle: brandContent,
            },
        source_info: {
          source: "PULL_FROM_URL",
          photo_images: photoImages,
        },
      }),
    },
  );

  const tiktokData = (await tiktokRes.json()) as {
    data?: { publish_id?: string };
    error?: { code?: string; message?: string };
  };

  if (!tiktokRes.ok || (tiktokData.error?.code && tiktokData.error.code !== "ok")) {
    const code = tiktokData.error?.code ?? "";
    console.error("[tiktok/publish] init failed", {
      httpStatus: tiktokRes.status,
      error: tiktokData.error,
    });
    let message = tiktokData.error?.message ?? "TikTok post failed.";
    if (code.includes("rate_limit") || code.includes("spam_risk")) {
      message = "Rate limit reached — wait a minute and try again.";
    } else if (code.includes("unaudited")) {
      message =
        "TikTok rejected this: an unaudited app can only post to a TikTok account that's set to Private. In the TikTok app, go to Settings and privacy → Privacy → Private account and turn it on, then try again.";
    } else if (code.includes("url_ownership")) {
      message = "Domain not verified with TikTok. Verify your domain in the TikTok developer portal.";
    }
    const status = tiktokRes.status === 429 ? 429 : tiktokRes.status >= 500 ? 502 : 400;
    return { ok: false, error: message, status };
  }

  const publishId = tiktokData.data?.publish_id;
  if (!publishId) {
    return { ok: false, error: "No publish_id in TikTok response.", status: 502 };
  }
  return { ok: true, publishId, coverIndex: safeCover, draft: isDraft };
}
