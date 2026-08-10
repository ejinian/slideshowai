// SERVER-ONLY trends pipeline: Apify scrape → trending_posts cache → feed.
// Never import from client components (uses secret env vars + admin client).

import { createAdminClient } from "@/utils/supabase/admin";
import { createClient } from "@/utils/supabase/server";
import { transcribeSlideTexts } from "@/lib/trend-slide-text";
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
// 15 queries × 30 = 450 results/run ≈ $1.67/run at the actor's list price
// (the expensive knob — clockworks bills per RESULT). Env-tunable so volume
// can be raised or dialed back without a deploy.
const RESULTS_PER_QUERY =
  Number(process.env.TRENDS_RESULTS_PER_QUERY) || 30;
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
// Cheap knob (flat per-request): 100 authors ≈ $0.20/run. This is the RECENCY
// engine — the bigger the watchlist, the fuller "Best today" gets. Env-tunable.
// The VOLUME engine. Full runs are infrequent (weekly Vercel cron + the daily
// 13:00 pinger), so depth here is cheap: 500 × $0.002 ≈ $1/run. It is also
// self-limiting — the watchlist is seeded from authors already discovered, so
// a number above the known-author count simply scrapes everyone we have.
const AUTHORS_PER_REFRESH =
  Number(process.env.TRENDS_AUTHORS_PER_REFRESH) || 5000;
// Rows scanned to build the watchlist. This — not AUTHORS_PER_REFRESH — was the
// real ceiling: the seed read a flat 120 rows, so after deduping by handle the
// watchlist was ~50 authors no matter what the limit said.
const SEED_ROW_LIMIT = Number(process.env.TRENDS_SEED_ROW_LIMIT) || 40_000;
// Sweeps are the FRESHNESS engine and run ~5× a day (daily Vercel profiles
// cron + the 05/09/17/21 pinger sweeps), so this number is multiplied by ~150
// runs/month — it is the real cost driver, not AUTHORS_PER_REFRESH. Kept to a
// 3× raise (150 × $0.002 × ~150 ≈ $45/mo, vs ~$15/mo at 50) rather than
// matching the full run. Tune with TRENDS_SWEEP_AUTHORS.
const SWEEP_AUTHORS_PER_REFRESH =
  Number(process.env.TRENDS_SWEEP_AUTHORS) || 150;
const POSTS_PER_AUTHOR = 20;
// 500 authors at the old concurrency of 8 is ~60 serial batches — minutes of
// wall clock against a 300s function. Raised, but kept below Apify's per-plan
// concurrent-run ceiling.
const PROFILE_CONCURRENCY =
  Number(process.env.TRENDS_PROFILE_CONCURRENCY) || 16;
