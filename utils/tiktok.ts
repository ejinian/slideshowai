import { createHmac, timingSafeEqual } from "node:crypto";
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
