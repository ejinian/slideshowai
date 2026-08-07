import { type NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { codeChallenge, createCodeVerifier, tiktokRedirectUri } from "@/utils/tiktok";

// Initiates TikTok OAuth. Requires the user to be signed in.
// Optional ?return_to= query param to redirect back after connect.
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(new URL("/?auth=login", request.url));

  const clientKey = process.env.TIKTOK_CLIENT_KEY;
  if (!clientKey) {
    return NextResponse.json(
      { error: "TikTok credentials not configured (TIKTOK_CLIENT_KEY)." },
      { status: 500 },
    );
  }

  const state = crypto.randomUUID();
  // A NEW verifier per authorization attempt, per TikTok's guidance. It is kept
  // in an httpOnly cookie and replayed at token exchange; the challenge is what
  // goes over the wire.
  const verifier = createCodeVerifier();
  const reqUrl = new URL(request.url);
  const returnTo = reqUrl.searchParams.get("return_to") ?? "/dashboard/slideshows";
  const isPopup = reqUrl.searchParams.get("popup") === "1";
  // Derived from THIS request, not a hardcoded env var — see tiktokRedirectUri.
  // Whichever origin the user is on must also be registered in the TikTok
  // portal's Redirect URI list, or TikTok rejects the authorize call.
  const redirectUri = tiktokRedirectUri(request);

  const params = new URLSearchParams({
    client_key: clientKey,
    response_type: "code",
    // video.publish → DIRECT_POST; video.upload → MEDIA_UPLOAD (send to drafts).
    //
    // user.info.basic + user.info.stats are for Analytics: `stats` is the ONLY
    // scope that returns engagement data (follower_count, likes_count,
    // following_count, video_count), and `basic` is its prerequisite. Note this
    // is ACCOUNT-level only — per-post views/likes are not in the Display API at
    // all (`/v2/video/list/` returns metadata: id, title, cover_image_url,
    // share_url…). Those live in the Research API, which is restricted to vetted
    // researchers, so we cannot offer per-post metrics.
    //
    // Added now on purpose: changing scopes forces every user to re-authorize,
    // and they already have to reconnect when the production client key goes
    // into Vercel. One reconnect, not two.
    scope: "video.publish,video.upload,user.info.basic,user.info.stats",
    redirect_uri: redirectUri,
    state,
    code_challenge: codeChallenge(verifier),
    code_challenge_method: "S256",
  });

  const response = NextResponse.redirect(
    `https://www.tiktok.com/v2/auth/authorize/?${params.toString()}`,
  );
  const cookieOpts = {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    maxAge: 600,
    path: "/",
  };
  response.cookies.set("tiktok_oauth_state", state, cookieOpts);
  response.cookies.set("tiktok_code_verifier", verifier, cookieOpts);
  response.cookies.set("tiktok_return_to", returnTo, cookieOpts);
  // Popup mode: the callback returns a self-closing page that messages the
  // opener, so the main page (and any in-progress slideshow) never unmounts.
  if (isPopup) response.cookies.set("tiktok_popup", "1", cookieOpts);
  return response;
}
