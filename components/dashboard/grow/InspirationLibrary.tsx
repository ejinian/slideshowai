"use client";

import { useMemo, useState } from "react";
import {
  BUSINESS_TYPES,
  type BusinessType,
  type TrendingFeed,
  type TrendingSlideshow,
} from "@/lib/mock-data";
import { Dropdown } from "@/components/ui/Dropdown";
import { EmptyState } from "@/components/ui/EmptyState";
import { FilterPill } from "@/components/ui/FilterPill";
import { TrendCard, TrendDetail } from "./TrendsView";

// The viral hall of fame: real inspiration_posts rows (12-month window,
// ranked by raw views) rendered with the Trends card + detail modal — so
// teardowns, format anatomy, and Remix all work here too.

type SortKey = "views" | "likes" | "recent";

const GRID =
  "grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6";

export function InspirationLibrary({
  feed,
  defaultNiche,
}: {
  /** Server-fetched hall-of-fame feed. */
  feed: TrendingFeed;
  /** Pre-selects the user's own niche (from onboarding) in the filter bar. */
  defaultNiche?: BusinessType | null;
}) {
  const [selected, setSelected] = useState<Set<BusinessType>>(
    () => new Set(defaultNiche ? [defaultNiche] : []),
  );
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("views");
  const [openItem, setOpenItem] = useState<TrendingSlideshow | null>(null);

  const toggleNiche = (niche: BusinessType) =>
    setSelected((cur) => {
      const nextSet = new Set(cur);
      if (nextSet.has(niche)) nextSet.delete(niche);
      else nextSet.add(niche);
      return nextSet;
    });

  const items = useMemo(() => {
    let list = feed.items;
    if (selected.size > 0) list = list.filter((i) => selected.has(i.niche));
    if (query.trim()) {
      const q = query.trim().toLowerCase();
      list = list.filter(
        (i) =>
          i.title.toLowerCase().includes(q) ||
          i.author.toLowerCase().includes(q) ||
          (i.hookType ?? "").toLowerCase().includes(q),
      );
    }
    // Re-rank within the visible set so badges always read 1..n.
    return [...list]
      .sort((a, b) =>
        sort === "views"
          ? b.views24h - a.views24h
          : sort === "likes"
            ? b.likes - a.likes
            : a.postedAgoHours - b.postedAgoHours,
      )
      .map((item, i) => ({ ...item, rank: i + 1 }));
  }, [feed, selected, query, sort]);

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
              placeholder="Search hooks, authors, formats"
              className="w-full bg-transparent text-sm text-white outline-none placeholder:text-white/25"
            />
          </label>
          <div className="flex items-center gap-3">
            {feed.items.length > 0 && (
              <p className="hidden text-xs font-medium text-white/35 sm:block">
                {feed.windowLabel} · {feed.items.length} slideshows
              </p>
            )}
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
      </div>

      {/* grid / empty */}
      <div className="mt-6">
        {feed.items.length === 0 ? (
          <EmptyState
            title="The hall of fame is empty"
            description="The viral backfill hasn't run yet — once it does, the most viral slideshows of the past 12 months land here."
          />
        ) : items.length === 0 ? (
          <EmptyState
            title="Nothing matches those filters"
            description="Try fewer niches or clear the search — new viral formats land here on every refresh."
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
              <TrendCard key={item.id} item={item} onOpen={() => setOpenItem(item)} />
            ))}
          </div>
        )}
      </div>

      {/* keyed by item so the CTA state resets per slideshow, no effect needed */}
      <TrendDetail
        key={openItem?.id ?? "closed"}
        item={openItem}
        onClose={() => setOpenItem(null)}
      />
    </div>
  );
}
