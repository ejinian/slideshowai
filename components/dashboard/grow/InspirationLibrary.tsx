"use client";

import { useEffect, useMemo, useState } from "react";
import {
  BUSINESS_TYPES,
  INSPIRATION_ITEMS,
  applyTemplate,
  formatCount,
  type BusinessType,
  type InspirationItem,
} from "@/lib/mock-data";
import { Modal } from "@/components/ui/Modal";
import { Dropdown } from "@/components/ui/Dropdown";
import { CardGridSkeleton } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { FilterPill } from "@/components/ui/FilterPill";

type SortKey = "views" | "likes" | "recent";

const GRID =
  "grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6";

export function InspirationLibrary() {
  // Filters are the differentiator: multi-select niche pills + search + sort.
  const [selected, setSelected] = useState<Set<BusinessType>>(new Set());
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("views");
  const [openItem, setOpenItem] = useState<InspirationItem | null>(null);
  const [loading, setLoading] = useState(true);

  // Simulated fetch so the skeleton state is real; swap for the query later.
  useEffect(() => {
    const t = setTimeout(() => setLoading(false), 550);
    return () => clearTimeout(t);
  }, []);

  const toggleNiche = (niche: BusinessType) =>
    setSelected((cur) => {
      const nextSet = new Set(cur);
      if (nextSet.has(niche)) nextSet.delete(niche);
      else nextSet.add(niche);
      return nextSet;
    });

  const items = useMemo(() => {
    let list = INSPIRATION_ITEMS;
    if (selected.size > 0) list = list.filter((i) => selected.has(i.businessType));
    if (query.trim()) {
      const q = query.trim().toLowerCase();
      list = list.filter(
        (i) =>
          i.title.toLowerCase().includes(q) ||
          i.description.toLowerCase().includes(q),
      );
    }
    return [...list].sort((a, b) =>
      sort === "views"
        ? b.views - a.views
        : sort === "likes"
          ? b.likes - a.likes
          : b.postedAt.localeCompare(a.postedAt),
    );
  }, [selected, query, sort]);

  return (
    <div>
      {/* filter bar */}
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <FilterPill
            label="All"
            active={selected.size === 0}
            onClick={() => setSelected(new Set())}
          />
          {BUSINESS_TYPES.map((niche) => (
            <FilterPill
              key={niche}
              label={niche}
              active={selected.has(niche)}
              onClick={() => toggleNiche(niche)}
            />
          ))}
        </div>

        <div className="flex items-center justify-between gap-3">
          <label className="flex min-w-0 flex-1 items-center gap-2 rounded-full bg-white/[0.06] px-4 py-2 transition-colors focus-within:bg-white/[0.09] sm:max-w-xs">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden className="shrink-0 text-white/30">
              <circle cx="11" cy="11" r="7" />
              <path d="M21 21l-4.3-4.3" />
            </svg>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search formats"
              className="w-full bg-transparent text-sm text-white outline-none placeholder:text-white/25"
            />
          </label>
          <Dropdown
            label="Sort"
            value={sort}
            onChange={setSort}
            options={[
              { value: "views", label: "Most Views" },
              { value: "likes", label: "Most Likes" },
              { value: "recent", label: "Recent" },
            ]}
          />
        </div>
      </div>

      {/* grid / skeleton / empty */}
      <div className="mt-6">
        {loading ? (
          <CardGridSkeleton count={10} className={GRID} />
        ) : items.length === 0 ? (
          <EmptyState
            title="Nothing matches those filters"
            description="Try fewer niches or clear the search — new viral formats land here every week."
            action={
              <button
                type="button"
                onClick={() => {
                  setSelected(new Set());
                  setQuery("");
                }}
                className="rounded-full bg-white/[0.08] px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-white/[0.14]"
              >
                Clear filters
              </button>
            }
          />
        ) : (
          <div className={GRID}>
            {items.map((item) => (
              <InspirationCard
                key={item.id}
                item={item}
                onOpen={() => setOpenItem(item)}
              />
            ))}
          </div>
        )}
      </div>

      {/* keyed by item so the CTA state resets per slideshow, no effect needed */}
      <InspirationDetail
        key={openItem?.id ?? "closed"}
        item={openItem}
        onClose={() => setOpenItem(null)}
      />
    </div>
  );
}

