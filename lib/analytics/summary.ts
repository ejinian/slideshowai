import type { SupabaseClient } from "@supabase/supabase-js";
import { accountLabel } from "@/lib/tiktok/accountLabel";

// Real analytics, from our own tables only.
//
// Per-post views/likes come from tiktok_posts columns that
// lib/analytics/scrape.ts fills off the user's PUBLIC profile — TikTok's own
// API never exposes them to a commercial app (Research API only). They are
// nullable three ways: migration 20260831130000 not yet run, a post not yet
// matched by a scrape, or a private account. All three render as "—", so the
// select FALLS BACK to the legacy column list when the columns are missing
// rather than letting the whole page 500 on a schema race.

const DAY_MS = 86_400_000;
const WINDOW_DAYS = 30;

export interface StatCard {
  label: string;
  value: string;
  /** Percent change vs the preceding window. Null = no meaningful comparison. */
  delta: number | null;
  hint?: string;
}

export interface ActivityPoint {
  date: string;
  posts: number;
}

export interface PostedRow {
  id: string;
  slideshowId: string;
  title: string;
  /** On-demand render of slide 0; versioned so edits bust the image cache. */
  thumbnail: string;
  postedAt: string;
  status: "posted" | "processing" | "failed";
  failReason: string | null;
  /** Scraped from the public profile; null until matched (or account private). */
  views: number | null;
  likes: number | null;
  /** Which connected account the post went to — shown only with >1 connected. */
  account: string | null;
}

export interface AnalyticsSummary {
  stats: StatCard[];
  activity: ActivityPoint[];
  rows: PostedRow[];
  /** No TikTok account connected — the page explains itself rather than zeroing. */
  connected: boolean;
  /** More than one account connected — per-row account labels earn their space. */
  multiAccount: boolean;
}

interface PostRecord {
  id: string;
  slideshow_id: string;
  status: string;
  created_at: string;
  fail_reason: string | null;
  view_count?: number | null;
  like_count?: number | null;
  open_id?: string | null;
  slideshows: { title: string | null; updated_at: string | null } | null;
}

/** Percent change, or null when the baseline is 0 (any change would read as ∞). */
function delta(current: number, previous: number): number | null {
  if (previous <= 0) return null;
  return ((current - previous) / previous) * 100;
}

function statusOf(raw: string): PostedRow["status"] {
  if (raw === "PUBLISH_COMPLETE") return "posted";
  if (raw === "FAILED") return "failed";
  return "processing";
}

