import type { SupabaseClient } from "@supabase/supabase-js";

// Library-backed background sampling. The `library_images` table (populated by
// scripts/ingest-library.mjs, stored in the public `library` bucket) holds up
// to ~1k stock photos per generator collection; we sample a random handful and
// download them for compositing. Returns [] when the collection has no rows
// yet — the caller falls back to the bundled local set.

const FETCH_CONCURRENCY = 8;

export async function fetchLibraryBackgrounds(
  supabase: SupabaseClient,
  collection: string,
  count: number,
): Promise<Buffer[]> {
  const { data, error } = await supabase
    .from("library_images")
    .select("url")
    .eq("collection", collection)
    .limit(1000);
  if (error || !data || data.length === 0) return [];

  // Fisher–Yates sample without replacement.
  const urls = data.map((r) => r.url as string);
  for (let i = urls.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [urls[i], urls[j]] = [urls[j], urls[i]];
  }
  const picked = urls.slice(0, Math.max(count, 1));

  const buffers: Buffer[] = [];
  const queue = [...picked];
  await Promise.all(
    Array.from({ length: FETCH_CONCURRENCY }, async () => {
      for (;;) {
        const url = queue.shift();
        if (!url) return;
        try {
          const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
          if (res.ok) buffers.push(Buffer.from(await res.arrayBuffer()));
        } catch {
          // skip this image; the sample is oversized enough to tolerate misses
        }
      }
    }),
  );
  return buffers;
}
