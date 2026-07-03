import Link from "next/link";
import { createClient } from "@/utils/supabase/server";

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

function Card({ item }: { item: Item }) {
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
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={item.thumb}
            alt={item.title}
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
          />
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
        <p className="truncate text-xs font-semibold text-white">{item.title}</p>
        <p className="mt-0.5 truncate text-[11px] text-[#444]">
          {[item.niche, `${item.slideCount} slides`, relativeTime(item.createdAt)]
            .filter(Boolean)
            .join(" · ")}
        </p>
      </div>
    </Link>
  );
}

export default async function SlideshowsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return (
      <div className="mx-auto max-w-5xl px-5 py-10 sm:px-8">
        <h1 className="text-xl font-bold tracking-tight text-white">My Slideshows</h1>
        <div className="mt-10 flex flex-col items-center justify-center rounded-2xl border border-white/8 bg-white/2 px-6 py-20 text-center">
          <p className="text-4xl mb-4" aria-hidden>{"🔒"}</p>
          <p className="text-base font-semibold text-white">Sign in to view your slideshows</p>
          <p className="mx-auto mt-2 max-w-sm text-sm text-[#444]">
            Generated slideshows are saved to your account.
          </p>
          <Link
            href="/login"
            className="mt-6 rounded-full bg-white px-5 py-2.5 text-sm font-semibold text-black transition-opacity hover:opacity-90"
          >
            Log in
          </Link>
        </div>
      </div>
    );
  }

  // Latest post per slideshow (posts ordered newest-first, first seen wins).
  const { data: postData } = await supabase
    .from("tiktok_posts")
    .select("id, slideshow_id, status, privacy_level, created_at")
    .order("created_at", { ascending: false });
  const latestPost = new Map<string, PostRow>();
  for (const p of (postData ?? []) as PostRow[]) {
    if (!latestPost.has(p.slideshow_id)) latestPost.set(p.slideshow_id, p);
  }
  const postedIds = [...latestPost.keys()];

  // Show saved slideshows plus any that have been posted (even if not "saved").
  const base = supabase
    .from("slideshows")
    .select("id, title, niche, slide_count, created_at, slides(position, storage_path)")
    .order("created_at", { ascending: false });
  const { data } = postedIds.length
    ? await base.or(`status.eq.saved,id.in.(${postedIds.join(",")})`)
    : await base.eq("status", "saved");
  const shows = (data ?? []) as ShowRow[];

  const items: Item[] = shows.map((s) => {
    const first = [...(s.slides ?? [])].sort((a, b) => a.position - b.position)[0];
      // Baked on demand from the clean bg + live caption (never a stored bake).
      const thumb = first ? `/api/slideshows/${s.id}/render/${first.position}` : "";
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

  const posted = items.filter((i) => i.post);
  const notPosted = items.filter((i) => !i.post);

  return (
    <div className="mx-auto max-w-5xl px-5 py-10 sm:px-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-white">My Slideshows</h1>
          <p className="mt-0.5 text-sm text-[#444]">
            {items.length} {items.length === 1 ? "slideshow" : "slideshows"} · {posted.length} posted
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
          <p className="mx-auto mt-2 max-w-sm text-sm text-[#444]">
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
          {/* ── Posted to TikTok ─────────────────────────────────── */}
          <section className="mt-9">
            <h2 className="text-[11px] font-semibold uppercase tracking-widest text-white/30">
              Posted to TikTok
            </h2>
            {posted.length === 0 ? (
              <div className="mt-3 rounded-2xl border border-white/8 bg-white/2 px-6 py-10 text-center text-sm text-[#555]">
                Nothing posted to TikTok yet — open a slideshow and hit{" "}
                <span className="text-white/60">Post to TikTok</span>.
              </div>
            ) : (
              <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                {posted.map((item) => (
                  <Card key={item.id} item={item} />
                ))}
              </div>
            )}
          </section>

          {/* ── Not posted yet ───────────────────────────────────── */}
          {notPosted.length > 0 && (
            <section className="mt-9">
              <h2 className="text-[11px] font-semibold uppercase tracking-widest text-white/30">
                Not posted yet
              </h2>
              <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                {notPosted.map((item) => (
                  <Card key={item.id} item={item} />
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
