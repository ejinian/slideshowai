// SERVER-ONLY trends pipeline: Apify scrape → trending_posts cache → feed.
// Never import from client components (uses secret env vars + admin client).

import { createAdminClient } from "@/utils/supabase/admin";
import { createClient } from "@/utils/supabase/server";
import {
  BUSINESS_TYPES,
  getTrendingSlideshows as getSampleFeed,
  type BusinessType,
  type TrendingFeed,
  type TrendingSlideshow,
} from "@/lib/mock-data";

/* ── tuning knobs (cost: actor bills ~$3.70 per 1k returned results) ──────── */

// One search query per niche. Search "top" is the only surface that returns
// photo-mode posts (hashtag feeds and the /video section are video-only), and
// the "slideshow" keyword biases results toward them (~20% yield measured).
export const NICHE_QUERIES: Record<BusinessType, string> = {
  "Gym & Fitness": "gym slideshow",
  "E-commerce": "small business slideshow",
  "Local Service": "local business slideshow",
  "B2C App": "productivity app slideshow",
  "Food & Dining": "restaurant slideshow",
};

// Slideshows are a minority of search results, so we overfetch and filter.
// 5 queries × 20 = 100 results/run ≈ $0.37/run at the actor's list price.
const RESULTS_PER_QUERY = 20;
// Search "top" ranks by all-time relevance (no date filter exists for it), so
// the chart ranks by MOMENTUM (views ÷ hours since post) over a rolling pool:
// recent-and-climbing beats old-and-huge organically, and the daily cron keeps
// topping the pool up with whatever search surfaces next.
const WINDOW_DAYS = 90;
// Rows older than this get pruned at ingest.
const PRUNE_DAYS = 120;

// Stage two — the RECENCY engine. Search discovers slideshow authors; their
// profiles are then scraped with a real date filter (oldestPostDateUnified
// works in profiles mode), which is what fills the past-24h/past-week windows.
// 8 authors × 8 posts adds ≤64 results/run (~$0.24) on top of search.
const AUTHORS_PER_REFRESH = 8;
const POSTS_PER_AUTHOR = 8;
const PROFILE_WINDOW_DAYS = 7;

const ACTOR = "clockworks~tiktok-scraper";

/* ── Apify ────────────────────────────────────────────────────────────────── */

interface ApifyItem {
  id?: string;
  text?: string;
  createTimeISO?: string;
  isSlideshow?: boolean;
  playCount?: number;
  diggCount?: number;
  webVideoUrl?: string;
  searchQuery?: string;
  mediaUrls?: string[];
  slideshowImageLinks?: unknown[];
  authorMeta?: { name?: string; nickName?: string };
  videoMeta?: { coverUrl?: string };
}

const NO_DOWNLOADS = {
  shouldDownloadVideos: false,
  shouldDownloadCovers: false,
  shouldDownloadSlideshowImages: false,
  shouldDownloadAvatars: false,
  shouldDownloadMusicCovers: false,
} as const;

async function runActor(input: Record<string, unknown>): Promise<ApifyItem[]> {
  const token = process.env.APIFY_TOKEN;
  if (!token || token.includes("your_")) {
    throw new Error("APIFY_TOKEN is not configured (set it in .env.local).");
  }
  const res = await fetch(
    `https://api.apify.com/v2/acts/${ACTOR}/run-sync-get-dataset-items?token=${token}&timeout=240`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...input, ...NO_DOWNLOADS }),
      cache: "no-store",
    },
  );
  if (!res.ok) {
    throw new Error(`Apify run failed: ${res.status} ${await res.text()}`);
  }
  return (await res.json()) as ApifyItem[];
}

/** Stage 1 — keyword search, the discovery surface for slideshow authors. */
export async function runTrendsScrape(): Promise<ApifyItem[]> {
  return runActor({
    searchQueries: Object.values(NICHE_QUERIES),
    searchSection: "", // "top" — the only section that includes photo posts
    resultsPerPage: RESULTS_PER_QUERY,
  });
}

/** Stage 2 — watchlist authors' posts from the last PROFILE_WINDOW_DAYS. */
export async function runProfilesScrape(handles: string[]): Promise<ApifyItem[]> {
  if (handles.length === 0) return [];
  return runActor({
    profiles: handles,
    profileSorting: "latest",
    oldestPostDateUnified: new Date(
      Date.now() - PROFILE_WINDOW_DAYS * 86_400_000,
    )
      .toISOString()
      .slice(0, 10),
    resultsPerPage: POSTS_PER_AUTHOR,
  });
}

