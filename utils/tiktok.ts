import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

// Server-only TikTok utilities. Never import from client components.

function secret(): string {
  const s = process.env.TIKTOK_CLIENT_SECRET;
  if (!s || s.includes("your_")) throw new Error("TIKTOK_CLIENT_SECRET is not configured.");
  return s;
}

// ---------------------------------------------------------------------------
// Proxy URL signing — HMAC-SHA256(${slideshowId}:${pos}:${expiry}, secret)
// Tokens expire in 2 hours (TikTok pulls within 1 hour of the init call).
// ---------------------------------------------------------------------------

export function signedProxyToken(slideshowId: string, pos: number): { token: string; expiry: number } {
  const expiry = Math.floor(Date.now() / 1000) + 2 * 60 * 60;
  const token = createHmac("sha256", secret())
    .update(`${slideshowId}:${pos}:${expiry}`)
    .digest("hex");
  return { token, expiry };
}

export function verifyProxyToken(
  slideshowId: string,
  pos: string,
  token: string,
  expiry: string,
): boolean {
  const expiryNum = Number(expiry);
  if (!Number.isInteger(expiryNum) || expiryNum < Math.floor(Date.now() / 1000)) return false;
  const expected = createHmac("sha256", secret())
    .update(`${slideshowId}:${pos}:${expiryNum}`)
    .digest("hex");
  try {
    return timingSafeEqual(Buffer.from(token, "hex"), Buffer.from(expected, "hex"));
  } catch {
    return false;
  }
}

export function slideProxyUrl(appUrl: string, slideshowId: string, pos: number): string {
  const { token, expiry } = signedProxyToken(slideshowId, pos);
  return `${appUrl}/api/tiktok/img/${slideshowId}/${pos}?token=${token}&exp=${expiry}`;
}

// ---------------------------------------------------------------------------
// Token management — refresh if within 5 minutes of expiry.
// ---------------------------------------------------------------------------

export async function getValidToken(
  supabase: SupabaseClient,
  userId: string,
): Promise<string> {
  const { data: conn, error } = await supabase
    .from("tiktok_connections")
    .select("access_token, refresh_token, expires_at")
    .eq("user_id", userId)
    .single();

  if (error || !conn) throw new Error("TikTok account not connected. Please connect via the Post to TikTok button.");

  const expiresAt = new Date((conn as { expires_at: string }).expires_at).getTime();
  if (expiresAt > Date.now() + 5 * 60 * 1000) {
    return (conn as { access_token: string }).access_token;
  }

  const clientKey = process.env.TIKTOK_CLIENT_KEY;
  const clientSecret = process.env.TIKTOK_CLIENT_SECRET;
  if (!clientKey || !clientSecret) throw new Error("TikTok credentials not configured.");

  const res = await fetch("https://open.tiktokapis.com/v2/oauth/token/", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_key: clientKey,
      client_secret: clientSecret,
      grant_type: "refresh_token",
      refresh_token: (conn as { refresh_token: string }).refresh_token,
    }),
  });

  // TikTok's /v2/oauth/token/ returns fields FLAT (top-level), not nested under
  // `data` — same shape as the initial code exchange. Errors are OAuth-style
  // { error, error_description } strings.
  const data = await res.json() as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    error?: string;
    error_description?: string;
  };

  if (!res.ok || data.error) {
    console.error("[tiktok/refresh] failed", { httpStatus: res.status, error: data.error, error_description: data.error_description });
    throw new Error(`TikTok token refresh failed: ${data.error_description || data.error || res.status}`);
  }

  const newAccess = data.access_token;
  const newRefresh = data.refresh_token;
  const expiresIn = data.expires_in ?? 86400;

  if (!newAccess || !newRefresh) throw new Error("TikTok refresh returned incomplete tokens.");

  await supabase
    .from("tiktok_connections")
    .update({
      access_token: newAccess,
      refresh_token: newRefresh,
      expires_at: new Date(Date.now() + expiresIn * 1000).toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", userId);

  return newAccess;
}

/**
 * The origin the user is actually browsing, for OAuth redirects.
 *
 * WHY NOT `NEXT_PUBLIC_APP_URL`: it is a single hardcoded value, so the
 * `redirect_uri` sent to TikTok was the same regardless of where the app was
 * being used. Connecting from localhost still sent the Vercel callback URL, and
 * TikTok rejected the whole authorization with "correct the following:
 * redirect_uri" — the env var and the browsing origin had silently diverged.
 * Deriving it from the request means the URI always matches where the user is.
 *
 * `x-forwarded-*` is honoured because behind Vercel's proxy `request.url`
 * resolves to the internal origin, not the public domain. Those headers are
 * client-settable in principle, but a forged origin cannot leak an auth code:
 * TikTok only redirects to URIs registered in the app's allow-list, so an
 * unregistered host fails the authorize call outright.
 *
 * NOTE: this is for the browser-facing OAuth hop only. The image-proxy URLs in
 * lib/tiktok/publish.ts must stay on an explicit public origin — TikTok's own
 * servers fetch those, and they can never resolve a localhost address.
 */
export function requestOrigin(request: Request): string {
  const host = request.headers.get("x-forwarded-host");
  if (host) {
    const proto = request.headers.get("x-forwarded-proto") ?? "https";
    return `${proto}://${host}`;
  }
  return new URL(request.url).origin;
}

/**
 * The TikTok OAuth callback URL. Must be byte-identical in the authorize call
 * and the token exchange — TikTok compares them — which is why both routes call
 * this rather than each formatting their own.
 */
export function tiktokRedirectUri(request: Request): string {
  return `${requestOrigin(request)}/api/auth/tiktok/callback`;
}

/* ── PKCE ────────────────────────────────────────────────────────────────────
   TikTok's own docs say PKCE applies to desktop/iOS/Android and NOT to web, but
   the authorize call fails with "correct the following: code_challenge" — which
   means the app is registered in the portal as a Desktop app rather than Web.
   Sending the challenge satisfies it either way and costs nothing, so we always
   send it rather than depending on a portal setting we can't see from here.

   ⚠️ The challenge is HEX-encoded SHA256, NOT the base64url that RFC 7636
   specifies. TikTok deviates here, and base64url fails with the same unhelpful
   "code_challenge" error, so this is not a detail to swap for the standard one:
     "Create the code challenge by hashing the code verifier using hex encoding
      of SHA256" — https://developers.tiktok.com/doc/login-kit-desktop/          */

/** A fresh high-entropy verifier: unreserved characters, 43-128 chars. */
export function createCodeVerifier(): string {
  // 64 hex chars — inside the length bounds and entirely unreserved characters.
  return randomBytes(32).toString("hex");
}

/** code_challenge = hex(SHA256(verifier)). Hex is deliberate; see above. */
export function codeChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("hex");
}
