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

// Several search queries per niche. Search "top" is the only surface that
// returns photo-mode posts (hashtag feeds and the /video section are
// video-only), and "slideshow"/"photo dump" keywords bias results toward them
// (~20% yield measured). Variants widen the pool so each niche fills.
export const NICHE_QUERIES: Record<BusinessType, string[]> = {
  "Gym & Fitness": [
    "gym slideshow",
    "fitness slideshow",
    "gym photo dump",
  ],
  "E-commerce": [
    "small business slideshow",
    "small business photo dump",
    "online shop slideshow",
  ],
  "Local Service": [
    "local business slideshow",
    "before and after slideshow",
    "small business owner slideshow",
  ],
  "B2C App": [
    "productivity app slideshow",
    "apps that changed my life slideshow",
    "app recommendations slideshow",
  ],
  "Food & Dining": [
    "restaurant slideshow",
    "food photo dump",
    "cafe photo dump",
  ],
};

// Slideshows are a minority of search results, so we overfetch and filter.
// 15 queries × 20 = 300 results/run ≈ $1.11/run at the actor's list price.
const RESULTS_PER_QUERY = 20;
// Search "top" ranks by all-time relevance (no date filter exists for it), so
// the chart ranks by MOMENTUM (views ÷ hours since post) over a rolling pool:
// recent-and-climbing beats old-and-huge organically, and the daily cron keeps
// topping the pool up with whatever search surfaces next.
const WINDOW_DAYS = 90;
// Rows older than this get pruned at ingest.
const PRUNE_DAYS = 120;

// Stage two — the RECENCY engine, which fills the past-24h/past-week windows.
// Search discovers slideshow authors; their profiles are then scraped via
// ScrapTik (flat $0.002/REQUEST, ~10-20 posts each — vs. clockworks'
// per-result pricing), so a big watchlist costs cents: 40 authors ≈ $0.08/run.
// ScrapTik's search can't see photo posts (its mobile-API search only returns
// videos — verified 2026-07-06), which is why DISCOVERY stays on clockworks.
const AUTHORS_PER_REFRESH = 40;
const POSTS_PER_AUTHOR = 20;
const PROFILE_CONCURRENCY = 8;

const SEARCH_ACTOR = "clockworks~tiktok-scraper";
const PROFILE_ACTOR = "scraptik~tiktok-api";

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
  /** `id` = TikTok numeric uid — needed to profile-scrape via ScrapTik. */
  authorMeta?: { name?: string; nickName?: string; id?: string };
  videoMeta?: { coverUrl?: string };
}

// ScrapTik returns TikTok's internal "aweme" shape; photo posts are
// aweme_type 150 with image_post_info. Converted to ApifyItem so the whole
// downstream pipeline (mapping, curation, covers) stays provider-agnostic.
interface AwemePost {
  aweme_id?: string;
  desc?: string;
  create_time?: number; // unix seconds
  aweme_type?: number;
  share_url?: string;
  statistics?: { play_count?: number; digg_count?: number };
  author?: { unique_id?: string; nickname?: string; uid?: string };
  image_post_info?: {
    images?: { display_image?: { url_list?: string[] } }[];
  };
  video?: { cover?: { url_list?: string[] } };
}

// TikTok's url_list pairs a HEIC variant with a JPEG one (each individually
// signed). Sharp's prebuilt binaries can't decode HEIC, so prefer jpeg/webp.
function pickDecodableUrl(urls: string[] | undefined): string | undefined {
  if (!urls?.length) return undefined;
  const decodable = urls.find((u) => /\.(jpe?g|webp|png)(\?|$)/i.test(u));
  return decodable ?? urls[0];
}