export async function loadAnalytics(
  supabase: SupabaseClient,
  userId: string,
): Promise<AnalyticsSummary> {
  const now = Date.now();
  const windowStart = new Date(now - WINDOW_DAYS * DAY_MS).toISOString();
  const priorStart = new Date(now - 2 * WINDOW_DAYS * DAY_MS).toISOString();

  const [postsRes, scheduledRes, decksRes, connRes] = await Promise.all([
    // Joined so the table can show the DECK's title rather than the caption —
    // the caption is slide 1's text and is often mid-sentence.
    supabase
      .from("tiktok_posts")
      .select(
        "id, slideshow_id, status, created_at, fail_reason, view_count, like_count, open_id, slideshows(title, updated_at)",
      )
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(200),
    supabase
      .from("scheduled_posts")
      .select("id, status, scheduled_at")
      .eq("user_id", userId)
      .eq("status", "queued"),
    supabase
      .from("slideshows")
      .select("id, created_at")
      .eq("user_id", userId)
      .limit(1000),
    // limit(1): a maybeSingle over multiple connections (multi-account) errors.
    // The full list (not an existence probe): open_id → label for the per-row
    // account badges, and length > 1 decides whether badges render at all.
    supabase
      .from("tiktok_connections")
      .select("open_id, display_name, username")
      .eq("user_id", userId),
  ]);

  let posts = (postsRes.data ?? []) as unknown as PostRecord[];
  if (postsRes.error) {
    // Metric columns not migrated yet — serve the page without them.
    const legacy = await supabase
      .from("tiktok_posts")
      .select("id, slideshow_id, status, created_at, fail_reason, slideshows(title, updated_at)")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(200);
    posts = (legacy.data ?? []) as unknown as PostRecord[];
  }
  const decks = (decksRes.data ?? []) as { created_at: string }[];

  const published = posts.filter((p) => p.status === "PUBLISH_COMPLETE");
  const failed = posts.filter((p) => p.status === "FAILED");
  const inWindow = (iso: string, from: string) => iso >= from;

  const publishedNow = published.filter((p) => inWindow(p.created_at, windowStart)).length;
  const publishedPrev = published.filter(
    (p) => inWindow(p.created_at, priorStart) && !inWindow(p.created_at, windowStart),
  ).length;
  const decksNow = decks.filter((d) => inWindow(d.created_at, windowStart)).length;
  const decksPrev = decks.filter(
    (d) => inWindow(d.created_at, priorStart) && !inWindow(d.created_at, windowStart),
  ).length;

  // Only settled attempts count — a post still downloading is not yet a failure.
  const settled = published.length + failed.length;
  const successRate = settled > 0 ? Math.round((published.length / settled) * 100) : null;

  const stats: StatCard[] = [
    {
      label: "Posts published",
      value: String(published.length),
      delta: delta(publishedNow, publishedPrev),
      hint: `${publishedNow} in the last ${WINDOW_DAYS} days`,
    },
    {
      label: "Slideshows created",
      value: String(decks.length),
      delta: delta(decksNow, decksPrev),
      hint: `${decksNow} in the last ${WINDOW_DAYS} days`,
    },
    {
      label: "Scheduled",
      value: String(scheduledRes.data?.length ?? 0),
      delta: null,
      hint: "waiting to go out",
    },
    {
      label: "Publish success",
      value: successRate == null ? "—" : `${successRate}%`,
      delta: null,
      hint: settled > 0 ? `${published.length} of ${settled} attempts` : "no attempts yet",
    },
  ];

  // Posting cadence per day. Every day in the window is present, including the
  // empty ones, so the gaps between posts are visible rather than compressed.
  const byDay = new Map<string, number>();
  for (let i = WINDOW_DAYS - 1; i >= 0; i--) {
    byDay.set(new Date(now - i * DAY_MS).toISOString().slice(0, 10), 0);
  }
  for (const p of published) {
    const key = p.created_at.slice(0, 10);
    if (byDay.has(key)) byDay.set(key, (byDay.get(key) ?? 0) + 1);
  }
  const activity: ActivityPoint[] = [...byDay.entries()].map(([iso, count]) => ({
    date: new Date(`${iso}T00:00:00`).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    }),
    posts: count,
  }));

  const conns = (connRes.data ?? []) as {
    open_id: string;
    display_name: string | null;
    username: string | null;
  }[];
  const labelByOpenId = new Map(
    conns.map((c) => [
      c.open_id,
      accountLabel({ openId: c.open_id, displayName: c.display_name, username: c.username }),
    ]),
  );

  const rows: PostedRow[] = posts.map((p) => ({
    id: p.id,
    slideshowId: p.slideshow_id,
    title: p.slideshows?.title?.trim() || "Untitled slideshow",
    thumbnail: `/api/slideshows/${p.slideshow_id}/render/0${
      p.slideshows?.updated_at ? `?v=${encodeURIComponent(p.slideshows.updated_at)}` : ""
    }`,
    postedAt: p.created_at,
    status: statusOf(p.status),
    failReason: p.fail_reason,
    views: p.view_count ?? null,
    likes: p.like_count ?? null,
    account: p.open_id ? (labelByOpenId.get(p.open_id) ?? null) : null,
  }));

  return {
    stats,
    activity,
    rows,
    connected: conns.length > 0,
    multiAccount: conns.length > 1,
  };
}
