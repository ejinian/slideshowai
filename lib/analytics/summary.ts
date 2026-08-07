import type { SupabaseClient } from "@supabase/supabase-js";

// Real analytics, from our own tables only.
//
// SCOPE NOTE — why there are no views/likes here. TikTok's Display API returns
// video METADATA (`/v2/video/list/`: id, title, cover_image_url, share_url…) and
// no engagement counts. Per-post view/like/comment/share numbers live in the
// Research API, which is limited to vetted researchers and not open to a
// commercial app. Account-level totals ARE available via the `user.info.stats`
// scope and are a separate, later step.
//
// So this page reports what we can state truthfully: what the user posted, when,
// whether it landed, and what they've built. Four real numbers beat eight where
// half are invented.

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
}

export interface AnalyticsSummary {
  stats: StatCard[];
  activity: ActivityPoint[];
  rows: PostedRow[];
  /** No TikTok account connected — the page explains itself rather than zeroing. */
  connected: boolean;
}

interface PostRecord {
  id: string;
  slideshow_id: string;
  status: string;
  created_at: string;
  fail_reason: string | null;
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
      .select("id, slideshow_id, status, created_at, fail_reason, slideshows(title, updated_at)")
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
    supabase.from("tiktok_connections").select("id").eq("user_id", userId).maybeSingle(),
  ]);

  const posts = (postsRes.data ?? []) as unknown as PostRecord[];
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
  }));

  return { stats, activity, rows, connected: !!connRes.data };
}