function awemeToApifyItem(p: AwemePost): ApifyItem {
  const images = p.image_post_info?.images ?? [];
  const handle = p.author?.unique_id;
  return {
    id: p.aweme_id,
    text: p.desc,
    createTimeISO: p.create_time
      ? new Date(p.create_time * 1000).toISOString()
      : undefined,
    isSlideshow: p.aweme_type === 150 || images.length > 0,
    playCount: p.statistics?.play_count,
    diggCount: p.statistics?.digg_count,
    webVideoUrl:
      p.share_url?.split("?")[0] ||
      (handle && p.aweme_id
        ? `https://www.tiktok.com/@${handle}/photo/${p.aweme_id}`
        : undefined),
    slideshowImageLinks: images,
    authorMeta: {
      name: handle,
      nickName: p.author?.nickname,
      id: p.author?.uid,
    },
    videoMeta: {
      coverUrl:
        pickDecodableUrl(images[0]?.display_image?.url_list) ??
        pickDecodableUrl(p.video?.cover?.url_list),
    },
  };
}

const NO_DOWNLOADS = {
  shouldDownloadVideos: false,
  shouldDownloadCovers: false,
  shouldDownloadSlideshowImages: false,
  shouldDownloadAvatars: false,
  shouldDownloadMusicCovers: false,
} as const;

async function runActor<T>(
  actor: string,
  input: Record<string, unknown>,
): Promise<T[]> {
  const token = process.env.APIFY_TOKEN;
  if (!token || token.includes("your_")) {
    throw new Error("APIFY_TOKEN is not configured (set it in .env.local).");
  }
  const res = await fetch(
    `https://api.apify.com/v2/acts/${actor}/run-sync-get-dataset-items?token=${token}&timeout=240`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
      cache: "no-store",
    },
  );
  if (!res.ok) {
    throw new Error(`Apify run failed: ${res.status} ${await res.text()}`);
  }
  return (await res.json()) as T[];
}

/** Stage 1 — keyword search, the discovery surface for slideshow authors. */
export async function runTrendsScrape(): Promise<ApifyItem[]> {
  return runActor<ApifyItem>(SEARCH_ACTOR, {
    searchQueries: Object.values(NICHE_QUERIES).flat(),
    searchSection: "", // "top" — the only section that includes photo posts
    resultsPerPage: RESULTS_PER_QUERY,
    ...NO_DOWNLOADS,
  });
}

/**
 * Stage 2 — watchlist authors' latest posts via ScrapTik (one request per
 * author, run concurrently). An author whose scrape fails is skipped rather
 * than failing the whole refresh.
 */
export async function runProfilesScrape(
  authors: { uid: string; handle: string }[],
): Promise<ApifyItem[]> {
  const queue = [...authors];
  const items: ApifyItem[] = [];
  await Promise.all(
    Array.from({ length: PROFILE_CONCURRENCY }, async () => {
      for (;;) {
        const author = queue.shift();
        if (!author) return;
        try {
          const results = await runActor<{ aweme_list?: AwemePost[] }>(
            PROFILE_ACTOR,
            {
              userPosts_userId: author.uid,
              userPosts_count: POSTS_PER_AUTHOR,
              userPosts_region: "US",
            },
          );
          for (const r of results) {
            for (const p of r?.aweme_list ?? []) items.push(awemeToApifyItem(p));
          }
        } catch {
          // skip this author
        }
      }
    }),
  );
  return items;
}

/* ── mapping ──────────────────────────────────────────────────────────────── */

const QUERY_TO_NICHE: Record<string, BusinessType> = Object.fromEntries(
  (Object.entries(NICHE_QUERIES) as [BusinessType, string[]][]).flatMap(
    ([niche, queries]) => queries.map((q) => [q.toLowerCase(), niche]),
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
  /** One-line teardown written by the ingest curation pass (null until curated). */
  why_it_works: string | null;
  /** Format label from the curation pass, e.g. "Transformation arc". */
  hook_type: string | null;
  /** Slide-by-slide format breakdown from the curation pass. */
  anatomy: AnatomyBeat[] | null;
  raw: ApifyItem;
}

export interface AnatomyBeat {
  /** Which slides this beat covers, e.g. "1" or "2-5". */
  slides: string;
  /** What those slides do, e.g. "Hook — deliberately unimpressive day-1 photo". */
  beat: string;
}

// Postgres rejects NUL characters and unpaired UTF-16 surrogates anywhere in
// a row ("invalid input syntax for type json"), and TikTok captions
// occasionally contain both.
const stripNul = (s: string) =>
  s
    .replace(/\u0000/g, "")
    .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/g, "")
    .replace(/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "");
