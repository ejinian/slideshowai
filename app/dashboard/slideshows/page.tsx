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

  const { data } = await supabase
    .from("slideshows")
    .select("id, title, niche, slide_count, created_at, slides(position, storage_path)")
    .eq("status", "saved")
    .order("created_at", { ascending: false });
  const shows = (data ?? []) as ShowRow[];

  const items = await Promise.all(
    shows.map(async (s) => {
      const first = [...(s.slides ?? [])].sort(
        (a, b) => a.position - b.position,
      )[0];
      let thumb = "";
      if (first?.storage_path) {
        const { data: sig } = await supabase.storage
          .from("slideshows")
          .createSignedUrl(first.storage_path, 3600);
        thumb = sig?.signedUrl ?? "";
      }
      return {
        id: s.id,
        title: s.title ?? "Untitled slideshow",
        niche: s.niche,
        slideCount: s.slide_count ?? s.slides?.length ?? 0,
        createdAt: s.created_at,
        thumb,
      };
    }),
  );

  return (
    <div className="mx-auto max-w-5xl px-5 py-10 sm:px-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-white">My Slideshows</h1>
          <p className="mt-0.5 text-sm text-[#444]">
            {items.length} saved {items.length === 1 ? "slideshow" : "slideshows"}
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
        <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {items.map((s) => (
            <Link
              key={s.id}
              href={`/dashboard/slideshows/${s.id}`}
              className="group overflow-hidden rounded-2xl border border-white/8 bg-white/2 transition-all hover:border-white/20 hover:bg-white/4"
            >
              <div className="aspect-9/16 w-full overflow-hidden bg-[#111]">
                {s.thumb ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={s.thumb}
                    alt={s.title}
                    className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                  />
                ) : null}
              </div>
              <div className="p-3">
                <p className="truncate text-xs font-semibold text-white">{s.title}</p>
                <p className="mt-0.5 truncate text-[11px] text-[#444]">
                  {[s.niche, `${s.slideCount} slides`].filter(Boolean).join(" · ")}
                </p>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
