"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCollections } from "./CollectionsProvider";
import { Modal } from "@/components/ui/Modal";
import { Skeleton } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import type { ImageCollection } from "@/lib/mock-data";

const GRID = "grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4";

export function CollectionsGrid() {
  const { collections, addCollection } = useCollections();
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const router = useRouter();

  useEffect(() => {
    const t = setTimeout(() => setLoading(false), 500);
    return () => clearTimeout(t);
  }, []);

  const create = async () => {
    const trimmed = name.trim();
    if (!trimmed || creating) return;
    setCreating(true);
    const created = await addCollection(trimmed);
    setCreating(false);
    setDialogOpen(false);
    setName("");
    router.push(`/dashboard/collections/${created.id}`);
  };

  return (
    <div>
      <div className="flex items-center justify-between">
        <p className="text-sm text-white/40">
          {collections.length} collection{collections.length === 1 ? "" : "s"}
        </p>
        <button
          type="button"
          onClick={() => setDialogOpen(true)}
          className="inline-flex items-center gap-2 rounded-full bg-accent px-5 py-2.5 text-sm font-bold text-white shadow-lg shadow-accent/30 transition-all hover:brightness-110 active:scale-[0.98]"
        >
          <span aria-hidden className="text-base leading-none">+</span>
          New Collection
        </button>
      </div>

      <div className="mt-5">
        {loading ? (
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
            description="Collections keep your product shots and brand photos organized — the generator pulls slides straight from them."
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
              <FolderCard key={c.id} collection={c} />
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
          onKeyDown={(e) => {
            if (e.key === "Enter") void create();
          }}
          placeholder="e.g. Product shots — summer drop"
          className="block w-full rounded-xl bg-white/[0.05] px-4 py-3 text-sm text-white outline-none ring-1 ring-white/[0.08] transition-all placeholder:text-white/25 focus:ring-2 focus:ring-accent"
        />
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => setDialogOpen(false)}
            className="rounded-full px-4 py-2.5 text-sm font-semibold text-white/50 transition-colors hover:text-white"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void create()}
            disabled={!name.trim() || creating}
            className="rounded-full bg-accent px-5 py-2.5 text-sm font-bold text-white shadow-lg shadow-accent/30 transition-all hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {creating ? "Creating…" : "Create collection"}
          </button>
        </div>
      </Modal>
    </div>
  );
}

function FolderCard({ collection }: { collection: ImageCollection }) {
  const preview = collection.images.slice(0, 4);
  return (
    <Link
      href={`/dashboard/collections/${collection.id}`}
      className="group block rounded-2xl bg-[#141416] p-2.5 ring-1 ring-white/[0.06] transition-all duration-300 hover:-translate-y-1 hover:shadow-xl hover:shadow-accent/10 hover:ring-accent/40"
    >
      <div className="grid aspect-4/3 grid-cols-2 grid-rows-2 gap-1 overflow-hidden rounded-xl">
        {Array.from({ length: 4 }, (_, i) => {
          const img = preview[i];
          return img ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={img.id}
              src={img.url}
              alt=""
              loading="lazy"
              decoding="async"
              className="h-full w-full object-cover"
            />
          ) : (
            <div key={`ph-${i}`} className="grid place-items-center bg-white/[0.03]">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="text-white/15" aria-hidden>
                <rect x="3" y="5" width="18" height="14" rx="2" />
                <circle cx="8.5" cy="10" r="1.5" />
                <path d="M21 16l-5-5-8 8" />
              </svg>
            </div>
          );
        })}
      </div>
      <div className="flex items-center justify-between gap-2 px-1.5 pb-1 pt-2.5">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-white">{collection.name}</p>
          <p className="text-xs text-white/35">
            {collection.images.length} image{collection.images.length === 1 ? "" : "s"}
          </p>
        </div>
        {collection.isProductImages && (
          <span className="shrink-0 rounded-full bg-accent/15 px-2 py-0.5 text-[10px] font-bold text-accent-text">
            Product images
          </span>
        )}
      </div>
    </Link>
  );
}
