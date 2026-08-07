import type { SupabaseClient } from "@supabase/supabase-js";
import { getValidToken } from "@/utils/tiktok";

// Account-level TikTok stats — followers, total likes, video count.
//
// This is the ONLY engagement data available to us. Per-post views and likes
// live in the Research API (vetted researchers only); the Display API's
// /v2/video/list/ returns metadata with no counts. So: account totals, and a
// trend we accumulate ourselves because TikTok exposes only current values.

const USER_INFO_URL = "https://open.tiktokapis.com/v2/user/info/";
const FIELDS = "follower_count,following_count,likes_count,video_count";
// Rendering the page must not hang on TikTok. Past this we serve the last
// snapshot instead — stale-but-instant beats fresh-but-blocking.
const FETCH_TIMEOUT_MS = 4000;
const SNAPSHOT_INTERVAL_MS = 60 * 60 * 1000;

export interface AccountStats {
  followerCount: number | null;
  followingCount: number | null;
  likesCount: number | null;
  videoCount: number | null;
  capturedAt: string;
}

export interface FollowerPoint {
  date: string;
  followers: number;
}

export type AccountStatus =
  | "ok"
  /** No TikTok account linked. */
  | "disconnected"
  /** Connected, but the token predates the user.info.stats scope. */
  | "needs_reconnect"
  /** Connected and scoped, but TikTok didn't answer. Last snapshot is shown. */
  | "unavailable";

export interface AccountSummary {
  status: AccountStatus;
  stats: AccountStats | null;
  /** Accumulated history, oldest first. Empty until snapshots build up. */
  trend: FollowerPoint[];
}

interface UserInfoResponse {
  data?: {
    user?: {
      follower_count?: number;
      following_count?: number;
      likes_count?: number;
      video_count?: number;
    };
  };
  error?: { code?: string; message?: string };
}

/**
 * A missing scope is the expected failure for a while: every connection made
 * before user.info.stats was added carries a token without it, and TikTok
 * cannot grant it retroactively. That's a "reconnect" prompt, not an error.
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

async function fetchLive(
  supabase: SupabaseClient,
  userId: string,
): Promise<{ stats: Omit<AccountStats, "capturedAt"> } | { failure: AccountStatus }> {
  let token: string;
  try {
    token = await getValidToken(supabase, userId);
  } catch {
    // getValidToken throws when there is no connection row, and also when a
    // refresh fails (a revoked or expired refresh token) — both mean the user
    // has to link the account again.
    return { failure: "needs_reconnect" };
  }

  try {
    const res = await fetch(`${USER_INFO_URL}?fields=${encodeURIComponent(FIELDS)}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    const json = (await res.json()) as UserInfoResponse;
    const err = json.error;
    if (!res.ok || (err?.code && err.code !== "ok")) {
      return {
        failure: isScopeError(err?.code, err?.message) ? "needs_reconnect" : "unavailable",
      };
    }
    const u = json.data?.user;
    if (!u) return { failure: "unavailable" };
    return {
      stats: {
        followerCount: u.follower_count ?? null,
        followingCount: u.following_count ?? null,
        likesCount: u.likes_count ?? null,
        videoCount: u.video_count ?? null,
      },
    };
  } catch {
    // Timeout or transport failure.
    return { failure: "unavailable" };
  }
}

export async function loadAccountSummary(
  supabase: SupabaseClient,
  userId: string,
): Promise<AccountSummary> {
  const [{ data: conn }, { data: history }] = await Promise.all([
    supabase.from("tiktok_connections").select("id").eq("user_id", userId).maybeSingle(),
    supabase
      .from("account_snapshots")
      .select("captured_at, follower_count, following_count, likes_count, video_count")
      .eq("user_id", userId)
      .order("captured_at", { ascending: false })
      .limit(180),
  ]);

  const rows = (history ?? []) as {
    captured_at: string;
    follower_count: number | null;
    following_count: number | null;
    likes_count: number | null;
    video_count: number | null;
  }[];

  const trend: FollowerPoint[] = rows
    .filter((r) => r.follower_count != null)
    .map((r) => ({
      date: new Date(r.captured_at).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      }),
      followers: r.follower_count as number,
    }))
    .reverse(); // oldest first, for the chart

  const latest = rows[0]
    ? {
        followerCount: rows[0].follower_count,
        followingCount: rows[0].following_count,
        likesCount: rows[0].likes_count,
        videoCount: rows[0].video_count,
        capturedAt: rows[0].captured_at,
      }
    : null;

  if (!conn) return { status: "disconnected", stats: null, trend };

  // Only call TikTok when the newest snapshot is stale; a page refresh should
  // not cost an API round-trip, and the rate limits are per-user.
  const fresh =
    latest && Date.now() - new Date(latest.capturedAt).getTime() < SNAPSHOT_INTERVAL_MS;
  if (fresh) return { status: "ok", stats: latest, trend };

  const live = await fetchLive(supabase, userId);
  if ("failure" in live) {
    // Keep showing the last known numbers, but say why they aren't updating.
    return { status: live.failure, stats: latest, trend };
  }

  const capturedAt = new Date().toISOString();
  // Best-effort: a failed insert costs a trend point, never the page.
  await supabase.from("account_snapshots").insert({
    user_id: userId,
    captured_at: capturedAt,
    follower_count: live.stats.followerCount,
    following_count: live.stats.followingCount,
    likes_count: live.stats.likesCount,
    video_count: live.stats.videoCount,
  });

  const stats: AccountStats = { ...live.stats, capturedAt };
  const nextTrend =
    stats.followerCount != null
      ? [
          ...trend,
          {
            date: new Date(capturedAt).toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
            }),
            followers: stats.followerCount,
          },
        ]
      : trend;

  return { status: "ok", stats, trend: nextTrend };
}
