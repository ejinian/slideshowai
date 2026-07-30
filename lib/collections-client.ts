import { createClient } from "@/utils/supabase/client";

/* Browser-side collection uploads.

   Bytes go straight from the browser to the private `collections` bucket with
   the user's own session (storage RLS scopes writes to `${userId}/…`), and only
   the resulting paths are POSTed to our API. Routing the files through a Next
   route instead would cap a bulk drop at Vercel's ~4.5MB body limit — which is
   exactly the ceiling the old per-generation attach kept hitting.

   Stored a little larger than the old 1280px composer downscale: these are
   kept and reused across many decks, so there's headroom for reframing, while
   still being far smaller than a raw phone photo. */
const MAX_EDGE = 1600;
const QUALITY = 0.85;

export interface PreparedImage {
  blob: Blob;
  width: number;
  height: number;
  name: string;
}

export interface UploadedImage {
  id: string;
  url: string;
  name: string;
  width: number | null;
  height: number | null;
}

/** Decode, downscale and re-encode to JPEG. Resolves null if unreadable. */
export function downscaleToBlob(file: File): Promise<PreparedImage | null> {
  return new Promise((resolve) => {
    const objectUrl = URL.createObjectURL(file);
    const img = new Image();
    const done = (v: PreparedImage | null) => {
      URL.revokeObjectURL(objectUrl);
      resolve(v);
    };
    // HEIC and corrupt files can't be decoded by the canvas — skip rather than
    // uploading something the generator can't read later.
    img.onerror = () => done(null);
    img.onload = () => {
      let { width, height } = img;
      if (!width || !height) return done(null);
      const longest = Math.max(width, height);
      if (longest > MAX_EDGE) {
        const scale = MAX_EDGE / longest;
        width = Math.round(width * scale);
        height = Math.round(height * scale);
      }
      try {
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) return done(null);
        ctx.drawImage(img, 0, 0, width, height);
        canvas.toBlob(
          (blob) =>
            done(blob ? { blob, width, height, name: file.name } : null),
          "image/jpeg",
          QUALITY,
        );
      } catch {
        done(null);
      }
    };
    img.src = objectUrl;
  });
}

/**
 * Upload files into a collection, reporting progress per finished file.
 * Individual failures are skipped, not thrown — one unreadable photo in a
 * 50-file drop must not lose the other 49.
 */
export async function uploadToCollection(
  collectionId: string,
  files: File[],
  onProgress?: (done: number, total: number) => void,
): Promise<{ images: UploadedImage[]; failed: number }> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("You need to be signed in to upload.");

  const images = files.filter((f) => f.type.startsWith("image/"));
  const total = images.length;
  let done = 0;
  let failed = 0;
  const uploaded: {
    storagePath: string;
    name: string;
    width: number;
    height: number;
  }[] = [];

  // Small concurrency: enough to keep the pipe busy on a bulk drop, low enough
  // not to stall a phone on 50 simultaneous encodes + uploads.
  const CONCURRENCY = 4;
  const queue = [...images];
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, queue.length) }, () =>
      (async () => {
        for (;;) {
          const file = queue.shift();
          if (!file) return;
          try {
            const prepared = await downscaleToBlob(file);
            if (!prepared) {
              failed++;
              continue;
            }
            const path = `${user.id}/${collectionId}/${crypto.randomUUID()}.jpg`;
            const { error } = await supabase.storage
              .from("collections")
              .upload(path, prepared.blob, {
                contentType: "image/jpeg",
                upsert: false,
              });
            if (error) {
              failed++;
              continue;
            }
            uploaded.push({
              storagePath: path,
              name: prepared.name,
              width: prepared.width,
              height: prepared.height,
            });
          } catch {
            failed++;
          } finally {
            done++;
            onProgress?.(done, total);
          }
        }
      })(),
    ),
  );

  if (uploaded.length === 0) return { images: [], failed };

  // Register the paths in one small request.
  const res = await fetch(`/api/collections/${collectionId}/images`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ images: uploaded }),
  });
  const data = (await res.json()) as { images?: UploadedImage[]; error?: string };
  if (!res.ok) throw new Error(data.error || "Could not save those photos.");
  return { images: data.images ?? [], failed };
}