// The cron route declares maxDuration = 300. Stop pulling authors at this mark
// and leave the remainder for the DB upserts: overrunning kills the WHOLE
// refresh, including the search rows we already paid clockworks for, so
// partial coverage always beats a timeout.
const RUN_BUDGET_MS = Number(process.env.TRENDS_RUN_BUDGET_MS) || 240_000;

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
  /** Epoch ms after which workers stop taking new authors (see RUN_BUDGET_MS). */
  deadlineAt?: number,
): Promise<{ items: ApifyItem[]; scraped: number; skipped: number }> {
  const queue = [...authors];
  const items: ApifyItem[] = [];
  let scraped = 0;
  // Every author failing identically is not "some authors were skipped" — it's
  // the provider refusing us (expired token, or the monthly spend cap, which is
  // what silently froze the feed for six days in July 2026 while the sweep kept
  // returning 200 OK with zero rows). Keep the first error and log a summary.
  let failed = 0;
  let firstError = "";
  await Promise.all(
    Array.from({ length: PROFILE_CONCURRENCY }, async () => {
      for (;;) {
        // Out of time: leave the rest of the queue for the next run rather
        // than overrunning the function and losing everything.
        if (deadlineAt && Date.now() > deadlineAt) return;
        const author = queue.shift();
        if (!author) return;
        scraped++;
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
        } catch (e) {
          failed++;
          firstError ||= e instanceof Error ? e.message : String(e);
        }
      }
    }),
  );
  if (failed) {
    const all = failed === scraped;
    console[all ? "error" : "warn"](
      `[trends] profile scrape failed for ${failed}/${scraped} authors` +
        `${all ? " — ALL failed, treat as a provider/billing outage" : ""}: ${firstError}`,
    );
  }
  const skipped = queue.length;
  if (skipped) {
    console.warn(
      `[trends] profile scrape hit the ${RUN_BUDGET_MS}ms budget — ` +
        `scraped ${scraped}/${authors.length}, skipped ${skipped}. ` +
        "Lower TRENDS_AUTHORS_PER_REFRESH or raise TRENDS_PROFILE_CONCURRENCY.",
    );
  }
  return { items, scraped, skipped };
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
  /**
   * The words actually ON the slides, transcribed from the images at ingest
   * (lib/trend-slide-text.ts). One entry per slide, in order. Null = not
   * transcribed — consumers fall back to `title`, which is the video
   * DESCRIPTION and a much weaker signal. See the column's migration.
   */
  slide_texts: string[] | null;
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
      slide_texts: null,
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
- relevant: true if the post's TOPIC fits its assigned niche and its format is something a business owner in that niche could imitate. A personal gym photo dump fits "Gym & Fitness"; a cafe photo dump fits "Food & Dining". Mark relevant: false for posts clearly OFF-TOPIC for the niche (wrong subject entirely), worthless as inspiration (bare spam, giveaway/engagement bait, reposted fan edits of celebrities), or NOT IN ENGLISH — any caption whose words are primarily in another language is out (hashtag-only captions count as English).
- why: for relevant posts, ONE punchy sentence (max 140 chars) tearing down why the format works — name the hook mechanic (curiosity gap, price anchor, transformation arc, listicle, POV, etc.). For irrelevant posts return an empty string.
- hook_type: a 1-3 word format label in sentence case, e.g. "Transformation arc", "Price anchor", "Gatekeep listicle", "POV story", "Photo dump", "Before and after". Empty string for irrelevant posts.
- anatomy: 2-4 beats describing the slideshow's structure a business owner could copy, inferred from the caption and slide count. Each beat: slides = which slide numbers it covers ("1", "2-5"), beat = what those slides do (max 90 chars, start with the beat's job: "Hook — ...", "Proof — ...", "CTA — ..."). Empty array for irrelevant posts or when the structure is unguessable.

