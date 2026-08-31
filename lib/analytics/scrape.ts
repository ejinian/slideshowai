import type { SupabaseClient } from "@supabase/supabase-js";
import { getValidToken } from "@/utils/tiktok";
import { runActor } from "@/lib/trends";

// Public-profile scrape for analytics — followers, total likes, and per-post
// views — via the same ScrapTik actor the trends watchlist uses.
//
// WHY SCRAPING: the official path is gone. `user.info.stats` was removed from
// the authorize scope (2026-08-08; re-adding it means a full TikTok
// re-review), and per-post counts were never available to a commercial app in
// the first place (Research API only). The user's PUBLIC profile carries all
// of it, and we already pay ScrapTik $0.002/request for exactly this shape of
// data in the trends pipeline.
//
// Cost/pacing: 2 requests per refresh (profile + posts), and the caller
// (app/api/analytics/refresh) only fires when the newest snapshot is >1h old.
//
// Everything degrades: no username resolvable, a private account, ScrapTik
// down or over its monthly cap — each returns a typed failure and the page
// keeps serving the last stored numbers.

const PROFILE_ACTOR = "scraptik~tiktok-api";
// A page-visit-triggered refresh; far below the cron pipeline's 240s.
const ACTOR_TIMEOUT_SECS = 60;
const CREATOR_INFO_URL = "https://open.tiktokapis.com/v2/post/publish/creator_info/query/";
const POSTS_TO_SCRAPE = 33;
// A scraped post must sit within this window of our publish record to count
// as a caption match — captions repeat across a user's decks; timing doesn't.
const MATCH_WINDOW_MS = 7 * 86_400_000;

export type RefreshResult =
  | { ok: true; privateAccount: boolean; matched: number }
  | { ok: false; reason: "disconnected" | "no_username" | "scrape_failed" };

interface ScrapedProfile {
  uid?: string;
  unique_id?: string;
  follower_count?: number;
  following_count?: number;
  total_favorited?: number | string; // ScrapTik returns this one as a string sometimes
  aweme_count?: number;
  secret?: boolean | number;
}

interface ScrapedPost {
  aweme_id?: string;
  desc?: string;
  create_time?: number; // unix seconds
  statistics?: {
    play_count?: number;
    digg_count?: number;
    comment_count?: number;
    share_count?: number;
  };
}

const num = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const normCaption = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

/**
 * The @handle comes from the Content Posting API's creator_info — a scope we
 * DO hold (video.publish). Resolved once, then cached on the connection row.
 */
async function fetchUsername(supabase: SupabaseClient, userId: string): Promise<string | null> {
  let token: string;
  try {
    token = await getValidToken(supabase, userId);
  } catch {
    return null;
  }
  try {
    const res = await fetch(CREATOR_INFO_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=UTF-8",
        Authorization: `Bearer ${token}`,
      },
      signal: AbortSignal.timeout(5000),
    });
    const json = (await res.json()) as {
      data?: { creator_username?: string };
      error?: { code?: string };
    };
    if (!res.ok || (json.error?.code && json.error.code !== "ok")) return null;
    return json.data?.creator_username?.trim() || null;
  } catch {
    return null;
  }
}

/**
 * Scrape the user's public profile, snapshot the account stats, and copy
 * per-post counts onto matching tiktok_posts rows.
 */
export async function refreshViaScrape(
  supabase: SupabaseClient,
  userId: string,
): Promise<RefreshResult> {
  const { data: conn } = await supabase
    .from("tiktok_connections")
    .select("id, username, tiktok_uid")
    .eq("user_id", userId)
    .maybeSingle();
  if (!conn) return { ok: false, reason: "disconnected" };

  let username = (conn as { username?: string | null }).username ?? null;
  if (!username) {
    username = await fetchUsername(supabase, userId);
    if (username) {
      await supabase.from("tiktok_connections").update({ username }).eq("id", conn.id);
    }
  }
  if (!username) return { ok: false, reason: "no_username" };

  // ── profile: follower/like/video counts + the numeric uid userPosts needs ──
  let profile: ScrapedProfile;
  try {
    const items = await runActor<{ user?: ScrapedProfile } | ScrapedProfile>(
      PROFILE_ACTOR,
      { profile_username: username },
      ACTOR_TIMEOUT_SECS,
    );
    const first = items?.[0];
    const u = first && "user" in first && first.user ? first.user : (first as ScrapedProfile);
    if (!u || (u.follower_count == null && u.uid == null)) throw new Error("empty profile");
    profile = u;
  } catch (e) {
    console.error("[analytics] profile scrape failed:", e instanceof Error ? e.message : e);
    return { ok: false, reason: "scrape_failed" };
  }

  await supabase.from("account_snapshots").insert({
    user_id: userId,
    follower_count: num(profile.follower_count),
    following_count: num(profile.following_count),
    likes_count: num(profile.total_favorited),
    video_count: num(profile.aweme_count),
  });

  const uid = profile.uid ?? (conn as { tiktok_uid?: string | null }).tiktok_uid ?? null;
  if (uid && uid !== (conn as { tiktok_uid?: string | null }).tiktok_uid) {
    await supabase.from("tiktok_connections").update({ tiktok_uid: uid }).eq("id", conn.id);
  }

  // A private profile exposes no posts — the account numbers above are still
  // real, so this is a successful refresh with nothing to match.
  const isPrivate = profile.secret === true || profile.secret === 1;
  if (isPrivate || !uid) return { ok: true, privateAccount: isPrivate, matched: 0 };

  // ── posts: copy counts onto our publish records ────────────────────────────
  let scraped: ScrapedPost[] = [];
  try {
    const results = await runActor<{ aweme_list?: ScrapedPost[] }>(
      PROFILE_ACTOR,
      { userPosts_userId: uid, userPosts_count: POSTS_TO_SCRAPE, userPosts_region: "US" },
      ACTOR_TIMEOUT_SECS,
    );
    for (const r of results) scraped.push(...(r?.aweme_list ?? []));
  } catch (e) {
    // Account stats landed; per-post counts just don't update this round.
    console.error("[analytics] posts scrape failed:", e instanceof Error ? e.message : e);
    scraped = [];
  }
  if (scraped.length === 0) return { ok: true, privateAccount: false, matched: 0 };

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
    let hit = post.aweme_id
      ? scraped.find((s) => s.aweme_id === post.aweme_id)
      : undefined;
    if (!hit) {
      const want = normCaption(post.caption);
      const postedMs = new Date(post.created_at).getTime();
      hit = scraped
        .filter((s) => {
          if (!s.aweme_id || taken.has(s.aweme_id)) return false;
          const got = normCaption(s.desc ?? "");
          if (!want || !got || (got !== want && !got.startsWith(want))) return false;
          const t = (s.create_time ?? 0) * 1000;
          return Math.abs(t - postedMs) < MATCH_WINDOW_MS;
        })
        .sort(
          (a, b) =>
            Math.abs((a.create_time ?? 0) * 1000 - postedMs) -
            Math.abs((b.create_time ?? 0) * 1000 - postedMs),
        )[0];
    }
    if (!hit?.aweme_id) continue;
    taken.add(hit.aweme_id);
    const { error } = await supabase
      .from("tiktok_posts")
      .update({
        aweme_id: hit.aweme_id,
        view_count: num(hit.statistics?.play_count),
        like_count: num(hit.statistics?.digg_count),
        comment_count: num(hit.statistics?.comment_count),
        share_count: num(hit.statistics?.share_count),
        metrics_at: new Date().toISOString(),
      })
      .eq("id", post.id);
    if (!error) matched++;
  }

  return { ok: true, privateAccount: false, matched };
}