// Deep-clean every string value (the jsonb raw column is the usual
// offender, but captions land in text columns too). Operating on decoded
// string values via a stringify replacer is corruption-proof, unlike
// stripping escape sequences out of serialized JSON.
const sanitizeRaw = (item: ApifyItem): ApifyItem =>
  JSON.parse(
    JSON.stringify(item, (_key, value) =>
      typeof value === "string" ? stripNul(value) : value,
    ),
  ) as ApifyItem;

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
      // slice BEFORE stripNul: a UTF-16 slice can cut an emoji in half and
      // create a fresh lone surrogate, which stripNul then removes.
      title:
        stripNul((item.text ?? "").trim().slice(0, 140)) ||
        "Untitled slideshow",
      author: `@${stripNul(item.authorMeta?.name ?? item.authorMeta?.nickName ?? "unknown")}`,
      cover_url: item.videoMeta?.coverUrl ?? item.mediaUrls?.[0] ?? null,
      slide_count: item.slideshowImageLinks?.length ?? 0,
      views,
      views_per_hour: Math.round(views / hours),
      likes: item.diggCount ?? 0,
      posted_at: new Date(postedMs).toISOString(),
      tiktok_url: item.webVideoUrl ?? "",
      why_it_works: null,
      hook_type: null,
      anatomy: null,
      raw: sanitizeRaw(item),
    });
  }
  return rows;
}

/* ── AI curation (ingest-time) ────────────────────────────────────────────── */

// gpt-4o-mini judges each new post: does it actually belong in its assigned
// business niche (vs. personal/off-topic posts the keyword search dragged in),
// and what makes its format work. Fails OPEN — an API error keeps the rows
// uncurated rather than losing a paid scrape.

interface CurationVerdict {
  relevant: boolean;
  why: string;
  hookType: string | null;
  anatomy: AnatomyBeat[] | null;
}

const CURATION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["posts"],
  properties: {
    posts: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "relevant", "why", "hook_type", "anatomy"],
        properties: {
          id: { type: "string" },
          relevant: { type: "boolean" },
          why: { type: "string" },
          hook_type: { type: "string" },
          anatomy: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["slides", "beat"],
              properties: {
                slides: { type: "string" },
                beat: { type: "string" },
              },
            },
          },
        },
      },
    },
  },
} as const;

const CURATION_SYSTEM = `You curate a trends feed for small-business owners who make TikTok photo slideshows to market their business. Each input post was found by keyword search and assigned a business niche. The feed teaches FORMATS — the post itself does not need to come from a business account.

For every post, return:
- relevant: true if the post's TOPIC fits its assigned niche and its format is something a business owner in that niche could imitate. A personal gym photo dump fits "Gym & Fitness"; a cafe photo dump fits "Food & Dining". Only mark relevant: false for posts clearly OFF-TOPIC for the niche (wrong subject entirely), or worthless as inspiration (bare spam, giveaway/engagement bait, reposted fan edits of celebrities).
- why: for relevant posts, ONE punchy sentence (max 140 chars) tearing down why the format works — name the hook mechanic (curiosity gap, price anchor, transformation arc, listicle, POV, etc.). For irrelevant posts return an empty string.
- hook_type: a 1-3 word format label in sentence case, e.g. "Transformation arc", "Price anchor", "Gatekeep listicle", "POV story", "Photo dump", "Before and after". Empty string for irrelevant posts.
- anatomy: 2-4 beats describing the slideshow's structure a business owner could copy, inferred from the caption and slide count. Each beat: slides = which slide numbers it covers ("1", "2-5"), beat = what those slides do (max 90 chars, start with the beat's job: "Hook — ...", "Proof — ...", "CTA — ..."). Empty array for irrelevant posts or when the structure is unguessable.

When unsure, keep the post (relevant: true). Return a verdict for EVERY input id.`;

const CURATION_BATCH = 25;

