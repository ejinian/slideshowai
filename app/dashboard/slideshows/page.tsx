import Link from "next/link";
import { createClient, getCachedUser } from "@/utils/supabase/server";
import FadeThumb from "@/components/dashboard/FadeThumb";

// User-specific + short-lived signed URLs -> always render fresh.
export const dynamic = "force-dynamic";

interface SlideRow {
  position: number;
  storage_path: string | null;
}
interface ShowRow {
  id: string;
  title: string | null;
  niche: string | null;
  slide_count: number | null;
  created_at: string;
  updated_at: string | null;
  slides: SlideRow[];
}
interface PostRow {
  id: string;
  slideshow_id: string;
  status: string | null;
  privacy_level: string | null;
  created_at: string;
}

const STATUS_META: Record<string, { label: string; cls: string }> = {
  PUBLISH_COMPLETE: { label: "Posted", cls: "bg-emerald-500/15 text-emerald-300" },
  PROCESSING_DOWNLOAD: { label: "Processing", cls: "bg-amber-500/15 text-amber-300" },
  FAILED: { label: "Failed", cls: "bg-red-500/15 text-red-300" },
};

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}

interface Item {
  id: string;
  title: string;
  niche: string | null;
  slideCount: number;
  createdAt: string;
  thumb: string;
  post: PostRow | null;
}

function Card({ item, eager }: { item: Item; eager: boolean }) {
  const meta = item.post ? STATUS_META[item.post.status ?? ""] ?? STATUS_META.PROCESSING_DOWNLOAD : null;
  // Posted → open the TikTok-style post view; otherwise → slideshow detail (to post/edit).
  const href = item.post ? `/dashboard/posts/${item.post.id}` : `/dashboard/slideshows/${item.id}`;
  return (
    <Link
      href={href}
      className="group overflow-hidden rounded-2xl border border-white/8 bg-white/2 transition-all hover:border-white/20 hover:bg-white/4"
    >
      <div className="relative aspect-9/16 w-full overflow-hidden bg-[#111]">
        {item.thumb ? (
          <FadeThumb src={item.thumb} alt={item.title} eager={eager} />
        ) : null}
        {meta ? (
          <span
            className={`absolute left-2 top-2 rounded-full px-2 py-0.5 text-[10px] font-semibold backdrop-blur-sm ${meta.cls}`}
          >
            {meta.label}
          </span>
        ) : null}
      </div>
      <div className="p-3">
        {/* Two lines, not truncate: at 375px these cards are 161px wide, so a
            one-line title showed about half of it. */}
        <p className="line-clamp-2 text-xs font-semibold text-white">{item.title}</p>
        {/* Only the niche is allowed to truncate. Joining all three into one
            truncated string meant the age — the part you actually scan for —
            was the first thing cut ("Real Estate · 6 slides · 5…"). */}
        <p className="mt-0.5 flex items-center gap-1 text-[11px] text-white/45">
          {/* Niche only once the card is wide enough to hold it. At 161px it
              truncated to "Real …", which is noise, not information. */}
          {item.niche ? (
            <span className="hidden min-w-0 lg:contents">
              <span className="truncate">{item.niche}</span>
              <span aria-hidden className="shrink-0">·</span>
            </span>
          ) : null}
          <span className="shrink-0">{item.slideCount} slides</span>
          <span aria-hidden className="shrink-0">·</span>
          <span className="shrink-0">{relativeTime(item.createdAt)}</span>
        </p>
      </div>
    </Link>
  );
}

// Every card's thumbnail hits /api/slideshows/[id]/render/[pos], which BAKES the
// image on demand (pull the bg from Storage → resvg the caption → JPEG). That is
// the real cost of this page: 50 saved decks meant 50 concurrent server-side
// composites and ~8s of loading. Capping the page at 12 caps the bakes.
// 12 divides evenly into the 2 / 3 / 4 column grid below.
const PAGE_SIZE = 12;

