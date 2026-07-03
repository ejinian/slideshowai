"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useCollections } from "./CollectionsProvider";
import { EmptyState } from "@/components/ui/EmptyState";

export function CollectionDetail({ id }: { id: string }) {
  const { collections, addImages, deleteImages, toggleProductImages } =
    useCollections();
  const collection = collections.find((c) => c.id === id);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [dragging, setDragging] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  if (!collection) {
    return (
      <EmptyState
        title="Collection not found"
        description="It may have been deleted, or the link is stale."
        action={
          <Link
            href="/dashboard/collections"
            className="rounded-full bg-white/[0.08] px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-white/[0.14]"
          >
            Back to collections
          </Link>
        }
      />
    );
  }

  const toggleSelect = (imageId: string) =>
    setSelected((cur) => {
      const nextSet = new Set(cur);
      if (nextSet.has(imageId)) nextSet.delete(imageId);
      else nextSet.add(imageId);
      return nextSet;
    });

  const onFiles = (files: FileList | null) => {
    if (!files?.length) return;
    addImages(collection.id, [...files]);
  };

  const removeSelected = async () => {
    if (selected.size === 0 || deleting) return;
    setDeleting(true);
    await deleteImages(collection.id, [...selected]);
    setSelected(new Set());
    setDeleting(false);
  };

  return (
    <div>
      {/* header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <Link
            href="/dashboard/collections"
            aria-label="Back to collections"
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white/[0.06] text-white/60 transition-colors hover:bg-white/[0.1] hover:text-white"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
          </Link>
          <div className="min-w-0">
            <h1 className="truncate text-xl font-bold tracking-tight text-white">
              {collection.name}
            </h1>
            <p className="text-xs text-white/35">
              {collection.images.length} image{collection.images.length === 1 ? "" : "s"}
            </p>
          </div>
        </div>

        {/* product-images toggle — feeds per-slide product placement */}
        <button
          type="button"
          role="switch"
          aria-checked={collection.isProductImages}
          onClick={() => toggleProductImages(collection.id)}
          className="flex items-center gap-2.5 rounded-full bg-white/[0.04] py-2 pl-4 pr-2 ring-1 ring-white/[0.06] transition-colors hover:bg-white/[0.07]"
        >
          <span className="text-sm font-medium text-white/70">
            Set as product images
          </span>
          <span
            className={`relative h-6 w-10 rounded-full transition-colors ${
              collection.isProductImages ? "bg-accent" : "bg-white/[0.12]"
            }`}
          >
            <span
              className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
                collection.isProductImages ? "translate-x-[18px]" : "translate-x-0.5"
              }`}
            />
          </span>
        </button>
      </div>

      {/* upload zone — UI only, local object-URL previews */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          onFiles(e.dataTransfer.files);
        }}
        className={`mt-5 flex flex-col items-center justify-center rounded-2xl border border-dashed px-6 py-8 text-center transition-all ${
          dragging
            ? "border-accent bg-accent/10"
            : "border-white/[0.12] bg-white/[0.02] hover:border-white/[0.2]"
        }`}
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="text-white/30" aria-hidden>
          <path d="M12 16V4M6 10l6-6 6 6M4 20h16" />
        </svg>
        <p className="mt-2 text-sm font-semibold text-white/80">
          {dragging ? "Drop to add" : "Drag & drop images here"}
        </p>
        <p className="mt-0.5 text-xs text-white/35">
          Previews stay local — nothing uploads yet
        </p>
        <button
          type="button"
          onClick={() => fileInput.current?.click()}
          className="mt-3 rounded-full bg-white/[0.08] px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-white/[0.14]"
        >
          Browse files
        </button>
        <input
          ref={fileInput}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => {
            onFiles(e.target.files);
            e.target.value = "";
          }}
        />
      </div>

      {/* selection action bar */}
      {selected.size > 0 && (
        <div className="animate-dropdown-in sticky top-2 z-20 mt-4 flex items-center justify-between rounded-2xl bg-[#1a1a1c] px-4 py-2.5 shadow-2xl ring-1 ring-white/[0.1]">
          <p className="text-sm font-semibold text-white">
            {selected.size} selected
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setSelected(new Set())}
              className="rounded-full px-3 py-2 text-xs font-semibold text-white/50 transition-colors hover:text-white"
            >
              Clear
            </button>
            <button
              type="button"
              onClick={() => void removeSelected()}
              disabled={deleting}
              className="rounded-full bg-red-500/90 px-4 py-2 text-xs font-bold text-white transition-all hover:bg-red-500 disabled:opacity-50"
            >
              {deleting ? "Deleting…" : "Delete"}
            </button>
          </div>
        </div>
      )}

      {/* image grid */}
      <div className="mt-5">
        {collection.images.length === 0 ? (
          <EmptyState
            title="This collection is empty"
            description="Add photos of your products, space, or team — every image here becomes slide material."
            action={
              <button
                type="button"
                onClick={() => fileInput.current?.click()}
                className="rounded-full bg-accent px-5 py-2.5 text-sm font-bold text-white shadow-lg shadow-accent/30 transition-all hover:brightness-110"
              >
                Add images
              </button>
            }
          />
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {collection.images.map((img) => {
              const isSelected = selected.has(img.id);
              return (
                <button
                  key={img.id}
                  type="button"
                  onClick={() => toggleSelect(img.id)}
                  aria-pressed={isSelected}
                  className={`group relative aspect-square overflow-hidden rounded-xl transition-all ${
                    isSelected
                      ? "ring-2 ring-accent"
                      : "ring-1 ring-white/[0.08] hover:ring-white/25"
                  }`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={img.url}
                    alt={img.name}
                    loading="lazy"
                    decoding="async"
                    className={`h-full w-full object-cover transition-all duration-300 ${
                      isSelected ? "scale-[0.97] opacity-80" : "group-hover:scale-105"
                    }`}
                  />
                  <span
                    className={`absolute right-2 top-2 grid h-6 w-6 place-items-center rounded-full transition-all ${
                      isSelected
                        ? "bg-accent text-white"
                        : "bg-black/50 text-transparent opacity-0 ring-1 ring-white/40 backdrop-blur-sm group-hover:opacity-100"
                    }`}
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                      <path d="M20 6L9 17l-5-5" />
                    </svg>
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
