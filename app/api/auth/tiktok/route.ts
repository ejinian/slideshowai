import { type NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

// Initiates TikTok OAuth. Requires the user to be signed in.
// Optional ?return_to= query param to redirect back after connect.
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(new URL("/?auth=login", request.url));

  const clientKey = process.env.TIKTOK_CLIENT_KEY;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (!clientKey || !appUrl) {
    return NextResponse.json(
      { error: "TikTok credentials not configured (TIKTOK_CLIENT_KEY / NEXT_PUBLIC_APP_URL)." },
      { status: 500 },
    );
  }

  const state = crypto.randomUUID();
  const reqUrl = new URL(request.url);
  const returnTo = reqUrl.searchParams.get("return_to") ?? "/dashboard/slideshows";
  const isPopup = reqUrl.searchParams.get("popup") === "1";
  const redirectUri = `${appUrl}/api/auth/tiktok/callback`;

  const params = new URLSearchParams({
    client_key: clientKey,
    response_type: "code",
    // video.publish → DIRECT_POST; video.upload → MEDIA_UPLOAD (send to drafts).
    scope: "video.publish,video.upload",
    redirect_uri: redirectUri,
    state,
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
  response.cookies.set("tiktok_return_to", returnTo, cookieOpts);
  // Popup mode: the callback returns a self-closing page that messages the
  // opener, so the main page (and any in-progress slideshow) never unmounts.
  if (isPopup) response.cookies.set("tiktok_popup", "1", cookieOpts);
  return response;
}
