import { type NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

// Handles the TikTok OAuth redirect, exchanges code for tokens, persists to
// tiktok_connections, then either (popup mode) closes itself and messages the
// opener, or (full-page mode) redirects back to return_to.
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Build redirects from NEXT_PUBLIC_APP_URL (the ngrok/prod origin), not
  // request.url — behind a tunnel request.url resolves to https://localhost:3000,
  // which has no TLS and dies with ERR_SSL_PROTOCOL_ERROR.
  const redirectBase = process.env.NEXT_PUBLIC_APP_URL ?? request.url;
  const origin = new URL(redirectBase).origin;

  const returnTo = request.cookies.get("tiktok_return_to")?.value ?? "/dashboard/slideshows";
  const isPopup = request.cookies.get("tiktok_popup")?.value === "1";

  // Unified terminator: in popup mode return a tiny HTML page that postMessages
  // the result to window.opener and closes itself (main page never navigates);
  // otherwise fall back to a normal redirect with a query flag.
  function finish(ok: boolean, msg?: string): NextResponse {
    let res: NextResponse;
    if (isPopup) {
      const payload = JSON.stringify({
        source: "tiktok-oauth",
        status: ok ? "connected" : "error",
        message: msg ?? "",
      });
      const html = `<!doctype html><meta charset="utf-8"><title>TikTok</title>
<body style="background:#000;color:#fff;font-family:system-ui,sans-serif;display:grid;place-items:center;height:100vh;margin:0">
<p style="opacity:.6;font-size:14px">You can close this window.</p>
<script>
(function(){
  try { if (window.opener) window.opener.postMessage(${payload}, ${JSON.stringify(origin)}); } catch (e) {}
  window.close();
})();
</script></body>`;
      res = new NextResponse(html, {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    } else {
      const dest = new URL(returnTo, redirectBase);
      if (ok) dest.searchParams.set("tiktok_connected", "1");
      else dest.searchParams.set("tiktok_error", msg ?? "TikTok connection failed.");
      res = NextResponse.redirect(dest);
    }
    res.cookies.delete("tiktok_oauth_state");
    res.cookies.delete("tiktok_return_to");
    res.cookies.delete("tiktok_popup");
    return res;
  }

  if (!user) return finish(false, "You must be signed in to connect TikTok.");

  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const errorParam = searchParams.get("error");

  const storedState = request.cookies.get("tiktok_oauth_state")?.value;

  if (errorParam) return finish(false, errorParam);
  if (!code || !state || state !== storedState) return finish(false, "OAuth state mismatch.");

  const clientKey = process.env.TIKTOK_CLIENT_KEY;
  const clientSecret = process.env.TIKTOK_CLIENT_SECRET;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (!clientKey || !clientSecret || !appUrl) return finish(false, "Server misconfiguration.");

  const tokenRes = await fetch("https://open.tiktokapis.com/v2/oauth/token/", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_key: clientKey,
      client_secret: clientSecret,
      code,
      grant_type: "authorization_code",
      redirect_uri: `${appUrl}/api/auth/tiktok/callback`,
    }),
  });

  // TikTok's v2 OAuth token endpoint returns fields at the TOP LEVEL (flat),
  // unlike the content-posting endpoints which nest under `data`. Errors come
  // back as OAuth-style { error, error_description } strings.
  const tokenData = await tokenRes.json() as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    open_id?: string;
    error?: string;
    error_description?: string;
  };

  if (!tokenRes.ok || tokenData.error) {
    // Log the raw failure (error responses carry no tokens) so we can see
    // TikTok's exact reason in the server terminal while debugging the sandbox.
    console.error("[tiktok/callback] token exchange failed", {
      httpStatus: tokenRes.status,
      error: tokenData.error,
      error_description: tokenData.error_description,
    });
    return finish(false, tokenData.error_description || tokenData.error || "Token exchange failed.");
  }

  const { access_token, refresh_token, expires_in = 86400, open_id } = tokenData;
  if (!access_token || !refresh_token || !open_id) {
    return finish(false, "Incomplete token response from TikTok.");
  }

  const { error: upsertErr } = await supabase.from("tiktok_connections").upsert(
    {
      user_id: user.id,
      open_id,
      access_token,
      refresh_token,
      expires_at: new Date(Date.now() + expires_in * 1000).toISOString(),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );

  if (upsertErr) return finish(false, "Failed to save TikTok connection.");

  return finish(true);
}