async function curateRows(
  rows: TrendingRow[],
): Promise<Map<string, CurationVerdict>> {
  const verdicts = new Map<string, CurationVerdict>();
  const apiKey = process.env.OPENAI_API_KEY;
  if (rows.length === 0 || !apiKey || apiKey.includes("REPLACE_ME")) {
    return verdicts;
  }
  const { default: OpenAI } = await import("openai");
  const openai = new OpenAI({ apiKey, timeout: 60_000, maxRetries: 1 });

  const batches: TrendingRow[][] = [];
  for (let i = 0; i < rows.length; i += CURATION_BATCH) {
    batches.push(rows.slice(i, i + CURATION_BATCH));
  }

  await Promise.all(
    batches.map(async (batch) => {
      try {
        const completion = await openai.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [
            { role: "system", content: CURATION_SYSTEM },
            {
              role: "user",
              content: JSON.stringify(
                batch.map((r) => ({
                  id: r.id,
                  niche: r.niche,
                  caption: r.title,
                  author: r.author,
                  views: r.views,
                  likes: r.likes,
                  slides: r.slide_count,
                })),
              ),
            },
          ],
          response_format: {
            type: "json_schema",
            json_schema: {
              name: "curation",
              strict: true,
              schema: CURATION_SCHEMA,
            },
          },
        });
        const parsed = JSON.parse(
          completion.choices[0]?.message?.content ?? "{}",
        ) as {
          posts?: {
            id?: string;
            relevant?: boolean;
            why?: string;
            hook_type?: string;
            anatomy?: { slides?: string; beat?: string }[];
          }[];
        };
        for (const p of parsed.posts ?? []) {
          if (!p.id) continue;
          const anatomy = (p.anatomy ?? [])
            .filter((b) => b.slides && b.beat)
            .slice(0, 4)
            .map((b) => ({
              slides: stripNul((b.slides ?? "").trim().slice(0, 12)),
              beat: stripNul((b.beat ?? "").trim().slice(0, 120)),
            }));
          verdicts.set(p.id, {
            relevant: p.relevant !== false,
            why: stripNul((p.why ?? "").trim().slice(0, 200)),
            hookType: stripNul((p.hook_type ?? "").trim().slice(0, 40)) || null,
            anatomy: anatomy.length > 0 ? anatomy : null,
          });
        }
      } catch {
        // fail open: this batch stays uncurated
      }
    }),
  );
  return verdicts;
}

/* ── cover caching (ingest-time) ──────────────────────────────────────────── */

// TikTok CDN cover URLs are signed and expire within a day or two, after
// which the Trends grid renders black tiles. At ingest each kept post's cover
// is downloaded, shrunk to a card-sized JPEG, and stored in a public Storage
// bucket we own. Fails OPEN per cover — a bad download keeps the CDN URL
// (still fresh for ~a day) rather than dropping the post.

const COVER_BUCKET = "trend-covers";
const COVER_PATH_MARKER = `/storage/v1/object/public/${COVER_BUCKET}/`;
const COVER_CONCURRENCY = 8;
const COVER_WIDTH = 480;

type AdminClient = ReturnType<typeof createAdminClient>;

async function cacheOneCover(
  admin: AdminClient,
  row: TrendingRow,
): Promise<string | null> {
  if (!row.cover_url) return null;
  try {
    const res = await fetch(row.cover_url, {
      signal: AbortSignal.timeout(10_000),
      cache: "no-store",
    });
    if (!res.ok) return null;
    const { default: sharp } = await import("sharp");
    const jpeg = await sharp(Buffer.from(await res.arrayBuffer()))
      .resize({ width: COVER_WIDTH, withoutEnlargement: true })
      .jpeg({ quality: 78 })
      .toBuffer();
    const path = `${row.id}.jpg`;
    const { error } = await admin.storage
      .from(COVER_BUCKET)
      .upload(path, jpeg, { contentType: "image/jpeg", upsert: true });
    if (error) return null; // bucket missing / not migrated yet
    return admin.storage.from(COVER_BUCKET).getPublicUrl(path).data.publicUrl;
  } catch {
    return null;
  }
}

