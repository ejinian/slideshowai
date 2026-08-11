import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import {
  publishSlideshowToTikTok,
  type PrivacyLevel,
} from "@/lib/tiktok/publish";

export const runtime = "nodejs";

interface PostBody {
  slideshowId?: string;
  caption?: string;
  privacyLevel?: PrivacyLevel;
  coverIndex?: number;
  postMode?: "DIRECT_POST" | "MEDIA_UPLOAD";
  autoAddMusic?: boolean;
  disableComment?: boolean;
  brandOrganic?: boolean;
  brandContent?: boolean;
}

// Immediate posting from the UI. The publish core lives in lib/tiktok/publish
// (shared with the scheduled-post publisher cron).
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
  if (!body.slideshowId) {
    return NextResponse.json({ error: "slideshowId is required." }, { status: 400 });
  }

  // publishSlideshowToTikTok signs the image URLs, which reads
  // TIKTOK_CLIENT_SECRET and throws when it is unset. Uncaught, that is an
  // empty-bodied platform 500, and the modal renders it as the useless
  // "Network error. Please try again." Return the real reason.
  let outcome: Awaited<ReturnType<typeof publishSlideshowToTikTok>>;
  try {
    outcome = await publishSlideshowToTikTok(supabase, user.id, {
      slideshowId: body.slideshowId,
      caption: body.caption ?? "",
      privacyLevel: body.privacyLevel ?? "SELF_ONLY",
      coverIndex: body.coverIndex ?? 0,
      postMode: body.postMode ?? "DIRECT_POST",
      autoAddMusic: body.autoAddMusic ?? true,
      disableComment: body.disableComment ?? false,
      brandOrganic: body.brandOrganic ?? false,
      brandContent: body.brandContent ?? false,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[tiktok/post] publish threw:", message);
    return NextResponse.json(
      { error: `Posting failed on the server: ${message}` },
      { status: 500 },
    );
  }

  if (!outcome.ok) {
    return NextResponse.json({ error: outcome.error }, { status: outcome.status });
  }

  // Drafts aren't "posts" yet (finished in the TikTok app), so only record
  // direct posts in "My Posts". Status refined later by /api/tiktok/status.
  if (outcome.draft) {
    return NextResponse.json({ publish_id: outcome.publishId, postId: null, draft: true });
  }
  const { data: postRow } = await supabase
    .from("tiktok_posts")
    .insert({
      user_id: user.id,
      slideshow_id: body.slideshowId,
      publish_id: outcome.publishId,
      caption: body.caption ?? "",
      privacy_level: body.privacyLevel ?? "SELF_ONLY",
      cover_index: outcome.coverIndex,
      status: "PROCESSING_DOWNLOAD",
    })
    .select("id")
    .single();

  return NextResponse.json({ publish_id: outcome.publishId, postId: postRow?.id ?? null });
}
