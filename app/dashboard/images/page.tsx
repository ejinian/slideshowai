import Link from "next/link";
import { createClient } from "@/utils/supabase/server";
import { COLLECTIONS } from "@/lib/generator-options";

// Browses the Storage-backed background library (library_images table,
// populated by scripts/ingest-library.mjs). Falls back to a hint when a
// collection has no rows yet.
export const metadata = { title: "Image Library — SlideLabsAI" };
export const dynamic = "force-dynamic";

const PAGE_SIZE = 60;

export default async function ImageLibraryPage({
  searchParams,
}: {
  searchParams: Promise<{ collection?: string; limit?: string }>;
}) {
  const { collection: cParam, limit: lParam } = await searchParams;
  const collection = COLLECTIONS.some((c) => c.id === cParam)
    ? (cParam as string)
    : COLLECTIONS[0].id;
  const limit = Math.min(parseInt(lParam ?? "", 10) || PAGE_SIZE, 400);

  const supabase = await createClient();
  const { data: images, count } = await supabase
    .from("library_images")
    .select("id, url, photographer, source_url", { count: "exact" })
    .eq("collection", collection)
    .order("id")
    .limit(limit);

  const total = count ?? 0;
  const shown = images?.length ?? 0;
  const activeName =
    COLLECTIONS.find((c) => c.id === collection)?.name ?? collection;

  return (
    <div className="mx-auto max-w-6xl px-5 py-10 sm:px-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
            Image Library
          </h1>
          <p className="mt-1 text-sm text-muted">
            {total > 0
              ? `${total} images · ${activeName} · sourced from Pexels`
              : `${activeName} isn't ingested yet — run scripts/ingest-library.mjs`}
          </p>
        </div>
      </div>

      {/* collection filter */}
      <div className="mt-6 flex flex-wrap items-center gap-2">
        {COLLECTIONS.map((c) => {
          const active = c.id === collection;
          return (
            <Link
              key={c.id}
              href={`/dashboard/images?collection=${c.id}`}
              className={`rounded-full px-4 py-1.5 text-sm font-semibold transition-colors ${
                active
                  ? "bg-white text-black"
                  : "bg-white/[0.06] text-white/60 hover:bg-white/[0.1] hover:text-white"
              }`}
            >
              {c.name}
            </Link>
          );
        })}
      </div>

      {/* masonry gallery */}
      <div className="mt-8 columns-2 gap-4 sm:columns-3 lg:columns-4">
        {(images ?? []).map((img) => (
          <a
            key={img.id}
            href={img.source_url || img.url}
            target="_blank"
            rel="noopener noreferrer"
            title={img.photographer ? `Photo: ${img.photographer} (Pexels)` : undefined}
            className="group mb-4 block break-inside-avoid overflow-hidden rounded-xl bg-white/[0.03]"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={img.url}
              alt={img.photographer ? `Photo by ${img.photographer}` : "Library image"}
              loading="lazy"
              decoding="async"
              className="w-full transition-transform duration-300 group-hover:scale-105"
            />
          </a>
        ))}
      </div>

      {shown < total && (
        <div className="mt-8 flex justify-center">
          <Link
            href={`/dashboard/images?collection=${collection}&limit=${limit + PAGE_SIZE}`}
            className="rounded-full bg-white/[0.08] px-6 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-white/[0.14]"
          >
            Show more ({total - shown} left)
          </Link>
        </div>
      )}
    </div>
  );
}