/**
 * Rewrites each row's cover_url to a durable Storage URL. `alreadyCached`
 * (id → our storage URL, from the existing cache rows) skips re-downloading
 * posts whose cover we captured on a previous run.
 */
async function cacheCovers(
  admin: AdminClient,
  rows: TrendingRow[],
  alreadyCached: Map<string, string>,
): Promise<{ rows: TrendingRow[]; cached: number }> {
  const queue = [...rows];
  const out: TrendingRow[] = [];
  let cached = 0;
  await Promise.all(
    Array.from({ length: COVER_CONCURRENCY }, async () => {
      for (;;) {
        const row = queue.shift();
        if (!row) return;
        const existing = alreadyCached.get(row.id);
        if (existing) {
          out.push({ ...row, cover_url: existing });
          continue;
        }
        const url = await cacheOneCover(admin, row);
        if (url) cached++;
        out.push(url ? { ...row, cover_url: url } : row);
      }
    }),
  );
  return { rows: out, cached };
}

/* ── ingest (cron) ────────────────────────────────────────────────────────── */

export interface TrendScrapeStats {
  searchFetched: number;
  profileFetched: number;
  authorsScraped: number;
  slideshows: number;
}

export interface KnownAuthor {
  niche: BusinessType;
  /** TikTok numeric uid — required for the ScrapTik profile scrape. */
  uid?: string | null;
}

/**
 * Both scrape stages, no database access (dry-runnable): search discovers,
 * then the author watchlist (fresh finds first, then `knownAuthors` from the
 * cache) is profile-scraped for genuinely recent posts. Authors with no
 * known uid can't be profile-scraped and are skipped.
 */
export async function collectTrendRows(
  knownAuthors: Record<string, KnownAuthor> = {},
): Promise<{ rows: TrendingRow[]; stats: TrendScrapeStats }> {
  const searchItems = await runTrendsScrape();
  const searchRows = mapApifyItems(searchItems);

  const nicheByAuthor: Record<string, BusinessType> = {};
  const uidByHandle: Record<string, string> = {};
  for (const [handle, a] of Object.entries(knownAuthors)) {
    nicheByAuthor[handle] = a.niche;
    if (a.uid) uidByHandle[handle] = a.uid;
  }
  const ordered: string[] = [];
  for (const r of searchRows) {
    const handle = r.author.replace(/^@/, "").toLowerCase();
    if (!handle) continue;
    if (!ordered.includes(handle)) ordered.push(handle);
    nicheByAuthor[handle] = r.niche;
    const uid = r.raw.authorMeta?.id;
    if (uid) uidByHandle[handle] = uid;
  }
  for (const handle of Object.keys(knownAuthors)) {
    if (!ordered.includes(handle)) ordered.push(handle);
  }
  const watchlist = ordered
    .filter((h) => uidByHandle[h])
    .slice(0, AUTHORS_PER_REFRESH)
    .map((h) => ({ uid: uidByHandle[h], handle: h }));

  const profileItems = await runProfilesScrape(watchlist);
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
      authorsScraped: watchlist.length,
      slideshows: rows.length,
    },
  };
}

export async function ingestTrends(): Promise<
  TrendScrapeStats & {
    upserted: number;
    curated: number;
    dropped: number;
    coversCached: number;
  }