/* ── mapping ──────────────────────────────────────────────────────────────── */

const QUERY_TO_NICHE: Record<string, BusinessType> = Object.fromEntries(
  (Object.entries(NICHE_QUERIES) as [BusinessType, string][]).map(
    ([niche, q]) => [q.toLowerCase(), niche],
  ),
);

export interface TrendingRow {
  id: string;
  niche: BusinessType;
  title: string;
  author: string;
  cover_url: string | null;
  slide_count: number;
  views: number;
  views_per_hour: number;
  likes: number;
  posted_at: string;
  tiktok_url: string;
  raw: ApifyItem;
}

/**
 * Photo-mode posts inside the window, mapped for the cache table.
 * Profile-scraped items carry no searchQuery, so their niche comes from
 * `nicheByAuthor` (built from the search rows + existing cache); items with
 * no attribution at all are dropped rather than mis-filed.
 */
export function mapApifyItems(
  items: ApifyItem[],
  now = new Date(),
  nicheByAuthor: Record<string, BusinessType> = {},
): TrendingRow[] {
  const cutoff = now.getTime() - WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const rows: TrendingRow[] = [];
  for (const item of items) {
    if (!item.id || item.isSlideshow !== true || !item.createTimeISO) continue;
    const postedMs = Date.parse(item.createTimeISO);
    if (!Number.isFinite(postedMs) || postedMs < cutoff || postedMs > now.getTime()) continue;

    const hours = Math.max(1, (now.getTime() - postedMs) / 3_600_000);
    const views = item.playCount ?? 0;
    const author = (item.authorMeta?.name ?? "").toLowerCase();
    const niche =
      QUERY_TO_NICHE[(item.searchQuery ?? "").toLowerCase()] ??
      nicheByAuthor[author];
    if (!niche) continue;

    rows.push({
      id: item.id,
      niche,
      title: (item.text ?? "").trim().slice(0, 140) || "Untitled slideshow",
      author: `@${item.authorMeta?.name ?? item.authorMeta?.nickName ?? "unknown"}`,
      cover_url: item.videoMeta?.coverUrl ?? item.mediaUrls?.[0] ?? null,
      slide_count: item.slideshowImageLinks?.length ?? 0,
      views,
      views_per_hour: Math.round(views / hours),
      likes: item.diggCount ?? 0,
      posted_at: new Date(postedMs).toISOString(),
      tiktok_url: item.webVideoUrl ?? "",
      raw: item,
    });
  }
  return rows;
}

/* ── ingest (cron) ────────────────────────────────────────────────────────── */

export interface TrendScrapeStats {
  searchFetched: number;
  profileFetched: number;
  authorsScraped: number;
  slideshows: number;
}

/**
 * Both scrape stages, no database access (dry-runnable): search discovers,
 * then the author watchlist (fresh finds first, then `knownAuthors` from the
 * cache) is profile-scraped for genuinely recent posts.
 */
export async function collectTrendRows(
  knownAuthors: Record<string, BusinessType> = {},
): Promise<{ rows: TrendingRow[]; stats: TrendScrapeStats }> {
  const searchItems = await runTrendsScrape();
  const searchRows = mapApifyItems(searchItems);

  const nicheByAuthor: Record<string, BusinessType> = { ...knownAuthors };
  const ordered: string[] = [];
  for (const r of searchRows) {
    const handle = r.author.replace(/^@/, "").toLowerCase();
    if (!handle) continue;
    if (!ordered.includes(handle)) ordered.push(handle);
    nicheByAuthor[handle] = r.niche;
  }
  for (const handle of Object.keys(knownAuthors)) {
    if (!ordered.includes(handle)) ordered.push(handle);
  }
  const handles = ordered.slice(0, AUTHORS_PER_REFRESH);

  const profileItems = await runProfilesScrape(handles);
  const profileRows = mapApifyItems(profileItems, new Date(), nicheByAuthor);

  // Merge; profile rows win on id collisions (fresher stats).
  const byId = new Map<string, TrendingRow>();
  for (const row of [...searchRows, ...profileRows]) byId.set(row.id, row);
  const rows = [...byId.values()];

  return {
    rows,
    stats: {
      searchFetched: searchItems.length,
      profileFetched: profileItems.length,
      authorsScraped: handles.length,
      slideshows: rows.length,
    },
  };
}

