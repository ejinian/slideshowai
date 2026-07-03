import Link from "next/link";
import { createClient } from "@/utils/supabase/server";

// Signed URLs are short-lived + user-scoped -> always render fresh.
export const dynamic = "force-dynamic";

interface SlideRow {
  position: number;
  storage_path: string | null;
}
interface PostRow {
  id: string;
  caption: string | null;
  privacy_level: string | null;
  status: string | null;
  fail_reason: string | null;
  cover_index: number | null;
  created_at: string;
  slideshow: { id: string; title: string | null; slides: SlideRow[] } | null;
}

const STATUS_META: Record<string, { label: string; cls: string }> = {
  PUBLISH_COMPLETE: { label: "Posted", cls: "bg-emerald-500/15 text-emerald-300" },
  PROCESSING_DOWNLOAD: { label: "Processing", cls: "bg-amber-500/15 text-amber-300" },
  FAILED: { label: "Failed", cls: "bg-red-500/15 text-red-300" },
};
const PRIVACY_LABEL: Record<string, string> = {
  SELF_ONLY: "Private",
  PUBLIC_TO_EVERYONE: "Public",
  MUTUAL_FOLLOW_FRIENDS: "Friends",
  FOLLOWER_OF_CREATOR: "Followers",
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

export default async function PostsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return (
      <div className="mx-auto max-w-5xl px-5 py-10 sm:px-8">
        <h1 className="text-xl font-bold tracking-tight text-white">My Posts</h1>
        <div className="mt-10 flex flex-col items-center justify-center rounded-2xl border border-white/8 bg-white/2 px-6 py-20 text-center">
          <p className="text-4xl mb-4" aria-hidden>{"🔒"}</p>
          <p className="text-base font-semibold text-white">Sign in to view your posts</p>
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

  const { data } = await supabase
    .from("tiktok_posts")
    .select(
      "id, caption, privacy_level, status, fail_reason, cover_index, created_at, slideshow:slideshows(id, title, slides(position, storage_path))",
    )
    .order("created_at", { ascending: false });
  const posts = (data ?? []) as unknown as PostRow[];

  const items = await Promise.all(
    posts.map(async (p) => {
      const slides = [...(p.slideshow?.slides ?? [])].sort((a, b) => a.position - b.position);
      const cover = slides.find((s) => s.position === (p.cover_index ?? 0)) ?? slides[0];
      let thumb = "";
      if (cover?.storage_path) {
        const { data: sig } = await supabase.storage
          .from("slideshows")
          .createSignedUrl(cover.storage_path, 3600);
        thumb = sig?.signedUrl ?? "";
      }
      return {
        id: p.id,
        caption: p.caption?.trim() || p.slideshow?.title || "Untitled post",
        status: p.status ?? "PROCESSING_DOWNLOAD",
        privacy: PRIVACY_LABEL[p.privacy_level ?? ""] ?? p.privacy_level ?? "",
        createdAt: p.created_at,
        thumb,
      };
    }),
  );

  return (
    <div className="mx-auto max-w-5xl px-5 py-10 sm:px-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-white">My Posts</h1>
          <p className="mt-0.5 text-sm text-[#444]">
            {items.length} {items.length === 1 ? "post" : "posts"} to TikTok
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
          <p className="text-4xl mb-4" aria-hidden>{"📮"}</p>
          <p className="text-base font-semibold text-white">No posts yet</p>
          <p className="mx-auto mt-2 max-w-sm text-sm text-[#444]">
            Post a slideshow to TikTok and it&apos;ll show up here.
          </p>
          <Link
            href="/dashboard/slideshows"
            className="mt-6 rounded-full bg-white px-5 py-2.5 text-sm font-semibold text-black transition-opacity hover:opacity-90"
          >
            Go to my slideshows
          </Link>
        </div>
      ) : (
        <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {items.map((p) => {
            const meta = STATUS_META[p.status] ?? STATUS_META.PROCESSING_DOWNLOAD;
            return (
              <Link
                key={p.id}
                href={`/dashboard/posts/${p.id}`}
                className="group overflow-hidden rounded-2xl border border-white/8 bg-white/2 transition-all hover:border-white/20 hover:bg-white/4"
              >
                <div className="relative aspect-9/16 w-full overflow-hidden bg-[#111]">
                  {p.thumb ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={p.thumb}
                      alt={p.caption}
                      className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                    />
                  ) : null}
                  <span
                    className={`absolute left-2 top-2 rounded-full px-2 py-0.5 text-[10px] font-semibold backdrop-blur-sm ${meta.cls}`}
                  >
                    {meta.label}
                  </span>
                </div>
                <div className="p-3">
                  <p className="line-clamp-2 text-xs font-semibold text-white">{p.caption}</p>
                  <p className="mt-0.5 truncate text-[11px] text-[#444]">
                    {[p.privacy, relativeTime(p.createdAt)].filter(Boolean).join(" · ")}
                  </p>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