export default async function SlideshowsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const supabase = await createClient();
  const user = await getCachedUser();
  const pageParam = Number((await searchParams).page);
  const page = Number.isFinite(pageParam) && pageParam > 1 ? Math.floor(pageParam) : 1;

  if (!user) {
    return (
      <div className="mx-auto w-full min-w-0 max-w-5xl px-5 py-10 sm:px-8">
        <h1 className="text-xl font-bold tracking-tight text-white">My Slideshows</h1>
        <div className="mt-10 flex flex-col items-center justify-center rounded-2xl border border-white/8 bg-white/2 px-6 py-20 text-center">
          <p className="text-4xl mb-4" aria-hidden>{"🔒"}</p>
          <p className="text-base font-semibold text-white">Sign in to view your slideshows</p>
          <p className="mx-auto mt-2 max-w-sm text-sm text-white/45">
            Generated slideshows are saved to your account.
          </p>
          <Link
            href="/?auth=login"
            className="mt-6 rounded-full bg-white px-5 py-2.5 text-sm font-semibold text-black transition-opacity hover:opacity-90"
          >
            Log in
          </Link>
        </div>
      </div>
    );
  }

  const SHOW_COLS =
    "id, title, niche, slide_count, created_at, updated_at, slides(position, storage_path)";

  // These two used to run back-to-back — the slideshows query waited on
  // postedIds from the posts query, costing two serial round-trips. They're
  // independent, so fire both at once and reconcile after.
  //
  // The deck query is now paged at the DATABASE (range + exact count) rather
  // than fetched whole and sliced here — the point is to stop the page from
  // rendering 50 thumbnails, and that only works if 50 rows never arrive.
  // `tiktok_posts` stays unpaged: it's a handful of rows and it drives both the
  // per-card badge and the "N posted" total.
  const from = (page - 1) * PAGE_SIZE;
  const [{ data: postData }, { data: savedData, count }] = await Promise.all([
    supabase
      .from("tiktok_posts")
      .select("id, slideshow_id, status, privacy_level, created_at")
      .order("created_at", { ascending: false }),
    supabase
      .from("slideshows")
      .select(SHOW_COLS, { count: "exact" })
      .eq("status", "saved")
      .order("created_at", { ascending: false })
      .range(from, from + PAGE_SIZE - 1),
  ]);

  // Latest post per slideshow (posts ordered newest-first, first seen wins).
  const latestPost = new Map<string, PostRow>();
  for (const p of (postData ?? []) as PostRow[]) {
    if (!latestPost.has(p.slideshow_id)) latestPost.set(p.slideshow_id, p);
  }

  // NOTE: this used to backfill decks that were posted but not `status:'saved'`.
  // That can't coexist with DB-level paging (it needs the full ordered set), and
  // it was already near-dead code — /api/generate writes every deck as 'saved',
  // so a posted deck is a saved deck by construction.
  const shows = (savedData ?? []) as ShowRow[];
  const total = count ?? shows.length;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const postedTotal = new Set(
    ((postData ?? []) as PostRow[]).map((p) => p.slideshow_id),
  ).size;

  const items: Item[] = shows.map((s) => {
    const first = [...(s.slides ?? [])].sort((a, b) => a.position - b.position)[0];
      // Baked on demand from the clean bg + live caption (never a stored bake).
      // updated_at versions the URL so edits (position/caption) bust the
      // browser's image cache the moment this page re-renders — and lets the
      // render route mark the response immutable, so revisits don't re-bake.
      // w=540 is 2x the widest a hub card gets (~250px): a fraction of the
      // bytes and encode time of the full 1080x1920 bake.
      const v = s.updated_at ? `&v=${encodeURIComponent(s.updated_at)}` : "";
      const thumb = first
        ? `/api/slideshows/${s.id}/render/${first.position}?w=540${v}`
        : "";
      return {
        id: s.id,
        title: s.title ?? "Untitled slideshow",
        niche: s.niche,
        slideCount: s.slide_count ?? s.slides?.length ?? 0,
        createdAt: s.created_at,
        thumb,
        post: latestPost.get(s.id) ?? null,
      };
  });

  // One chronological grid, newest first. The old Posted / Not-posted split
  // can't survive paging (page 2 would show an empty "Posted" heading), and the
  // per-card status badge already carries that information.
  const pageHref = (p: number) => (p <= 1 ? "/dashboard/slideshows" : `/dashboard/slideshows?page=${p}`);

  return (
    <div className="mx-auto w-full min-w-0 max-w-5xl px-5 py-10 sm:px-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-white">My Slideshows</h1>
          <p className="mt-0.5 text-sm text-white/45">
            {total} {total === 1 ? "slideshow" : "slideshows"} · {postedTotal} posted
            {pageCount > 1 ? ` · page ${page} of ${pageCount}` : ""}
          </p>
        </div>
        <Link
          href="/dashboard"
          className="rounded-full bg-white px-4 py-2 text-xs font-semibold text-black transition-opacity hover:opacity-90"
        >
          + New slideshow
        </Link>
      </div>

      {items.length === 0 ? (
        <div className="mt-10 flex flex-col items-center justify-center rounded-2xl border border-white/8 bg-white/2 px-6 py-20 text-center">
          <p className="text-4xl mb-4" aria-hidden>{"🎞️"}</p>
          <p className="text-base font-semibold text-white">No saved slideshows yet</p>
          <p className="mx-auto mt-2 max-w-sm text-sm text-white/45">
            Generate a slideshow and hit &quot;Save to library&quot; to keep it here.
          </p>
          <Link
            href="/dashboard"
            className="mt-6 rounded-full bg-white px-5 py-2.5 text-sm font-semibold text-black transition-opacity hover:opacity-90"
          >
            Create your first slideshow
          </Link>
        </div>
      ) : (
        <>
          <div className="mt-9 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {/* First row (4 cards at the widest grid) loads eagerly; the rest
                lazy-load as they scroll in, so the visible cards get the
                bandwidth and bake slots first. */}
            {items.map((item, i) => (
              <Card key={item.id} item={item} eager={i < 4} />
            ))}
          </div>

          {pageCount > 1 && (
            <nav
              aria-label="Pagination"
              className="mt-8 flex items-center justify-center gap-2"
            >
              {page > 1 ? (
                <Link
                  href={pageHref(page - 1)}
                  rel="prev"
                  className="rounded-full bg-[#1c1c1e] px-4 py-2 text-sm font-semibold text-white ring-1 ring-white/10 transition-colors hover:bg-[#26262a]"
                >
                  Previous
                </Link>
              ) : (
                <span className="cursor-not-allowed rounded-full px-4 py-2 text-sm font-semibold text-white/25">
                  Previous
                </span>
              )}
              <span className="px-3 text-sm text-white/50">
                {page} / {pageCount}
              </span>
              {page < pageCount ? (
                <Link
                  href={pageHref(page + 1)}
                  rel="next"
                  className="rounded-full bg-[#1c1c1e] px-4 py-2 text-sm font-semibold text-white ring-1 ring-white/10 transition-colors hover:bg-[#26262a]"
                >
                  Next
                </Link>
              ) : (
                <span className="cursor-not-allowed rounded-full px-4 py-2 text-sm font-semibold text-white/25">
                  Next
                </span>
              )}
            </nav>
          )}
        </>
      )}
    </div>
  );
}