When unsure, keep the post (relevant: true). Return a verdict for EVERY input id.`;

const CURATION_BATCH = 25;
// A 5000-author run can surface thousands of NEW posts at once. Batching them
// 25-at-a-time and firing every batch through Promise.all would mean hundreds
// of simultaneous OpenAI calls — instant rate-limiting, a surprise bill, and a
// stalled cron. Cap both how many rows we curate per run and how many batches
// are in flight. Uncurated rows are already handled everywhere: `why_it_works`
// falls back to GENERIC_WHY, and a missing `hook_type` falls back to the
// deterministic format inference in lib/trend-topics.
const CURATION_MAX_ROWS = Number(process.env.TRENDS_CURATION_MAX_ROWS) || 600;
const CURATION_CONCURRENCY =
  Number(process.env.TRENDS_CURATION_CONCURRENCY) || 6;

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

  // Curate the biggest posts first — if the cap bites, the rows that reach the
  // top of the board are the ones that got a real teardown.
  const eligible = [...rows]
    .sort((a, b) => b.views - a.views)
    .slice(0, CURATION_MAX_ROWS);
  if (eligible.length < rows.length) {
    console.warn(
      `[trends] curating ${eligible.length}/${rows.length} new posts ` +
        `(TRENDS_CURATION_MAX_ROWS=${CURATION_MAX_ROWS}); the rest keep the ` +
        "generic teardown and inferred format.",
    );
  }

  const batches: TrendingRow[][] = [];
  for (let i = 0; i < eligible.length; i += CURATION_BATCH) {
    batches.push(eligible.slice(i, i + CURATION_BATCH));
  }

  // Worker pool over the batch queue — bounded in-flight requests.
  const queue = [...batches];
  await Promise.all(
    Array.from({ length: Math.min(CURATION_CONCURRENCY, queue.length) }, () =>
      (async () => {
        for (;;) {
          const batch = queue.shift();
          if (!batch) return;
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
                hookType:
                  stripNul((p.hook_type ?? "").trim().slice(0, 40)) || null,
                anatomy: anatomy.length > 0 ? anatomy : null,
              });
            }
          } catch {
            // fail open: this batch stays uncurated
          }
        }
      })(),
    ),
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
  /** Watchlist authors dropped because the run hit RUN_BUDGET_MS. Non-zero
   *  means the watchlist is bigger than one run can cover — visible in the
   *  cron's JSON response so it can't degrade silently. */
  authorsSkipped: number;
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
  opts: { searchless?: boolean } = {},
): Promise<{ rows: TrendingRow[]; stats: TrendScrapeStats }> {
  // Clock starts BEFORE the search stage: on a full run clockworks can burn
  // most of the function's budget, and the profile stage gets what's left.
  const deadlineAt = Date.now() + RUN_BUDGET_MS;
  // Searchless = watchlist-only stat sweep: skips the expensive clockworks
  // discovery (per-result pricing) and just re-scrapes known authors via
  // ScrapTik (flat ~$0.002/req). Cheap enough to run every few hours, which
  // is what keeps "Best today" full and the Rising climb rates fresh.
  const searchItems = opts.searchless ? [] : await runTrendsScrape();
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
    .slice(0, opts.searchless ? SWEEP_AUTHORS_PER_REFRESH : AUTHORS_PER_REFRESH)
    .map((h) => ({ uid: uidByHandle[h], handle: h }));

  const {
    items: profileItems,
    scraped: authorsScraped,
    skipped: authorsSkipped,
  } = await runProfilesScrape(watchlist, deadlineAt);
  // A searchless sweep IS the profile scrape — if every author failed there is
  // no partial result to salvage, so fail loudly (500) instead of reporting a
  // healthy-looking run with zero rows. The discovery path still returns its
  // search rows, which are already paid for.
  // Guard on authors actually ATTEMPTED, not the watchlist size: a run clipped
  // by the time budget scrapes fewer than it planned, and blaming that on the
  // provider would turn a slow run into a fake billing alarm.
  if (opts.searchless && authorsScraped > 0 && profileItems.length === 0) {
    throw new Error(
      `Profile sweep returned nothing for all ${authorsScraped} authors — ` +
        "check the Apify token and the account's monthly spend cap.",
    );
  }
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
      authorsScraped,
      authorsSkipped,
      slideshows: rows.length,
    },
  };
}

export async function ingestTrends(
  opts: { searchless?: boolean } = {},
): Promise<
  TrendScrapeStats & {
    upserted: number;
    curated: number;
    dropped: number;
    coversCached: number;
    slideTextsRead: number;
  }
> {
  const admin = createAdminClient();

  // Fail BEFORE paying for a scrape if the cache table isn't there yet — the
  // first page doubles as that check.
  //
  // Watchlist ordering differs by run type, which is what makes a watchlist
  // bigger than one run can cover actually work:
  //   full run  → STALEST first (fetched_at asc). The time budget cuts the tail
  //               off every run, and with a fixed "strongest first" order that
  //               tail would never be scraped at all. Stalest-first rotates, so
  //               successive runs pick up where the last one stopped.
  //   sweep     → STRONGEST first (views desc). Sweeps exist to keep the
  //               leaderboard's numbers fresh, not to widen coverage.
  //
  // `uid` is pulled with a JSON selector rather than the whole `raw` blob —
  // at tens of thousands of rows, dragging raw across the wire is the
  // difference between a few MB and hundreds.
  const knownAuthors: Record<string, KnownAuthor> = {};
  const targetAuthors = opts.searchless
    ? SWEEP_AUTHORS_PER_REFRESH
    : AUTHORS_PER_REFRESH;
  let seedCols = "author, niche, views, uid:raw->authorMeta->>id";
  // Shrinks if we have to fall back to selecting whole `raw` blobs — scanning
  // 40k of those would move hundreds of MB for a handful of uids.
  let scanLimit = SEED_ROW_LIMIT;
  for (let from = 0; from < scanLimit; from += PAGE) {
    const base = admin
      .from("trending_posts")
      .select(seedCols)
      .range(from, from + PAGE - 1);
    const { data, error } = (await (opts.searchless
      ? base.order("views", { ascending: false })
      : base.order("fetched_at", { ascending: true }))) as {
      data: { author: string; niche: string; uid: string | null }[] | null;
      error: { message: string } | null;
    };
    if (error) {
      // A PostgREST build that can't do the JSON selector shouldn't take the
      // whole refresh down — fall back to the old shape once, then give up.
      if (from === 0 && seedCols.includes("uid:")) {
        seedCols = "author, niche, views, raw";
        scanLimit = Math.min(scanLimit, 5 * PAGE);
        console.warn(
          "[trends] JSON uid selector rejected; falling back to full `raw` " +
            `rows and capping the seed scan at ${scanLimit}.`,
        );
        from -= PAGE;
        continue;
      }
      if (from === 0) {
        throw new Error(
          `trending_posts is not readable (${error.message}). Run the migration in supabase/migrations/20260701220000_trending_posts.sql first.`,
        );
      }
      break;
    }
    if (!data || data.length === 0) break;
    for (const r of data) {
      const handle = (r.author ?? "").replace(/^@/, "").toLowerCase();
      if (!handle || !(BUSINESS_TYPES as readonly string[]).includes(r.niche)) {
        continue;
      }
      knownAuthors[handle] ??= {
        niche: r.niche as BusinessType,
        uid:
          r.uid ??
          ((r as unknown as { raw?: ApifyItem | null }).raw?.authorMeta?.id ??
            null),
      };
    }
    if (Object.keys(knownAuthors).length >= targetAuthors) break;
    if (data.length < PAGE) break;
  }

  const { rows, stats } = await collectTrendRows(knownAuthors, opts);

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
  const existingSlideTexts = new Map<string, string[]>();
  if (rows.length > 0) {
    const ids = rows.map((r) => r.id);
    interface ExistingRow {
      id: string;
      why_it_works?: string | null;
      hook_type?: string | null;
      anatomy?: AnatomyBeat[] | null;
      slide_texts?: string[] | null;
      cover_url?: string | null;
    }
    let existing = (
      await admin
        .from("trending_posts")
        .select("id, why_it_works, hook_type, anatomy, slide_texts, cover_url")
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
      // Transcription is cached independently of the curation insights: it was
      // added later, so most already-curated rows have no slide_texts yet and
      // must still qualify for the vision pass.
      //
      // An EMPTY array counts as cached. null means "never successfully read"
      // (images 403'd — TikTok's signed URLs expire in ~a day — or the call
      // failed), and those stay eligible so a later run that re-scrapes the post
      // with fresh links can transcribe it. `[]` means "read it, no overlay
      // text", which is a permanent answer: without this a photo-only deck would
      // be re-transcribed on every single run until it aged out of the feed.
      if (Array.isArray(e.slide_texts)) {
        existingSlideTexts.set(e.id, e.slide_texts);
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
        slide_texts: existingSlideTexts.get(r.id) ?? null,
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
      slide_texts: existingSlideTexts.get(r.id) ?? null,
    });
  }

  // Read the words off the slides — see lib/trend-slide-text.ts. Runs AFTER
  // curation so we never pay to transcribe a post we're about to drop, and only
  // for rows with no cached transcription (this is the expensive-but-permanent
  // half of ingest: once a post is transcribed it never is again).
  const transcribed = await transcribeSlideTexts(
    kept.filter((r) => !r.slide_texts),
  );
  if (transcribed.size > 0) {
    for (const r of kept) {
      const texts = transcribed.get(r.id);
      // stripNul at the persistence boundary, same as `title` — an on-slide
      // caption is user-authored text and can carry the NULs and lone
      // surrogates Postgres rejects outright.
      if (texts) r.slide_texts = texts.map((t) => stripNul(t));
    }
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
    if (
      error &&
      /why_it_works|hook_type|anatomy|slide_texts/.test(error.message)
    ) {
      ({ error } = await admin
        .from("trending_posts")
        .upsert(
          kept.map((r) => {
            const rest: Partial<TrendingRow> = { ...r };
            delete rest.why_it_works;
            delete rest.hook_type;
            delete rest.anatomy;
            delete rest.slide_texts;
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
    slideTextsRead: transcribed.size,
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
// These are READ caps, not ingest caps — they bound how much of the table the
// page surfaces, and cost nothing but bandwidth. They used to hold the feed to
// ~30 posts/niche off a 400-row read, which is why the board looked thin next
// to TikTok's: the rows were already in `trending_posts` (the watchlist alone
// stores up to AUTHORS_PER_REFRESH × POSTS_PER_AUTHOR = 2000 photo posts per
// run), we just weren't reading them. Raise ingest only if the table itself is
// short — see TRENDS_RESULTS_PER_QUERY / TRENDS_AUTHORS_PER_REFRESH, which do
// cost Apify credits per run.
// 5 niches × 200 ≈ 1000 posts on the board, the target. Every post is
// serialized into the RSC payload (~0.5KB each with its teardown text), so
// this is the knob that trades board size against page weight — push it via
// env before changing the default.
const FEED_PER_NICHE = Number(process.env.TRENDS_FEED_PER_NICHE) || 200;
// The raw read the niche caps select FROM — bigger than the board so a single
// loud niche can't starve the others.
const FEED_FETCH_LIMIT = Number(process.env.TRENDS_FEED_FETCH_LIMIT) || 3000;
// The recency pool: EVERY known post from the last week rides along with the
// momentum chart so the recent periods see the full picture.
const RECENT_POOL_DAYS = 7;
const RECENT_POOL_LIMIT = Number(process.env.TRENDS_RECENT_POOL_LIMIT) || 1000;
// PostgREST hard-caps ANY single response at 1000 rows regardless of .limit(),
// so every read above that has to page with .range() (the inspiration feed
// already did; the live feed silently truncated at 1000).
const PAGE = 1000;

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
  medium?: string | null;
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
    const recentSince = new Date(
      Date.now() - RECENT_POOL_DAYS * 86_400_000,
    ).toISOString();
    // Two pools: the classic momentum chart (top by lifetime rate, niche-
    // balanced) UNION every post from the last week ranked by views. The
    // second pool is what fills "Best today"/"Best this week" — without it,
    // a fresh post had to beat 90 days of compounding momentum winners just
    // to reach the browser, which starved the recency tabs.
    // Paged read — see PAGE. `sortBy` is the ordering column; rows come back
    // globally sorted across pages because .order() is applied server-side.
    // Pages are issued in PARALLEL, not in a sequential loop: the cap is known
    // up front, and at 3-4 pages a serial loop would add ~0.5s of round-trips
    // to every trends render. Overshooting an exhausted table just returns
    // empty pages, which cost nothing.
    const fetchAll = async (
      columns: string,
      afterDate: string,
      sortBy: "views_per_hour" | "views",
      cap: number,
    ): Promise<{ rows: FeedRow[]; error: { message: string } | null }> => {
      const starts = Array.from(
        { length: Math.ceil(cap / PAGE) },
        (_, i) => i * PAGE,
      );
      const pages = await Promise.all(
        starts.map(
          (from) =>
            supabase
              .from("trending_posts")
              .select(columns)
              .gte("posted_at", afterDate)
              .order(sortBy, { ascending: false })
              .range(from, Math.min(from + PAGE, cap) - 1) as unknown as
              Promise<{
                data: FeedRow[] | null;
                error: { message: string } | null;
              }>,
        ),
      );
      const firstError = pages.find((p) => p.error)?.error ?? null;
      // Keep page order so the server-side sort survives the concatenation.
      const rows = pages.flatMap((p) => p.data ?? []);
      return { rows, error: rows.length === 0 ? firstError : null };
    };

    const run = async (columns: string) => {
      const [a, b] = await Promise.all([
        fetchAll(columns, since, "views_per_hour", FEED_FETCH_LIMIT),
        fetchAll(columns, recentSince, "views", RECENT_POOL_LIMIT),
      ]);
      return {
        data: a.rows as FeedRow[] | null,
        recent: b.rows as FeedRow[] | null,
        error: (a.error ?? b.error) as { message: string } | null,
      };
    };

    let { data, recent, error } = await run(
      `${baseColumns}, why_it_works, hook_type, anatomy`,
    );
    // Tolerate a deploy that lands before the insight-columns migration runs.
    if (error && /why_it_works|hook_type|anatomy/.test(error.message)) {
      ({ data, recent, error } = await run(baseColumns));
    }
    if (error || !data || data.length === 0) return getSampleFeed();

    // Momentum rows arrive globally sorted; cap each niche's share.
    const perNiche = new Map<string, number>();
    const momentum = data.filter((r) => {
      const n = perNiche.get(r.niche) ?? 0;
      if (n >= FEED_PER_NICHE) return false;
      perNiche.set(r.niche, n + 1);
      return true;
    });
    // Recent rows are all kept (already bounded) — dedupe on id.
    const seen = new Set(momentum.map((r) => r.id));
    const balanced = [
      ...momentum,
      ...(recent ?? []).filter((r) => !seen.has(r.id)),
    ];

    // View-count history for sparklines + LIVE climb rate (best-effort — the
    // table may not exist). risingVph = views gained between the two most
    // recent snapshots ÷ hours between them: unlike the lifetime
    // views_per_hour (frozen at ingest), it measures what's climbing NOW.
    const history = new Map<string, number[]>();
    // Capture times alongside the values so the topic detail chart can draw a
    // real date axis instead of unlabelled "refreshes".
    const historyAt = new Map<string, number[]>();
    const risingRates = new Map<string, number>();
    try {
      // Thousands of posts × ~10 snapshots each is far past PostgREST's
      // 1000-row response cap, and a 4000-id `.in()` overflows the request URL.
      // So: chunk the id list, and page each chunk. Getting this wrong doesn't
      // error — it silently returns a truncated history, which would draw
      // wrong sparklines rather than none.
      const pairs = new Map<string, { views: number; at: number }[]>();
      const ids = balanced.map((r) => r.id);
      // Chunks are independent, so they run concurrently — serially this was
      // ~10 round-trips for a 1000-post feed. Each chunk is sized so its whole
      // history comfortably fits one PAGE (100 posts × ~10 snapshots).
      const ID_CHUNK = 100;
      const chunks = Array.from(
        { length: Math.ceil(ids.length / ID_CHUNK) },
        (_, i) => ids.slice(i * ID_CHUNK, (i + 1) * ID_CHUNK),
      );
      const results = await Promise.all(
        chunks.map((chunk) =>
          supabase
            .from("trend_snapshots")
            .select("post_id, views, captured_at")
            .in("post_id", chunk)
            .order("captured_at", { ascending: true })
            .range(0, PAGE - 1),
        ),
      );
      for (const { data: snaps } of results) {
        for (const s of snaps ?? []) {
          const list = pairs.get(s.post_id) ?? [];
          list.push({ views: s.views, at: Date.parse(s.captured_at) });
          pairs.set(s.post_id, list);
        }
      }
      const staleCutoff = Date.now() - 48 * 3_600_000;
      for (const [id, list] of pairs) {
        history.set(
          id,
          list.map((p) => p.views),
        );
        historyAt.set(
          id,
          list.map((p) => p.at),
        );
        if (list.length < 2) continue;
        const prev = list[list.length - 2];
        const last = list[list.length - 1];
        // Only trust a rate measured recently, over a sane interval.
        if (last.at < staleCutoff) continue;
        const hours = Math.max((last.at - prev.at) / 3_600_000, 0.5);
        risingRates.set(
          id,
          Math.max(0, Math.round((last.views - prev.views) / hours)),
        );
      }
    } catch {
      // sparklines don't render; Rising falls back to the lifetime rate
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
        views: r.views,
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
        historyAt: (historyAt.get(r.id) ?? []).slice(-10),
        risingVph: risingRates.get(r.id) ?? null,
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
const INSPIRATION_PER_NICHE = 250;
const INSPIRATION_FETCH_LIMIT = 5000;

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
    // PostgREST caps a single response at 1000 rows no matter the .limit(),
    // so page with .range() until the library (or FETCH_LIMIT) is exhausted.
    const data: FeedRow[] = [];
    for (let from = 0; from < INSPIRATION_FETCH_LIMIT; from += 1000) {
      const { data: page, error } = (await supabase
        .from("inspiration_posts")
        .select(
          "id, niche, title, author, cover_url, slide_count, views, views_per_hour, likes, posted_at, tiktok_url, fetched_at, why_it_works, hook_type, anatomy, medium",
        )
        .gte("posted_at", since)
        .order("views", { ascending: false })
        .range(from, from + 999)) as {
        data: FeedRow[] | null;
        error: { message: string } | null;
      };
      if (error || !page) break;
      data.push(...page);
      if (page.length < 1000) break;
    }
    if (data.length === 0) return empty;

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
        // `niche` must stay a valid BUSINESS_TYPES key (gradients); the row's
        // REAL niche — the library is open-ended — travels as nicheLabel.
        niche: (BUSINESS_TYPES as readonly string[]).includes(r.niche)
          ? (r.niche as BusinessType)
          : BUSINESS_TYPES[0],
        nicheLabel: r.niche,
        medium: r.medium ?? null,
        cover: r.cover_url ?? "",
        slideCount: r.slide_count,
        views: r.views,
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
