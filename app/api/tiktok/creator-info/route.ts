import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { getValidToken } from "@/utils/tiktok";

export const runtime = "nodejs";

// TikTok's Content Posting API UX guidelines REQUIRE the post screen to render
// from the creator's live settings: which account, the privacy options THIS
// account allows (no hardcoded list, no default), and whether comments are
// disabled. This proxies TikTok's creator_info/query using the user's token.
// https://developers.tiktok.com/doc/content-sharing-guidelines
export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Multi-account: ?connection=<id> loads THAT account's settings (the post
  // modal re-fetches on every picker change); absent = the default account.
  const connectionId =
    new URL(request.url).searchParams.get("connection") ?? undefined;

  let token: string;
  try {
    token = await getValidToken(supabase, user.id, connectionId);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "TikTok auth error." },
      { status: 401 },
    );
  }

  let json: {
    data?: {
      creator_nickname?: string;
      creator_username?: string;
      creator_avatar_url?: string;
      privacy_level_options?: string[];
      comment_disabled?: boolean;
      max_video_post_duration_sec?: number;
    };
    error?: { code?: string; message?: string };
  };
  try {
    const res = await fetch(
      "https://open.tiktokapis.com/v2/post/publish/creator_info/query/",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json; charset=UTF-8",
          Authorization: `Bearer ${token}`,
        },
      },
    );
    json = await res.json();
    if (!res.ok || (json.error?.code && json.error.code !== "ok")) {
      return NextResponse.json(
        { error: json.error?.message ?? "Could not load your TikTok account info." },
        { status: 400 },
      );
    }
  } catch {
    return NextResponse.json(
      { error: "Network error contacting TikTok." },
      { status: 502 },
    );
  }

  const d = json.data ?? {};
  return NextResponse.json({
    nickname: d.creator_nickname ?? null,
    username: d.creator_username ?? null,
    avatarUrl: d.creator_avatar_url ?? null,
    privacyOptions: Array.isArray(d.privacy_level_options)
      ? d.privacy_level_options
      : [],
    commentDisabled: !!d.comment_disabled,
  });
}
