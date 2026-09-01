import type { SupabaseClient } from "@supabase/supabase-js";
import { getValidToken } from "@/utils/tiktok";

// Official-API analytics refresh — followers via /v2/user/info/
// (user.info.stats) and per-post counts via /v2/video/list/ (video.list).
//
// NO SCRAPING, NO THIRD PARTIES — Christian's call (2026-08-31) after the
// first cut of this file used Apify/ScrapTik. Everything here is TikTok's own
// Display API against the user's own account, read-only.
//
// GATED on TIKTOK_STATS_SCOPES: the production app doesn't hold these scopes
// until the revision in docs/tiktok-scope-revision.md is approved. While the
// flag is off this module reports "not_enabled" and the page stays on its
// internal numbers. When it flips on, tokens issued before the flip lack the
// new grants — that surfaces as "needs_reconnect" and the page shows a
// Reconnect button.

const USER_INFO_URL = "https://open.tiktokapis.com/v2/user/info/";
const USER_INFO_FIELDS = "follower_count,following_count,likes_count,video_count";
const VIDEO_LIST_URL = "https://open.tiktokapis.com/v2/video/list/";
const VIDEO_LIST_FIELDS =
  "id,title,video_description,create_time,view_count,like_count,comment_count,share_count";
// One page is plenty: we only ever match against our own recent posts.
const VIDEO_LIST_MAX = 20;
const FETCH_TIMEOUT_MS = 8000;
// A listed post must sit within this window of our publish record to count as
// a caption match — captions repeat across a user's decks; timing doesn't.
const MATCH_WINDOW_MS = 7 * 86_400_000;

export function statsEnabled(): boolean {
  return process.env.TIKTOK_STATS_SCOPES === "on";
}

export type RefreshResult =
  | { ok: true; matched: number }
  | { ok: false; reason: "disconnected" | "not_enabled" | "needs_reconnect" | "unavailable" };

interface ListedVideo {
  id?: string;
  title?: string;
  video_description?: string;
  create_time?: number; // unix seconds
  view_count?: number;
  like_count?: number;
  comment_count?: number;
  share_count?: number;
}

const num = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const normCaption = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

/**
 * Missing scope is the EXPECTED failure right after the flag flips on: every
 * token issued before it lacks the new grants, and TikTok can't add them
 * retroactively. That's a "reconnect" prompt, not an error.
 */
function isScopeError(code: string | undefined, message: string | undefined): boolean {
  const hay = `${code ?? ""} ${message ?? ""}`.toLowerCase();
  return (
    hay.includes("scope") ||
    hay.includes("permission") ||
    hay.includes("unauthorized") ||
    hay.includes("access_token_invalid")
  );
}

async function tiktokGet<T>(
  url: string,
  token: string,
  init?: RequestInit,
): Promise<{ data?: T; error?: { code?: string; message?: string } } | null> {
  try {
    const res = await fetch(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json; charset=UTF-8",
        ...init?.headers,
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    return (await res.json()) as { data?: T; error?: { code?: string; message?: string } };
  } catch {
    return null; // timeout / transport
  }
}

/**
 * Snapshot the account stats and copy per-post counts onto matching
 * tiktok_posts rows — both from TikTok's own API.
 */
export async function refreshOfficialStats(
  supabase: SupabaseClient,
  userId: string,
): Promise<RefreshResult> {
  if (!statsEnabled()) return { ok: false, reason: "not_enabled" };

  // limit(1): a maybeSingle over multiple connections (multi-account) errors.
  // Stats read the DEFAULT account (getValidToken with no connection id below).
  const { data: conn } = await supabase
    .from("tiktok_connections")
    .select("id")
    .eq("user_id", userId)
    .limit(1)
    .maybeSingle();
  if (!conn) return { ok: false, reason: "disconnected" };

  let token: string;
  try {
    token = await getValidToken(supabase, userId);
  } catch {
    // No row is handled above, so this is a dead refresh token — relink.
    return { ok: false, reason: "needs_reconnect" };
  }

  // ── account stats → snapshot ───────────────────────────────────────────────
  const info = await tiktokGet<{
    user?: {
      follower_count?: number;
      following_count?: number;
      likes_count?: number;
      video_count?: number;
    };
  }>(`${USER_INFO_URL}?fields=${encodeURIComponent(USER_INFO_FIELDS)}`, token);
  if (!info) return { ok: false, reason: "unavailable" };
  if (info.error?.code && info.error.code !== "ok") {
    return {
      ok: false,
      reason: isScopeError(info.error.code, info.error.message)
        ? "needs_reconnect"
        : "unavailable",
    };
  }
  const u = info.data?.user;
  if (!u) return { ok: false, reason: "unavailable" };

  await supabase.from("account_snapshots").insert({
    user_id: userId,
    follower_count: num(u.follower_count),
    following_count: num(u.following_count),
    likes_count: num(u.likes_count),
    video_count: num(u.video_count),
  });

  // ── per-post counts → tiktok_posts ─────────────────────────────────────────
  // A video.list failure after a good snapshot is a PARTIAL success: the
  // account numbers are already saved, so don't fail the refresh over it.
  const list = await tiktokGet<{ videos?: ListedVideo[] }>(
    `${VIDEO_LIST_URL}?fields=${encodeURIComponent(VIDEO_LIST_FIELDS)}`,
    token,
    { method: "POST", body: JSON.stringify({ max_count: VIDEO_LIST_MAX }) },
  );
  const listed = (list?.data?.videos ?? []).filter((v) => v.id);
  if (listed.length === 0) return { ok: true, matched: 0 };

  const { data: ours } = await supabase
    .from("tiktok_posts")
    .select("id, caption, aweme_id, created_at")
    .eq("user_id", userId)
    .eq("status", "PUBLISH_COMPLETE")
    .order("created_at", { ascending: false })
    .limit(100);

  let matched = 0;
  const taken = new Set<string>();
  for (const post of (ours ?? []) as {
    id: string;
    caption: string;
    aweme_id: string | null;
    created_at: string;
  }[]) {
    // By stored id first; otherwise by caption text, tie-broken by timing —
    // the same caption can be posted twice, a timestamp collision can't.
    let hit = post.aweme_id ? listed.find((v) => v.id === post.aweme_id) : undefined;
    if (!hit) {
      const want = normCaption(post.caption);
      const postedMs = new Date(post.created_at).getTime();
      hit = listed
        .filter((v) => {
          if (!v.id || taken.has(v.id)) return false;
          const got = normCaption(v.video_description ?? v.title ?? "");
          if (!want || !got || (got !== want && !got.startsWith(want))) return false;
          const t = (v.create_time ?? 0) * 1000;
          return Math.abs(t - postedMs) < MATCH_WINDOW_MS;
        })
        .sort(
          (a, b) =>
            Math.abs((a.create_time ?? 0) * 1000 - postedMs) -
            Math.abs((b.create_time ?? 0) * 1000 - postedMs),
        )[0];
    }
    if (!hit?.id) continue;
    taken.add(hit.id);
    const { error } = await supabase
      .from("tiktok_posts")
      .update({
        aweme_id: hit.id,
        view_count: num(hit.view_count),
        like_count: num(hit.like_count),
        comment_count: num(hit.comment_count),
        share_count: num(hit.share_count),
        metrics_at: new Date().toISOString(),
      })
      .eq("id", post.id);
    if (!error) matched++;
  }

  return { ok: true, matched };
}
