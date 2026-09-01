import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

// Server-only TikTok utilities. Never import from client components.

// The ONE place the TikTok credentials are read. Trimming is not defensive
// tidying — Vercel's env editor stores a trailing newline if you paste one, and
// it is invisible in the UI. That newline URL-encodes into the authorize call as
// %0A, TikTok rejects the key, and its error page says only "client_key", which
// is indistinguishable from a wrong key, an unregistered redirect URI or an
// unheld scope. It cost a day on 2026-08-08 and came back on 2026-08-11. Strip
// it at the boundary instead of trusting whoever pasted the value.
function credential(name: "TIKTOK_CLIENT_KEY" | "TIKTOK_CLIENT_SECRET"): string {
  const value = process.env[name]?.trim() ?? "";
  if (!value || value.includes("your_")) throw new Error(`${name} is not configured.`);
  // Interior whitespace can't be trimmed off, and means the paste was mangled
  // (a wrapped line, a copied space). Say so here rather than at TikTok, which
  // reports it as the same opaque "client_key".
  if (/\s/.test(value)) {
    throw new Error(`${name} contains whitespace — the value was pasted mangled. Re-copy it.`);
  }
  return value;
}

export function tiktokClientKey(): string {
  return credential("TIKTOK_CLIENT_KEY");
}

export function tiktokClientSecret(): string {
  return credential("TIKTOK_CLIENT_SECRET");
}

// ---------------------------------------------------------------------------
// Proxy URL signing — HMAC-SHA256(${slideshowId}:${pos}:${expiry}, secret)
// Tokens expire in 2 hours (TikTok pulls within 1 hour of the init call).
// ---------------------------------------------------------------------------

export function signedProxyToken(slideshowId: string, pos: number): { token: string; expiry: number } {
  // 24h, raised from 2h (2026-08-11). TikTok normally pulls within an hour, but
  // its fetcher applies per-domain backoff after sustained failures — after a
  // day of misconfigured-secret 500s it was observed retrying pulls ~22h late.
  // A 2h token turns every delayed pull into a 401, which feeds the backoff:
  // posts zombie in PROCESSING_DOWNLOAD forever. 24h covers the whole window in
  // which TikTok will still attempt a pull (posts hard-fail at 24h).
  const expiry = Math.floor(Date.now() / 1000) + 24 * 60 * 60;
  const token = createHmac("sha256", tiktokClientSecret())
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
  const expected = createHmac("sha256", tiktokClientSecret())
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

export interface TikTokConnection {
  id: string;
  open_id: string;
  access_token: string;
  refresh_token: string;
  expires_at: string;
  /** Multi-account columns (migration 20260831140000) — undefined before it runs. */
  is_default?: boolean | null;
  display_name?: string | null;
  avatar_url?: string | null;
  username?: string | null;
}

/**
 * The user's connections, default first. `select("*")` on purpose: the row
 * shape must survive the multi-account migration not having run yet — naming
 * is_default in a select would 500 every TikTok feature on a schema race.
 */
export async function listConnections(
  supabase: SupabaseClient,
  userId: string,
): Promise<TikTokConnection[]> {
  const { data } = await supabase
    .from("tiktok_connections")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: true });
  const rows = (data ?? []) as TikTokConnection[];
  return rows.sort((a, b) => Number(!!b.is_default) - Number(!!a.is_default));
}

/**
 * Resolve which connection to act on. With an explicit id, anything but that
 * exact row is an error — posting to the WRONG account is strictly worse than
 * failing. Without one: the default connection (single-account callers).
 */
export async function resolveConnection(
  supabase: SupabaseClient,
  userId: string,
  connectionId?: string,
): Promise<TikTokConnection> {
  const rows = await listConnections(supabase, userId);
  if (connectionId) {
    const hit = rows.find((r) => r.id === connectionId);
    if (!hit) throw new Error("That TikTok account is no longer connected.");
    return hit;
  }
  if (!rows.length) {
    throw new Error("TikTok account not connected. Please connect via the Post to TikTok button.");
  }
  return rows[0];
}

export async function getValidToken(
  supabase: SupabaseClient,
  userId: string,
  connectionId?: string,
): Promise<string> {
  const conn = await resolveConnection(supabase, userId, connectionId);

  const expiresAt = new Date(conn.expires_at).getTime();
  if (expiresAt > Date.now() + 5 * 60 * 1000) {
    return conn.access_token;
  }

  const clientKey = tiktokClientKey();
  const clientSecret = tiktokClientSecret();

  const res = await fetch("https://open.tiktokapis.com/v2/oauth/token/", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_key: clientKey,
      client_secret: clientSecret,
      grant_type: "refresh_token",
      refresh_token: conn.refresh_token,
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
    // By row id, not user_id — with several connections a user-wide update
    // would overwrite every account's tokens with this one's.
    .eq("id", conn.id);

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