export async function ingestTrends(): Promise<TrendScrapeStats & { upserted: number }> {
  const admin = createAdminClient();

  // Fail BEFORE paying for a scrape if the cache table isn't there yet.
  // Also doubles as the watchlist seed: strongest cached authors first.
  const { data: seed, error: seedError } = await admin
    .from("trending_posts")
    .select("author, niche, views")
    .order("views", { ascending: false })
    .limit(40);
  if (seedError) {
    throw new Error(
      `trending_posts is not readable (${seedError.message}). Run the migration in supabase/migrations/20260701220000_trending_posts.sql first.`,
    );
  }

  const knownAuthors: Record<string, BusinessType> = {};
  for (const r of seed ?? []) {
    const handle = (r.author as string).replace(/^@/, "").toLowerCase();
    if (handle && (BUSINESS_TYPES as readonly string[]).includes(r.niche)) {
      knownAuthors[handle] ??= r.niche as BusinessType;
    }
  }

  const { rows, stats } = await collectTrendRows(knownAuthors);

  if (rows.length > 0) {
    const { error } = await admin
      .from("trending_posts")
      .upsert(rows, { onConflict: "id" });
    if (error) throw new Error(`trending_posts upsert failed: ${error.message}`);
  }
  await admin
    .from("trending_posts")
    .delete()
    .lt("posted_at", new Date(Date.now() - PRUNE_DAYS * 86_400_000).toISOString());

  return { ...stats, upserted: rows.length };
}

/* ── personalization ──────────────────────────────────────────────────────── */

// Onboarding niche (user_metadata.niche) → Trends business type. Loose but
// sensible mappings; unmapped niches get no default filter.
const ONBOARDING_TO_TREND: Record<string, BusinessType> = {
  "Gym & Fitness": "Gym & Fitness",
  "Food & Dining": "Food & Dining",
  "E-commerce": "E-commerce",
  "SaaS / Apps": "B2C App",
  "Coaching & Services": "Local Service",
  "Fashion & Beauty": "E-commerce",
  "Real Estate": "Local Service",
};

export function trendNicheForOnboarding(
  onboardingNiche: string | null | undefined,
): BusinessType | null {
  return (onboardingNiche && ONBOARDING_TO_TREND[onboardingNiche]) || null;
}

/* ── feed read (page) ─────────────────────────────────────────────────────── */

/** Live feed from the cache; falls back to the bundled sample when empty. */
export async function getTrendingFeed(): Promise<TrendingFeed> {
  try {
    const supabase = await createClient();
    const since = new Date(Date.now() - WINDOW_DAYS * 86_400_000).toISOString();
    const { data, error } = await supabase
      .from("trending_posts")
      .select(
        "id, niche, title, author, cover_url, slide_count, views, views_per_hour, likes, posted_at, tiktok_url, fetched_at",
      )
      .gte("posted_at", since)
      .order("views_per_hour", { ascending: false })
      .limit(40);

    if (error || !data || data.length === 0) return getSampleFeed();

    const newestFetch = Math.max(...data.map((r) => Date.parse(r.fetched_at)));
    const items: TrendingSlideshow[] = data.map((r, i) => ({
      id: r.id,
      rank: i + 1,
      title: r.title,
      author: r.author,
      niche: (BUSINESS_TYPES as readonly string[]).includes(r.niche)
        ? (r.niche as BusinessType)
        : BUSINESS_TYPES[0],
      cover: r.cover_url ?? "/demo/saas-1.jpeg",
      slideCount: r.slide_count,
      views24h: r.views,
      viewsPerHour: r.views_per_hour,
      likes: r.likes,
      postedAgoHours: Math.max(
        1,
        Math.round((Date.now() - Date.parse(r.posted_at)) / 3_600_000),
      ),
      tiktokUrl: r.tiktok_url,
      whyItWorks:
        "Climbing fast in its niche right now — open it on TikTok and note the hook, the slide count, and where the CTA lands.",
    }));

    return {
      updatedMinutesAgo: Math.max(
        0,
        Math.round((Date.now() - newestFetch) / 60_000),
      ),
      source: "live",
      windowLabel: "Ranked by momentum",
      items,
    };
  } catch {
    return getSampleFeed();
  }
}