function InspirationCard({
  item,
  onOpen,
}: {
  item: InspirationItem;
  onOpen: () => void;
}) {
  return (
    <button type="button" onClick={onOpen} className="group block text-left">
      <div className="relative aspect-9/16 overflow-hidden rounded-2xl ring-1 ring-white/10 transition-all duration-300 group-hover:-translate-y-1 group-hover:shadow-xl group-hover:shadow-accent/15 group-hover:ring-accent/50">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={item.cover}
          alt=""
          loading="lazy"
          decoding="async"
          className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
        />
        <div aria-hidden className="absolute inset-x-0 bottom-0 h-2/5 bg-linear-to-t from-black/85 to-transparent" />
        <span className="absolute left-2 top-2 rounded-full bg-black/60 px-2 py-0.5 text-[10px] font-semibold text-white backdrop-blur-sm">
          {item.businessType}
        </span>
        <div className="absolute inset-x-2.5 bottom-2 flex items-center gap-3 text-[11px] font-bold text-white">
          <span className="inline-flex items-center gap-1">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
              <path d="M8 5v14l11-7z" />
            </svg>
            {formatCount(item.views)}
          </span>
          <span className="inline-flex items-center gap-1">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
              <path d="M12 21s-7.5-4.6-10-9.2C.6 9 1.6 5.5 4.8 4.8 6.9 4.3 8.9 5.3 10 7c1.1-1.7 3.1-2.7 5.2-2.2C18.4 5.5 19.4 9 18 11.8 15.5 16.4 12 21 12 21z" />
            </svg>
            {formatCount(item.likes)}
          </span>
        </div>
      </div>
      <p className="mt-2 line-clamp-1 text-sm font-semibold text-white">
        {item.title}
      </p>
      <p className="mt-0.5 line-clamp-1 text-xs text-white/40">{item.description}</p>
    </button>
  );
}

function InspirationDetail({
  item,
  onClose,
}: {
  item: InspirationItem | null;
  onClose: () => void;
}) {
  const [state, setState] = useState<"idle" | "loading" | "done">("idle");

  const apply = async () => {
    if (!item || state !== "idle") return;
    setState("loading");
    await applyTemplate(item.id);
    setState("done");
  };

  return (
    <Modal open={!!item} onClose={onClose} title={item?.title} width="max-w-2xl">
      {item && (
        <div>
          <div className="flex flex-wrap items-center gap-2 text-xs font-semibold">
            <span className="rounded-full bg-white/[0.06] px-2.5 py-1 text-white/70">
              {item.businessType}
            </span>
            <span className="rounded-full bg-white/[0.06] px-2.5 py-1 text-white/70">
              {formatCount(item.views)} views
            </span>
            <span className="rounded-full bg-white/[0.06] px-2.5 py-1 text-white/70">
              {formatCount(item.likes)} likes
            </span>
            <span className="text-white/30">{item.slides.length} slides</span>
          </div>

          <p className="mt-3 text-sm leading-relaxed text-white/50">
            {item.description}
          </p>

          {/* full slide breakdown */}
          <div className="no-scrollbar -mx-1 mt-5 flex snap-x gap-3 overflow-x-auto px-1 pb-2">
            {item.slides.map((slide, i) => (
              <figure key={i} className="w-36 shrink-0 snap-start sm:w-40">
                <div className="relative aspect-9/16 overflow-hidden rounded-xl ring-1 ring-white/10">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={slide.image}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    className="absolute inset-0 h-full w-full object-cover"
                  />
                  <div aria-hidden className="absolute inset-0 bg-black/30" />
                  <p className="absolute inset-x-2 top-1/2 -translate-y-1/2 text-center text-[10px] font-extrabold leading-tight text-white drop-shadow-[0_2px_6px_rgba(0,0,0,0.9)]">
                    {slide.caption}
                  </p>
                </div>
                <figcaption className="mt-1.5 text-center text-[11px] font-medium text-white/35">
                  Slide {i + 1} of {item.slides.length}
                </figcaption>
              </figure>
            ))}
          </div>

          <div className="mt-5 flex flex-col items-stretch gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-white/30">
              {state === "done"
                ? "Template loaded (stub) — the generator will prefill with this format."
                : "Prefills the generator with this format and slide count."}
            </p>
            <button
              type="button"
              onClick={apply}
              disabled={state !== "idle"}
              className={`rounded-full px-6 py-3 text-sm font-bold text-white shadow-lg transition-all active:scale-[0.98] ${
                state === "done"
                  ? "bg-white/[0.08] text-white/50"
                  : "bg-accent shadow-accent/30 hover:brightness-110"
              } disabled:cursor-not-allowed`}
            >
              {state === "loading"
                ? "Loading template…"
                : state === "done"
                  ? "Template ready"
                  : "Use this as template"}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
