"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/ui/Modal";
import { Skeleton } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";

const GRID = "grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4";

export interface CollectionCard {
  id: string;
  name: string;
  isProductImages: boolean;
  imageCount: number;
  /** Up to four signed thumbnail URLs for the cover mosaic. */
  covers: string[];
  updatedAt: string;
}

async function fetchCollections(): Promise<{
  collections: CollectionCard[];
  error: string;
}> {
  try {
    const res = await fetch("/api/collections");
    const data = (await res.json()) as {
      collections?: CollectionCard[];
      error?: string;
    };
    if (!res.ok) throw new Error(data.error || "Could not load collections.");
    return { collections: data.collections ?? [], error: "" };
  } catch (e) {
    return {
      collections: [],
      error: e instanceof Error ? e.message : "Could not load collections.",
    };
  }
}

export function CollectionsGrid() {
  const [collections, setCollections] = useState<CollectionCard[] | null>(null);
  const [error, setError] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const router = useRouter();

  // Fetch is a pure module function and state is set after the await, inside
  // the async body — setState called synchronously from an effect body
  // cascades a render (the React Compiler lint rule rejects it).
  useEffect(() => {
    let cancelled = false;
    void fetchCollections().then((r) => {
      if (cancelled) return;
      if (r.error) setError(r.error);
      setCollections(r.collections);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const create = async () => {
    if (creating) return;
    setCreating(true);
    setError("");
    try {
      const res = await fetch("/api/collections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // An unnamed collection is fine — the server titles it, and you can
        // rename it in place on the detail page. Naming first is friction.
        body: JSON.stringify({ name: name.trim() }),
      });
      const data = (await res.json()) as {
        collection?: CollectionCard;
        error?: string;
      };
      if (!res.ok || !data.collection) {
        throw new Error(data.error || "Could not create that collection.");
      }
      setDialogOpen(false);
      setName("");
      // Straight into the new collection — the next thing you want is to add
      // photos, and that lives there.
      router.push(`/dashboard/collections/${data.collection.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create that collection.");
    } finally {
      setCreating(false);
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-white/40">
          {collections === null
            ? " "
            : `${collections.length} collection${collections.length === 1 ? "" : "s"}`}
        </p>
        <button
          type="button"
          onClick={() => setDialogOpen(true)}
          className="inline-flex shrink-0 items-center gap-2 rounded-full bg-accent px-5 py-2.5 text-sm font-bold text-white shadow-lg shadow-accent/30 transition-all hover:brightness-110 active:scale-[0.98]"
        >
          <span aria-hidden className="text-base leading-none">+</span>
          New collection
        </button>
      </div>

      {error && (
        <div className="mt-4 rounded-xl border border-red-500/20 bg-red-500/6 px-4 py-3 text-sm text-red-400">
          {error}
        </div>
      )}

      <div className="mt-5">
        {collections === null ? (
          <div className={GRID}>
            {Array.from({ length: 4 }, (_, i) => (
              <div key={i} className="space-y-2">
                <Skeleton className="aspect-4/3 w-full rounded-2xl" />
                <Skeleton className="h-3 w-1/2" />
              </div>
            ))}
          </div>
        ) : collections.length === 0 ? (
          <EmptyState
            title="No collections yet"
            description="A collection is your own photo library — upload once, then pick from it every time you generate."
            action={
              <button
                type="button"
                onClick={() => setDialogOpen(true)}
                className="rounded-full bg-accent px-5 py-2.5 text-sm font-bold text-white shadow-lg shadow-accent/30 transition-all hover:brightness-110"
              >
                Create your first collection
              </button>
            }
          />
        ) : (
          <div className={GRID}>
            {collections.map((c) => (
              <Link
                key={c.id}
                href={`/dashboard/collections/${c.id}`}
                className="group block"
              >
                <CoverMosaic covers={c.covers} />
                <p className="mt-2 truncate text-sm font-semibold text-white">
                  {c.name}
                </p>
                <p className="mt-0.5 text-xs text-white/35">
                  {c.imageCount} photo{c.imageCount === 1 ? "" : "s"}
                  {c.isProductImages && " · product shots"}
                </p>
              </Link>
            ))}
          </div>
        )}
      </div>

      <Modal
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        title="New collection"
        width="max-w-sm"
      >
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void create()}
          placeholder="Gym floor & equipment"
          maxLength={80}
          className="w-full rounded-xl bg-white/[0.06] px-4 py-3 text-sm text-white outline-none transition-colors focus:bg-white/[0.09] placeholder:text-white/25"
        />
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => setDialogOpen(false)}
            className="rounded-full px-4 py-2 text-sm font-semibold text-white/50 transition-colors hover:text-white"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void create()}
            disabled={creating}
            className="rounded-full bg-accent px-5 py-2 text-sm font-bold text-white transition-all hover:brightness-110 disabled:opacity-50"
          >
            {creating ? "Creating…" : "Create"}
          </button>
        </div>
      </Modal>
    </div>
  );
}

/** 2×2 mosaic of the first four photos; degrades to whatever exists. */
function CoverMosaic({ covers }: { covers: string[] }) {
  return (
    <div className="grid aspect-4/3 grid-cols-2 grid-rows-2 gap-0.5 overflow-hidden rounded-2xl bg-white/[0.03] ring-1 ring-white/[0.08] transition-all duration-300 group-hover:-translate-y-1 group-hover:ring-accent/40">
      {covers.length === 0 ? (
        <div className="col-span-2 row-span-2 grid place-items-center">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-white/20" aria-hidden>
            <rect x="3" y="3" width="18" height="18" rx="3" />
            <circle cx="9" cy="9" r="2" />
            <path d="m21 15-3.5-3.5L6 23" />
          </svg>
        </div>
      ) : (
        covers.slice(0, 4).map((url, i) => (
          <div
            key={i}
            // A lone photo fills the tile instead of sitting in a quarter.
            className={covers.length === 1 ? "col-span-2 row-span-2" : ""}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={url}
              alt=""
              loading="lazy"
              decoding="async"
              className="h-full w-full object-cover"
            />
          </div>
        ))
      )}
    </div>
  );
}