> {
  const admin = createAdminClient();

  // Fail BEFORE paying for a scrape if the cache table isn't there yet.
  // Also doubles as the watchlist seed: strongest cached authors first.
  // (raw carries authorMeta.id, the uid ScrapTik needs for profile scrapes.)
  const { data: seed, error: seedError } = await admin
    .from("trending_posts")
    .select("author, niche, views, raw")
    .order("views", { ascending: false })
    .limit(120);
  if (seedError) {
    throw new Error(
      `trending_posts is not readable (${seedError.message}). Run the migration in supabase/migrations/20260701220000_trending_posts.sql first.`,
    );
  }

  const knownAuthors: Record<string, KnownAuthor> = {};
  for (const r of seed ?? []) {
    const handle = (r.author as string).replace(/^@/, "").toLowerCase();
    if (handle && (BUSINESS_TYPES as readonly string[]).includes(r.niche)) {
      knownAuthors[handle] ??= {
        niche: r.niche as BusinessType,
        uid: (r.raw as ApifyItem | null)?.authorMeta?.id ?? null,
      };
    }
  }

  const { rows, stats } = await collectTrendRows(knownAuthors);

  // Curate only NEW posts (already-cached ones keep their verdict) so the
  // LLM pass stays cheap and re-runs don't churn the teardown copy. Same
  // lookup collects covers we already captured into our Storage bucket.
  interface CachedInsights {
    why: string;
    hookType: string | null;
    anatomy: AnatomyBeat[] | null;
  }
  const existingInsights = new Map<string, CachedInsights>();
  const existingCover = new Map<string, string>();
  if (rows.length > 0) {
    const ids = rows.map((r) => r.id);
    interface ExistingRow {
      id: string;
      why_it_works?: string | null;
      hook_type?: string | null;
      anatomy?: AnatomyBeat[] | null;
      cover_url?: string | null;
    }
    let existing = (
      await admin
        .from("trending_posts")
        .select("id, why_it_works, hook_type, anatomy, cover_url")
        .in("id", ids)
    ).data as ExistingRow[] | null;
    if (!existing) {
      // Insight columns not migrated yet — fall back to covers only.
      existing = (
        await admin.from("trending_posts").select("id, cover_url").in("id", ids)
      ).data as ExistingRow[] | null;
    }
    for (const e of existing ?? []) {
      if (e.why_it_works) {
        existingInsights.set(e.id, {
          why: e.why_it_works,
          hookType: e.hook_type ?? null,
          anatomy: e.anatomy ?? null,
        });
      }
      if (e.cover_url?.includes(COVER_PATH_MARKER)) {
        existingCover.set(e.id, e.cover_url);
      }
    }
  }
  const verdicts = await curateRows(
    rows.filter((r) => !existingInsights.has(r.id)),
  );

  let dropped = 0;
  const kept: TrendingRow[] = [];
  for (const r of rows) {
    const cached = existingInsights.get(r.id);
    if (cached) {
      kept.push({
        ...r,
        why_it_works: cached.why,
        hook_type: cached.hookType,
        anatomy: cached.anatomy,
      });
      continue;
    }
    const v = verdicts.get(r.id);
    if (v && !v.relevant) {
      dropped++;
      continue;
    }
    kept.push({
      ...r,
      why_it_works: v?.why || null,
      hook_type: v?.hookType ?? null,
      anatomy: v?.anatomy ?? null,
    });
  }

  // Durable covers: only for rows that survived curation (no paying to store
  // images for dropped posts).
  const { rows: covered, cached: coversCached } = await cacheCovers(
    admin,
    kept,
    existingCover,
  );
  kept.length = 0;
  kept.push(...covered);

  if (kept.length > 0) {
    let { error } = await admin
      .from("trending_posts")
      .upsert(kept, { onConflict: "id" });
    // Migration not applied yet — don't lose a paid scrape over the new
    // columns; store the rows without the insight fields instead.
    if (error && /why_it_works|hook_type|anatomy/.test(error.message)) {
      ({ error } = await admin
        .from("trending_posts")
        .upsert(
          kept.map((r) => {
            const rest: Partial<TrendingRow> = { ...r };
            delete rest.why_it_works;
            delete rest.hook_type;
            delete rest.anatomy;
            return rest;
          }),
          { onConflict: "id" },
        ));
    }
    if (error) throw new Error(`trending_posts upsert failed: ${error.message}`);

    // View-count history — one snapshot per post per refresh, the data behind
    // momentum sparklines. Best-effort: fails silently until its migration.
    await admin.from("trend_snapshots").insert(
      kept.map((r) => ({
        post_id: r.id,
        views: r.views,
        views_per_hour: r.views_per_hour,
      })),
    );
    await admin
      .from("trend_snapshots")
      .delete()
      .lt(
        "captured_at",
        new Date(Date.now() - PRUNE_DAYS * 86_400_000).toISOString(),
      );
  }
  await admin
    .from("trending_posts")
    .delete()
    .lt("posted_at", new Date(Date.now() - PRUNE_DAYS * 86_400_000).toISOString());

  return {
    ...stats,
    upserted: kept.length,
    curated: verdicts.size,
    dropped,
    coversCached,
  };
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

// Feed shape: top posts PER NICHE (not one global chart), so every filter
// pill has content and one loud niche can't crowd out the rest.
const FEED_PER_NICHE = 30;
const FEED_FETCH_LIMIT = 400;

interface FeedRow {
  id: string;
  niche: string;
  title: string;
  author: string;
  cover_url: string | null;
  slide_count: number;
  views: number;
  views_per_hour: number;
  likes: number;
  posted_at: string;
  tiktok_url: string;
  fetched_at: string;
  why_it_works?: string | null;
  hook_type?: string | null;
  anatomy?: AnatomyBeat[] | null;
}

const GENERIC_WHY =
  "Climbing fast in its niche right now — open it on TikTok and note the hook, the slide count, and where the CTA lands.";

/** Live feed from the cache; falls back to the bundled sample when empty. */
export async function getTrendingFeed(): Promise<TrendingFeed> {
  try {
    const supabase = await createClient();
    const since = new Date(Date.now() - WINDOW_DAYS * 86_400_000).toISOString();
    const baseColumns =
      "id, niche, title, author, cover_url, slide_count, views, views_per_hour, likes, posted_at, tiktok_url, fetched_at";
    const query = (columns: string) =>
      supabase
        .from("trending_posts")
        .select(columns)
        .gte("posted_at", since)
        .order("views_per_hour", { ascending: false })
        .limit(FEED_FETCH_LIMIT);

    let { data, error } = (await query(
      `${baseColumns}, why_it_works, hook_type, anatomy`,
    )) as {
      data: FeedRow[] | null;
      error: { message: string } | null;
    };
    // Tolerate a deploy that lands before the insight-columns migration runs.
    if (error && /why_it_works|hook_type|anatomy/.test(error.message)) {
      ({ data, error } = (await query(baseColumns)) as {
        data: FeedRow[] | null;
        error: { message: string } | null;
      });
    }
    if (error || !data || data.length === 0) return getSampleFeed();

    // Rows arrive globally sorted by momentum; cap each niche's share.
    const perNiche = new Map<string, number>();
    const balanced = data.filter((r) => {
      const n = perNiche.get(r.niche) ?? 0;
      if (n >= FEED_PER_NICHE) return false;
      perNiche.set(r.niche, n + 1);
      return true;
    });

    // View-count history for sparklines (best-effort — table may not exist).
    const history = new Map<string, number[]>();
    try {
      const { data: snaps } = await supabase
        .from("trend_snapshots")
        .select("post_id, views, captured_at")
        .in(
          "post_id",
          balanced.map((r) => r.id),
        )
        .order("captured_at", { ascending: true });
      for (const s of snaps ?? []) {
        const list = history.get(s.post_id) ?? [];
        list.push(s.views);
        history.set(s.post_id, list);
      }
    } catch {
      // sparklines simply don't render
    }

    // Benchmark: how a post's views compare to its niche's average in the feed.
    const nicheTotals = new Map<string, { sum: number; n: number }>();
    for (const r of balanced) {
      const t = nicheTotals.get(r.niche) ?? { sum: 0, n: 0 };
      t.sum += r.views;
      t.n += 1;
      nicheTotals.set(r.niche, t);
    }

    const newestFetch = Math.max(...balanced.map((r) => Date.parse(r.fetched_at)));
    const items: TrendingSlideshow[] = balanced.map((r, i) => {
      const t = nicheTotals.get(r.niche);
      const avg = t && t.n >= 3 ? t.sum / t.n : 0;
      return {
        id: r.id,
        rank: i + 1,
        title: r.title,
        author: r.author,
        niche: (BUSINESS_TYPES as readonly string[]).includes(r.niche)
          ? (r.niche as BusinessType)
          : BUSINESS_TYPES[0],
        // Empty string → the UI renders its niche-gradient placeholder.
        cover: r.cover_url ?? "",
        slideCount: r.slide_count,
        views24h: r.views,
        viewsPerHour: r.views_per_hour,
        likes: r.likes,
        postedAgoHours: Math.max(
          1,
          Math.round((Date.now() - Date.parse(r.posted_at)) / 3_600_000),
        ),
        tiktokUrl: r.tiktok_url,
        whyItWorks: r.why_it_works || GENERIC_WHY,
        hookType: r.hook_type ?? null,
        anatomy: r.anatomy ?? null,
        history: (history.get(r.id) ?? []).slice(-10),
        nicheMultiple: avg > 0 ? r.views / avg : null,
      };
    });

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

/* ── inspiration feed (page) ──────────────────────────────────────────────── */

// The viral hall of fame: inspiration_posts (12-month window, populated by
// scripts/ingest-inspiration.mjs), ranked by raw views instead of momentum.
const INSPIRATION_WINDOW_DAYS = 365;
const INSPIRATION_PER_NICHE = 120;
const INSPIRATION_FETCH_LIMIT = 1000;

/** Empty items (never the sample feed) until the backfill has run. */
export async function getInspirationFeed(): Promise<TrendingFeed> {
  const empty: TrendingFeed = {
    updatedMinutesAgo: 0,
    source: "live",
    windowLabel: "Most viral · past 12 months",
    items: [],
  };
  try {
    const supabase = await createClient();
    const since = new Date(
      Date.now() - INSPIRATION_WINDOW_DAYS * 86_400_000,
    ).toISOString();
    const { data, error } = (await supabase
      .from("inspiration_posts")
      .select(
        "id, niche, title, author, cover_url, slide_count, views, views_per_hour, likes, posted_at, tiktok_url, fetched_at, why_it_works, hook_type, anatomy",
      )
      .gte("posted_at", since)
      .order("views", { ascending: false })
      .limit(INSPIRATION_FETCH_LIMIT)) as {
      data: FeedRow[] | null;
      error: { message: string } | null;
    };
    if (error || !data || data.length === 0) return empty;

    const perNiche = new Map<string, number>();
    const balanced = data.filter((r) => {
      const n = perNiche.get(r.niche) ?? 0;
      if (n >= INSPIRATION_PER_NICHE) return false;
      perNiche.set(r.niche, n + 1);
      return true;
    });

    const nicheTotals = new Map<string, { sum: number; n: number }>();
    for (const r of balanced) {
      const t = nicheTotals.get(r.niche) ?? { sum: 0, n: 0 };
      t.sum += r.views;
      t.n += 1;
      nicheTotals.set(r.niche, t);
    }

    const newestFetch = Math.max(...balanced.map((r) => Date.parse(r.fetched_at)));
    const items: TrendingSlideshow[] = balanced.map((r, i) => {
      const t = nicheTotals.get(r.niche);
      const avg = t && t.n >= 3 ? t.sum / t.n : 0;
      return {
        id: r.id,
        rank: i + 1,
        title: r.title,
        author: r.author,
        niche: (BUSINESS_TYPES as readonly string[]).includes(r.niche)
          ? (r.niche as BusinessType)
          : BUSINESS_TYPES[0],
        cover: r.cover_url ?? "",
        slideCount: r.slide_count,
        views24h: r.views,
        viewsPerHour: r.views_per_hour,
        likes: r.likes,
        postedAgoHours: Math.max(
          1,
          Math.round((Date.now() - Date.parse(r.posted_at)) / 3_600_000),
        ),
        tiktokUrl: r.tiktok_url,
        whyItWorks: r.why_it_works || GENERIC_WHY,
        hookType: r.hook_type ?? null,
        anatomy: r.anatomy ?? null,
        history: [],
        nicheMultiple: avg > 0 ? r.views / avg : null,
      };
    });

    return {
      updatedMinutesAgo: Math.max(
        0,
        Math.round((Date.now() - newestFetch) / 60_000),
      ),
      source: "live",
      windowLabel: "Most viral · past 12 months",
      items,
    };
  } catch {
    return empty;
  }
}
