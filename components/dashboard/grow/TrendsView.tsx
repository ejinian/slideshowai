"use client";

import { useEffect, useMemo, useState } from "react";
import {
  BUSINESS_TYPES,
  applyTemplate,
  formatCount,
  getTrendingSlideshows,
  type BusinessType,
  type TrendingFeed,
  type TrendingSlideshow,
} from "@/lib/mock-data";
import { Modal } from "@/components/ui/Modal";
import { CardGridSkeleton } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { FilterPill } from "@/components/ui/FilterPill";

const GRID =
  "grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5";

type TimeWindow = "day" | "week" | "rising";

const WINDOW_HOURS: Record<TimeWindow, number> = {
  day: 24,
  week: 24 * 7,
  rising: Number.POSITIVE_INFINITY,
};

const WINDOW_TABS: { value: TimeWindow; label: string }[] = [
  { value: "day", label: "Past 24h" },
  { value: "week", label: "Past week" },
  { value: "rising", label: "Rising" },
];

export function TrendsView({
  initialFeed,
  defaultNiche,
}: {
  /** Server-fetched feed (live or sample). Absent = client loads the sample. */
  initialFeed?: TrendingFeed | null;
  /** Pre-selects the user's own niche (from onboarding) in the filter bar. */
  defaultNiche?: BusinessType | null;
}) {
  const [feed, setFeed] = useState<TrendingFeed | null>(initialFeed ?? null);
  const [selected, setSelected] = useState<Set<BusinessType>>(
    () => new Set(defaultNiche ? [defaultNiche] : []),
  );
  const [window, setWindow] = useState<TimeWindow>("rising");
  const [openItem, setOpenItem] = useState<TrendingSlideshow | null>(null);

  useEffect(() => {
    if (initialFeed) return;
    let cancelled = false;
    void getTrendingSlideshows().then((f) => {
      if (!cancelled) setFeed(f);
    });
    return () => {
      cancelled = true;
    };
  }, [initialFeed]);

  const toggleNiche = (niche: BusinessType) =>
    setSelected((cur) => {
      const nextSet = new Set(cur);
      if (nextSet.has(niche)) nextSet.delete(niche);
      else nextSet.add(niche);
      return nextSet;
    });

  const items = useMemo(() => {
    if (!feed) return [];
    const maxHours = WINDOW_HOURS[window];
    const list = feed.items.filter(
      (i) =>
        (selected.size === 0 || selected.has(i.niche)) &&
        i.postedAgoHours <= maxHours,
    );
    // Rank within the visible window, fastest climbers first.
    return [...list]
      .sort((a, b) => b.viewsPerHour - a.viewsPerHour)
      .map((item, i) => ({ ...item, rank: i + 1 }));
  }, [feed, selected, window]);

  return (
    <div>
      {/* freshness + filters */}
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <FilterPill
            label="All niches"
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
        <div className="flex flex-wrap items-center justify-between gap-3">
          {/* time window toggle */}
          <div className="flex rounded-full bg-white/[0.06] p-1">
            {WINDOW_TABS.map((tab) => (
              <button
                key={tab.value}
                type="button"
                aria-pressed={window === tab.value}
                onClick={() => setWindow(tab.value)}
                className={`rounded-full px-3.5 py-1.5 text-xs font-bold transition-colors ${
                  window === tab.value
                    ? "bg-white text-black"
                    : "text-white/50 hover:text-white"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {feed && (
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs font-medium text-white/35">
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400" />
              </span>
              {feed.windowLabel} — updated{" "}
              {feed.updatedMinutesAgo >= 60
                ? `${Math.round(feed.updatedMinutesAgo / 60)}h`
                : `${feed.updatedMinutesAgo}m`}{" "}
              ago
              {feed.source === "sample" && (
                <span className="rounded-full bg-amber-400/10 px-2 py-0.5 text-[10px] font-bold text-amber-300">
                  Sample data — run the trends migration to go live
                </span>
              )}
            </p>
          )}
        </div>
      </div>

      <div className="mt-6">
        {feed === null ? (
          <CardGridSkeleton count={10} className={GRID} />
        ) : items.length === 0 ? (
          <EmptyState
            title={
              window === "rising"
                ? "Nothing trending in those niches right now"
                : `Nothing from the ${window === "day" ? "past 24 hours" : "past week"} in this view yet`
            }
            description={
              window === "rising"
                ? "The feed refreshes daily — or widen the filter to see the full chart."
                : "The recency pool fills up as the daily refresh discovers active creators. Rising always has content."
            }
            action={
              <button
                type="button"
                onClick={() =>
                  window === "rising" ? setSelected(new Set()) : setWindow("rising")
                }
                className="rounded-full bg-white/[0.08] px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-white/[0.14]"
              >
                {window === "rising" ? "Show all niches" : "Show Rising"}
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

      <TrendDetail
        key={openItem?.id ?? "closed"}
        item={openItem}
        onClose={() => setOpenItem(null)}
      />
    </div>
  );
}

function VelocityChip({ perHour }: { perHour: number }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-black/60 px-2 py-0.5 text-[10px] font-bold text-emerald-400 backdrop-blur-sm">
      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M3 17l6-6 4 4 8-8M14 7h7v7" />
      </svg>
      +{formatCount(perHour)}/hr
    </span>
  );
}

function TrendCard({
  item,
  onOpen,
}: {
  item: TrendingSlideshow;
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
        {/* rank badge */}
        <span
          className={`absolute left-2 top-2 grid h-7 min-w-7 place-items-center rounded-full px-1.5 text-xs font-extrabold ${
            item.rank <= 3
              ? "bg-accent text-white shadow-lg shadow-accent/40"
              : "bg-black/60 text-white backdrop-blur-sm"
          }`}
        >
          #{item.rank}
        </span>
        <span className="absolute right-2 top-2">
          <VelocityChip perHour={item.viewsPerHour} />
        </span>
        <div className="absolute inset-x-2.5 bottom-2 flex items-center gap-3 text-[11px] font-bold text-white">
          <span className="inline-flex items-center gap-1">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
              <path d="M8 5v14l11-7z" />
            </svg>
            {formatCount(item.views24h)}
          </span>
          <span className="text-white/60">{item.postedAgoHours}h ago</span>
        </div>
      </div>
      <p className="mt-2 line-clamp-1 text-sm font-semibold text-white">{item.title}</p>
      <p className="mt-0.5 line-clamp-1 text-xs text-white/40">
        {item.author} · {item.niche}
      </p>
    </button>
  );
}

function TrendDetail({
  item,
  onClose,
}: {
  item: TrendingSlideshow | null;
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
    <Modal open={!!item} onClose={onClose} title={item?.title} width="max-w-xl">
      {item && (
        <div className="sm:flex sm:gap-5">
          <div className="relative mx-auto aspect-9/16 w-40 shrink-0 overflow-hidden rounded-xl ring-1 ring-white/10 sm:mx-0">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={item.cover} alt="" className="absolute inset-0 h-full w-full object-cover" />
            <span className="absolute left-2 top-2 grid h-7 min-w-7 place-items-center rounded-full bg-accent px-1.5 text-xs font-extrabold text-white">
              #{item.rank}
            </span>
          </div>

          <div className="mt-4 min-w-0 flex-1 sm:mt-0">
            <div className="flex flex-wrap items-center gap-2 text-xs font-semibold">
              <span className="rounded-full bg-white/[0.06] px-2.5 py-1 text-white/70">
                {formatCount(item.views24h)} views · 24h
              </span>
              <VelocityChip perHour={item.viewsPerHour} />
              <span className="rounded-full bg-white/[0.06] px-2.5 py-1 text-white/70">
                {formatCount(item.likes)} likes
              </span>
            </div>
            <p className="mt-2 text-xs text-white/35">
              {item.author} · {item.niche} · {item.slideCount} slides ·{" "}
              {item.postedAgoHours}h ago
            </p>

            <div className="mt-4 rounded-xl bg-accent/[0.08] p-3.5 ring-1 ring-accent/20">
              <p className="text-[11px] font-bold uppercase tracking-wider text-accent-text">
                Why it works
              </p>
              <p className="mt-1 text-sm leading-relaxed text-white/70">
                {item.whyItWorks}
              </p>
            </div>

            <div className="mt-5 flex flex-col gap-2 sm:flex-row">
              <button
                type="button"
                onClick={() => void apply()}
                disabled={state !== "idle"}
                className={`flex-1 rounded-full px-5 py-3 text-sm font-bold text-white shadow-lg transition-all active:scale-[0.98] ${
                  state === "done"
                    ? "bg-white/[0.08] text-white/50"
                    : "bg-accent shadow-accent/30 hover:brightness-110"
                } disabled:cursor-not-allowed`}
              >
                {state === "loading"
                  ? "Loading format…"
                  : state === "done"
                    ? "Format ready"
                    : "Use this format"}
              </button>
              <a
                href={item.tiktokUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-full bg-white/[0.06] px-5 py-3 text-center text-sm font-semibold text-white/80 transition-colors hover:bg-white/[0.1] hover:text-white"
              >
                Watch on TikTok
              </a>
            </div>
            {state === "done" && (
              <p className="mt-2 text-xs text-white/30">
                Format loaded (stub) — the generator will prefill with this
                structure.
              </p>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}
