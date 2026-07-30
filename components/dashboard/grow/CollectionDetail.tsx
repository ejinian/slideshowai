"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Skeleton } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import {
  uploadToCollection,
  type UploadedImage,
} from "@/lib/collections-client";
import { GENERATOR_PICK_KEY } from "@/lib/collections-selection";

const GRID =
  "grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6";

interface Meta {
  id: string;
  name: string;
  isProductImages: boolean;
}

async function fetchCollection(id: string): Promise<{
  collection: Meta | null;
  images: UploadedImage[];
  error: string;
}> {
  try {
    const res = await fetch(`/api/collections/${id}`);
    const data = (await res.json()) as {
      collection?: Meta;
      images?: UploadedImage[];
      error?: string;
    };
    if (!res.ok || !data.collection) {
      throw new Error(data.error || "Could not load that collection.");
    }
    return { collection: data.collection, images: data.images ?? [], error: "" };
  } catch (e) {
    return {
      collection: null,
      images: [],
      error: e instanceof Error ? e.message : "Could not load that collection.",
    };
  }
}

export function CollectionDetail({ id }: { id: string }) {
  const router = useRouter();
  const [meta, setMeta] = useState<Meta | null>(null);
  const [images, setImages] = useState<UploadedImage[] | null>(null);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [dragging, setDragging] = useState(false);
  const [upload, setUpload] = useState<{ done: number; total: number } | null>(
    null,
  );
  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  // State is set inside the async continuation, never synchronously in the
  // effect body — the React Compiler rejects the latter as a cascading render.
  const apply = useCallback((r: Awaited<ReturnType<typeof fetchCollection>>) => {
    if (r.error) setError(r.error);
    if (r.collection) {
      setMeta(r.collection);
      setNameDraft(r.collection.name);
    }
    setImages(r.images);
  }, []);

  const reload = useCallback(
    () => fetchCollection(id).then(apply),
    [id, apply],
  );

  useEffect(() => {
    let cancelled = false;
    void fetchCollection(id).then((r) => {
      if (!cancelled) apply(r);
    });
    return () => {
      cancelled = true;
    };
  }, [id, apply]);

  const addFiles = useCallback(
    async (files: FileList | File[] | null) => {
      const list = Array.from(files ?? []).filter((f) =>
        f.type.startsWith("image/"),
      );
      if (list.length === 0) return;
      setError("");
      setUpload({ done: 0, total: list.length });
      try {
        const { images: added, failed } = await uploadToCollection(
          id,
          list,
          (done, total) => setUpload({ done, total }),
        );
        if (added.length > 0) setImages((cur) => [...(cur ?? []), ...added]);
        if (failed > 0) {
          setError(
            `${failed} photo${failed === 1 ? "" : "s"} couldn't be read and ${
              failed === 1 ? "was" : "were"
            } skipped — HEIC files need converting first.`,
          );
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Upload failed.");
      } finally {
        setUpload(null);
      }
    },
    [id],
  );

  const toggle = (imageId: string) =>
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(imageId)) next.delete(imageId);
      else next.add(imageId);
      return next;
    });

  const removeSelected = async () => {
    const ids = [...selected];
    if (ids.length === 0) return;
    setError("");
    // Optimistic — the row is the source of truth, so a failure just re-loads.
    setImages((cur) => (cur ?? []).filter((i) => !selected.has(i.id)));
    setSelected(new Set());
    try {
      const res = await fetch(`/api/collections/${id}/images`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageIds: ids }),
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error || "Could not remove those photos.");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not remove those photos.");
      void reload();
    }
  };

  const useInGenerator = () => {
    const picked = (images ?? []).filter((i) => selected.has(i.id));
    if (picked.length === 0) return;
    try {
      sessionStorage.setItem(
        GENERATOR_PICK_KEY,
        JSON.stringify({
          collectionId: id,
          collectionName: meta?.name ?? "",
          imageIds: picked.map((i) => i.id),
          // Carry the signed thumbs so the composer can show the picks
          // immediately instead of re-signing every URL on arrival.
          thumbs: picked.map((i) => i.url),
        }),
      );
    } catch {}
    router.push("/dashboard");
  };

  const saveName = async () => {
    const next = nameDraft.trim();
    setRenaming(false);
    if (!next || !meta || next === meta.name) {
      setNameDraft(meta?.name ?? "");
      return;
    }
    setMeta({ ...meta, name: next });
    await fetch(`/api/collections/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: next }),
    });
  };

  const deleteCollection = async () => {
    if (!confirm("Delete this collection and all of its photos?")) return;
    await fetch(`/api/collections/${id}`, { method: "DELETE" });
    router.push("/dashboard/collections");
  };

  const count = images?.length ?? 0;

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => {
        // Only clear when the pointer leaves the drop surface itself — not
        // when it crosses onto a child element.
        if (e.currentTarget.contains(e.relatedTarget as Node)) return;
        setDragging(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        void addFiles(e.dataTransfer.files);
      }}
      className={`relative -m-3 rounded-2xl p-3 transition-colors ${
        dragging ? "bg-accent/[0.06] ring-2 ring-accent/40" : ""
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <Link
            href="/dashboard/collections"
            className="text-xs font-semibold text-white/40 transition-colors hover:text-white"
          >
            ← Collections
          </Link>
          {renaming ? (
            <input
              autoFocus
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              onBlur={() => void saveName()}
              onKeyDown={(e) => {
                if (e.key === "Enter") void saveName();
                if (e.key === "Escape") {
                  setNameDraft(meta?.name ?? "");
                  setRenaming(false);
                }
              }}
              maxLength={80}
              className="mt-1 w-full max-w-md rounded-lg bg-white/[0.06] px-2 py-1 text-2xl font-bold tracking-tight text-white outline-none"
            />
          ) : (
            <h1
              onClick={() => meta && setRenaming(true)}
              title="Click to rename"
              className="mt-1 cursor-text truncate text-2xl font-bold tracking-tight text-white"
            >
              {meta?.name ?? "…"}
            </h1>
          )}
          <p className="mt-0.5 text-sm text-white/40">
            {count} photo{count === 1 ? "" : "s"} · drop images anywhere to add
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="rounded-full bg-accent px-5 py-2.5 text-sm font-bold text-white shadow-lg shadow-accent/30 transition-all hover:brightness-110 active:scale-[0.98]"
          >
            Add photos
          </button>
          <button
            type="button"
            onClick={() => void deleteCollection()}
            aria-label="Delete collection"
            className="grid h-10 w-10 place-items-center rounded-full border border-white/[0.08] text-white/40 transition-colors hover:border-red-500/40 hover:text-red-400"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" />
            </svg>
          </button>
        </div>
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          void addFiles(e.target.files);
          e.target.value = "";
        }}
      />

      {upload && (
        <div className="mt-4">
          <div className="flex items-center justify-between text-xs font-medium text-white/50">
            <span>
              Uploading {upload.done} of {upload.total}…
            </span>
            <span>{Math.round((upload.done / upload.total) * 100)}%</span>
          </div>
          <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-white/10">
            <div
              className="h-full rounded-full bg-accent transition-all duration-300"
              style={{ width: `${(upload.done / upload.total) * 100}%` }}
            />
          </div>
        </div>
      )}

      {error && (
        <div className="mt-4 rounded-xl border border-red-500/20 bg-red-500/6 px-4 py-3 text-sm text-red-400">
          {error}
        </div>
      )}

      <div className="mt-6">
        {images === null ? (
          <div className={GRID}>
            {Array.from({ length: 12 }, (_, i) => (
              <Skeleton key={i} className="aspect-square w-full rounded-xl" />
            ))}
          </div>
        ) : images.length === 0 ? (
          <EmptyState
            title="Nothing in here yet"
            description="Drop a folder of photos anywhere on this page, or use Add photos. They stay here for every future slideshow."
            action={
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="rounded-full bg-accent px-5 py-2.5 text-sm font-bold text-white shadow-lg shadow-accent/30 transition-all hover:brightness-110"
              >
                Add photos
              </button>
            }
          />
        ) : (
          <div className={GRID}>
            {images.map((img) => {
              const on = selected.has(img.id);
              return (
                <button
                  key={img.id}
                  type="button"
                  onClick={() => toggle(img.id)}
                  aria-pressed={on}
                  className={`group relative aspect-square overflow-hidden rounded-xl ring-1 transition-all ${
                    on ? "ring-2 ring-accent" : "ring-white/[0.08] hover:ring-white/25"
                  }`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={img.url}
                    alt={img.name}
                    loading="lazy"
                    decoding="async"
                    className={`h-full w-full object-cover transition-transform duration-300 ${
                      on ? "scale-95" : "group-hover:scale-105"
                    }`}
                  />
                  <span
                    className={`absolute left-1.5 top-1.5 grid h-5 w-5 place-items-center rounded-md border transition-all ${
                      on
                        ? "border-accent bg-accent text-white"
                        : "border-white/50 bg-black/40 text-transparent group-hover:border-white"
                    }`}
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                      <path d="M20 6L9 17l-5-5" />
                    </svg>
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Selection toolbar — sticky so it stays reachable down a long grid. */}
      {selected.size > 0 && (
        <div className="sticky bottom-4 z-20 mx-auto mt-6 flex w-fit flex-wrap items-center justify-center gap-2 rounded-full border border-white/[0.08] bg-[#1a1a1c]/95 px-3 py-2 shadow-2xl backdrop-blur-lg">
          <span className="px-2 text-sm font-semibold text-white">
            {selected.size} selected
          </span>
          <button
            type="button"
            onClick={useInGenerator}
            className="rounded-full bg-accent px-4 py-2 text-sm font-bold text-white transition-all hover:brightness-110"
          >
            Use in a slideshow
          </button>
          <button
            type="button"
            onClick={() => void removeSelected()}
            className="rounded-full px-3 py-2 text-sm font-semibold text-red-400 transition-colors hover:bg-red-500/10"
          >
            Remove
          </button>
          <button
            type="button"
            onClick={() => setSelected(new Set())}
            className="rounded-full px-3 py-2 text-sm font-semibold text-white/50 transition-colors hover:text-white"
          >
            Clear
          </button>
        </div>
      )}
    </div>
  );
}
