import type { SupabaseClient } from "@supabase/supabase-js";

// Account-level TikTok stats — followers, total likes, video count — read from
// account_snapshots, which lib/analytics/officialStats.ts fills from TikTok's
// own API (user.info.stats; gated on TIKTOK_STATS_SCOPES until the scope
// revision in docs/tiktok-scope-revision.md is approved).
//
// Reads here are snapshot-only and synchronous with the page; refreshing is
// the client's job: when `stale`, AnalyticsView fires POST
// /api/analytics/refresh (throttled to once an hour server-side) and
// re-renders on success.

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
  /** Connected, but no snapshot exists yet — the first refresh is the client's next move. */
  | "pending";

export interface AccountSummary {
  status: AccountStatus;
  stats: AccountStats | null;
  /** Accumulated history, oldest first. Empty until snapshots build up. */
  trend: FollowerPoint[];
  /** Newest snapshot is older than an hour (or absent) — worth a refresh. */
  stale: boolean;
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

  if (!conn) return { status: "disconnected", stats: latest, trend, stale: false };

  const stale =
    !latest || Date.now() - new Date(latest.capturedAt).getTime() >= SNAPSHOT_INTERVAL_MS;
  return { status: latest ? "ok" : "pending", stats: latest, trend, stale };
}
