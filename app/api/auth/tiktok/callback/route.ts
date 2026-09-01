import { type NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { requestOrigin, tiktokClientKey, tiktokClientSecret, tiktokRedirectUri } from "@/utils/tiktok";
import { isAdminEmail } from "@/lib/admins";
import { PLANS, isPlanId, tiktokAccountLimit, type PlanId } from "@/lib/billing/plans";

// Handles the TikTok OAuth redirect, exchanges code for tokens, persists to
// tiktok_connections, then either (popup mode) closes itself and messages the
// opener, or (full-page mode) redirects back to return_to.
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // The origin the user is actually on. Behind a proxy request.url is the
  // internal origin, so requestOrigin() prefers x-forwarded-*. This used to read
  // NEXT_PUBLIC_APP_URL, which bounced the user to a different domain than the
  // one they started on.
  const origin = requestOrigin(request);

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
      const dest = new URL(returnTo, origin);
      if (ok) dest.searchParams.set("tiktok_connected", "1");
      else dest.searchParams.set("tiktok_error", msg ?? "TikTok connection failed.");
      res = NextResponse.redirect(dest);
    }
    res.cookies.delete("tiktok_oauth_state");
    res.cookies.delete("tiktok_code_verifier");
    res.cookies.delete("tiktok_return_to");
    res.cookies.delete("tiktok_popup");
    res.cookies.delete("tiktok_add");
    return res;
  }

  if (!user) return finish(false, "You must be signed in to connect TikTok.");

  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const errorParam = searchParams.get("error");

  const storedState = request.cookies.get("tiktok_oauth_state")?.value;
  const codeVerifier = request.cookies.get("tiktok_code_verifier")?.value ?? "";

  if (errorParam) return finish(false, errorParam);
  if (!code || !state || state !== storedState) return finish(false, "OAuth state mismatch.");

  // "Server misconfiguration." was true and useless — it named neither which
  // credential nor what was wrong with it, and this is the screen a user sees.
  let clientKey: string;
  let clientSecret: string;
  try {
    clientKey = tiktokClientKey();
    clientSecret = tiktokClientSecret();
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[tiktok/callback] CONFIG ERROR:", message);
    return finish(false, message);
  }

  const tokenRes = await fetch("https://open.tiktokapis.com/v2/oauth/token/", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_key: clientKey,
      client_secret: clientSecret,
      code,
      grant_type: "authorization_code",
      // TikTok compares this against the one sent to /authorize, so both come
      // from the same helper. TikTok redirected the browser HERE, so this
      // request's own origin is by definition the registered URI.
      redirect_uri: tiktokRedirectUri(request),
      // PKCE: proves this exchange belongs to the authorize call that started
      // it. Omitting it when a challenge was sent fails the exchange.
      code_verifier: codeVerifier,
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

  // Display identity for the account picker — best-effort, never blocks the
  // connect (nulls just render as a generic account row).
  let displayName: string | null = null;
  let avatarUrl: string | null = null;
  try {
    const infoRes = await fetch(
      "https://open.tiktokapis.com/v2/user/info/?fields=display_name,avatar_url",
      {
        headers: { Authorization: `Bearer ${access_token}` },
        signal: AbortSignal.timeout(4000),
      },
    );
    const info = (await infoRes.json()) as {
      data?: { user?: { display_name?: string; avatar_url?: string } };
    };
    displayName = info.data?.user?.display_name ?? null;
    avatarUrl = info.data?.user?.avatar_url ?? null;
  } catch {
    // fine — identity is cosmetic
  }

  // Multi-account: one row per (user, open_id). Reconnecting an account the
  // user already linked updates that row and is allowed on every plan — a free
  // user must always be able to fix an expired token. Only a genuinely NEW
  // second account is the Scale feature.
  const { data: existingRows } = await supabase
    .from("tiktok_connections")
    .select("id, open_id")
    .eq("user_id", user.id);
  const existing = (existingRows ?? []) as { id: string; open_id: string }[];
  const sameAccount = existing.find((r) => r.open_id === open_id);

  const tokens = {
    access_token,
    refresh_token,
    expires_at: new Date(Date.now() + expires_in * 1000).toISOString(),
    updated_at: new Date().toISOString(),
  };
  const identity = { display_name: displayName, avatar_url: avatarUrl };

  if (sameAccount) {
    const { error } = await supabase
      .from("tiktok_connections")
      .update({ ...tokens, ...identity })
      .eq("id", sameAccount.id);
    // Identity columns may predate migration 20260831140000 — retry bare.
    if (error) {
      const { error: retryErr } = await supabase
        .from("tiktok_connections")
        .update(tokens)
        .eq("id", sameAccount.id);
      if (retryErr) return finish(false, "Failed to save TikTok connection.");
    }
    // "Connect ANOTHER account" that came back as the account already linked:
    // TikTok auto-approved the browser's logged-in session, usually without
    // showing any screen. Silently reporting success here is exactly what made
    // the button feel like it "does nothing" — say what actually happened.
    // (The tokens above are refreshed either way; that part is a fine outcome.)
    if (request.cookies.get("tiktok_add")?.value === "1") {
      const who = displayName ? `@${displayName}` : "the same TikTok account";
      return finish(
        false,
        `TikTok reconnected ${who} — the account already linked — because that's who's signed in at tiktok.com. To add a different account, switch accounts on tiktok.com (or open a private window), then try again.`,
      );
    }
    return finish(true);
  }

  if (existing.length > 0) {
    // Per-plan account limits (free/growth 1, scale 3, unlimited 10, admin
    // 100). Gated server-side, HERE, because only the callback knows the
    // open_id — gating the authorize redirect would also block plain
    // reconnects, which every plan is allowed to do.
    const { data: profile } = await supabase
      .from("profiles")
      .select("plan")
      .eq("id", user.id)
      .maybeSingle();
    const planRaw = (profile?.plan as string | undefined) ?? "free";
    const plan: PlanId = isPlanId(planRaw) ? planRaw : "free";
    const limit = tiktokAccountLimit(plan, isAdminEmail(user.email));
    if (existing.length >= limit) {
      return finish(
        false,
        limit === 1
          ? "Your plan includes one TikTok account. Upgrade to Scale to connect up to 3, or Unlimited for up to 10."
          : `Your ${PLANS[plan].name} plan includes up to ${limit} TikTok accounts — disconnect one, or upgrade to add more.`,
      );
    }
  }

  const row = {
    user_id: user.id,
    open_id,
    ...tokens,
    ...identity,
    // First account becomes the default; later ones are picked per post.
    is_default: existing.length === 0,
  };
  const { error: insertErr } = await supabase.from("tiktok_connections").insert(row);
  if (insertErr) {
    // Pre-migration fallback: the new columns (and the second-row capacity)
    // don't exist yet. A FIRST connection must still work with the legacy shape.
    if (existing.length === 0) {
      const { error: retryErr } = await supabase.from("tiktok_connections").insert({
        user_id: user.id,
        open_id,
        ...tokens,
      });
      if (retryErr) return finish(false, "Failed to save TikTok connection.");
      return finish(true);
    }
    return finish(false, "Failed to save TikTok connection.");
  }

  return finish(true);
}
