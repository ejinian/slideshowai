"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  BUSINESS_TYPES,
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

type TimeWindow = "day" | "week" | "rising" | "alltime";

const WINDOW_HOURS: Record<TimeWindow, number> = {
  day: 24,
  week: 24 * 7,
  // Rising only considers recent posts — an old monster with a fresh snapshot
  // is "still huge", not "rising".
  rising: 24 * 14,
  // All-time reads its own 12-month feed; no hour cap on top of that.
  alltime: Infinity,
};

const WINDOW_TABS: { value: TimeWindow; label: string }[] = [
  { value: "day", label: "Best today" },
  { value: "week", label: "Best this week" },
  { value: "rising", label: "Rising" },
  { value: "alltime", label: "All-time" },
];

// What each tab actually ranks by (shown next to the live dot).
const WINDOW_RANK_LABEL: Record<TimeWindow, string> = {
  day: "The day's biggest slideshows, ranked by views",
  week: "The week's biggest slideshows, ranked by views",
  rising: "Climbing fastest right now — views gained since the last refresh",
  alltime: "The most viral slideshows of the past year — steal the structure",
};

export function TrendsView({
  initialFeed,
  inspirationFeed,
  defaultNiche,
}: {
  /** Server-fetched feed (live or sample). Absent = client loads the sample. */
  initialFeed?: TrendingFeed | null;
  /** 12-month hall-of-fame feed backing the All-time tab (absent = tab hidden). */
  inspirationFeed?: TrendingFeed | null;
  /** Pre-selects the user's own niche (from onboarding) in the filter bar. */
  defaultNiche?: BusinessType | null;
}) {
  const [feed, setFeed] = useState<TrendingFeed | null>(initialFeed ?? null);
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(defaultNiche ? [defaultNiche] : []),
  );
  const [selectedMediums, setSelectedMediums] = useState<Set<string>>(new Set());
  const [window, setWindow] = useState<TimeWindow>("rising");
  const [query, setQuery] = useState("");
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

  const toggleIn =
    (set: (fn: (cur: Set<string>) => Set<string>) => void) => (value: string) =>
      set((cur) => {
        const nextSet = new Set(cur);
        if (nextSet.has(value)) nextSet.delete(value);
        else nextSet.add(value);
        return nextSet;
      });
  const toggleSelected = toggleIn(setSelected);
  const toggleMedium = toggleIn(setSelectedMediums);
  // The niche rail shows the FULL library catalog on every tab. The live
  // charts only track the five business niches, so picking a library-only
  // niche jumps to All-time instead of stranding the user on an empty chart.
  const toggleNiche = (niche: string) => {
    if (
      window !== "alltime" &&
      !(BUSINESS_TYPES as readonly string[]).includes(niche) &&
      !selected.has(niche)
    ) {
      setWindow("alltime");
    }
    toggleSelected(niche);
  };

  // The library (All-time) has OPEN niches + product mediums — its facets are
  // computed from the data, with counts, like a real directory. The live tabs
  // keep the fixed five business niches.
  const libraryFacets = useMemo(() => {
    const niches = new Map<string, number>();
    const mediums = new Map<string, number>();
    for (const i of inspirationFeed?.items ?? []) {
      const n = i.nicheLabel ?? i.niche;
      niches.set(n, (niches.get(n) ?? 0) + 1);
      if (i.medium) mediums.set(i.medium, (mediums.get(i.medium) ?? 0) + 1);
    }
    const sorted = (m: Map<string, number>) =>
      [...m.entries()].sort((a, b) => b[1] - a[1]);
    return { niches: sorted(niches), mediums: sorted(mediums) };
  }, [inspirationFeed]);

  // All-time reads the hall-of-fame feed; the live tabs read the trends feed.
  const activeFeed = window === "alltime" ? (inspirationFeed ?? null) : feed;

  const items = useMemo(() => {
    if (!activeFeed) return [];
    const maxHours = WINDOW_HOURS[window];
    const q = query.trim().toLowerCase();
    const list = activeFeed.items.filter(
      (i) =>
        (selected.size === 0 || selected.has(i.nicheLabel ?? i.niche)) &&
        (window !== "alltime" ||
          selectedMediums.size === 0 ||
          (i.medium != null && selectedMediums.has(i.medium))) &&
        i.postedAgoHours <= maxHours &&
        (!q ||
          i.title.toLowerCase().includes(q) ||
          i.author.toLowerCase().includes(q) ||
          (i.hookType ?? "").toLowerCase().includes(q) ||
          (i.medium ?? "").toLowerCase().includes(q)),
    );
    // Best today / this week / All-time = the absolute biggest, ranked by raw
    // views. Rising = live climb rate (snapshot delta) first; posts we haven't
    // seen twice yet fall back below, ordered by lifetime rate.
    const key = (i: TrendingSlideshow) =>
      window === "rising"
        ? (i.risingVph ?? -1)
        : i.views24h;
    return [...list]
      .sort((a, b) => key(b) - key(a) || b.viewsPerHour - a.viewsPerHour)
      .map((item, i) => ({ ...item, rank: i + 1 }));
  }, [activeFeed, selected, selectedMediums, window, query]);

  return (
    <div>
      {/* freshness + filters */}
      <div className="flex flex-col gap-3">
        {/* niche rail — the full library catalog, visible on every tab.
            Falls back to the fixed five before the library backfill runs. */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="pr-1 text-[11px] font-bold uppercase tracking-wider text-white/30">
            Niche
          </span>
          <FilterPill
            label={
              libraryFacets.niches.length > 0
                ? `All (${(inspirationFeed?.items ?? []).length})`
                : "All niches"
            }
            active={selected.size === 0}
            onClick={() => setSelected(new Set())}
          />
          {libraryFacets.niches.length > 0
            ? libraryFacets.niches.map(([niche, count]) => (
                <FilterPill
                  key={niche}
                  label={`${niche} (${count})`}
                  active={selected.has(niche)}
                  onClick={() => toggleNiche(niche)}
                />
              ))
            : BUSINESS_TYPES.map((niche) => (
                <FilterPill
                  key={niche}
                  label={niche}
                  active={selected.has(niche)}
                  onClick={() => toggleNiche(niche)}
                />
              ))}
        </div>
        {window === "alltime" && libraryFacets.mediums.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="pr-1 text-[11px] font-bold uppercase tracking-wider text-white/30">
              Selling
            </span>
            <FilterPill
              label="All"
              active={selectedMediums.size === 0}
              onClick={() => setSelectedMediums(new Set())}
            />
            {libraryFacets.mediums.slice(0, 14).map(([medium, count]) => (
              <FilterPill
                key={medium}
                label={`${medium} (${count})`}
                active={selectedMediums.has(medium)}
                onClick={() => toggleMedium(medium)}
              />
            ))}
          </div>
        )}
        <div className="flex flex-wrap items-center justify-between gap-3">
          {/* time window toggle */}
          <div className="flex rounded-full bg-white/[0.06] p-1">
            {WINDOW_TABS.filter(
              (tab) => tab.value !== "alltime" || inspirationFeed,
            ).map((tab) => (
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

          <label className="flex min-w-0 items-center gap-2 rounded-full bg-white/[0.06] px-4 py-2 transition-colors focus-within:bg-white/[0.09] sm:w-64">
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
        </div>

        {activeFeed && (
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs font-medium text-white/35">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400" />
            </span>
            {WINDOW_RANK_LABEL[window]} — updated{" "}
            {activeFeed.updatedMinutesAgo >= 60
              ? `${Math.round(activeFeed.updatedMinutesAgo / 60)}h`
              : `${activeFeed.updatedMinutesAgo}m`}{" "}
            ago
            {activeFeed.source === "sample" && (
              <span className="rounded-full bg-amber-400/10 px-2 py-0.5 text-[10px] font-bold text-amber-300">
                Sample data — run the trends migration to go live
              </span>
            )}
          </p>
        )}
      </div>

      <div className="mt-6">
        {activeFeed === null ? (
          <CardGridSkeleton count={10} className={GRID} />
        ) : items.length === 0 ? (
          query.trim() ? (
            <EmptyState
              title="Nothing matches that search"
              description="Try fewer niches or a different phrase — new formats land on every refresh."
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
          ) : window === "alltime" ? (
            <EmptyState
              title="The hall of fame is empty"
              description="The viral backfill hasn't run yet — once it does, the most viral slideshows of the past 12 months land here."
            />
          ) : (
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
          )
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

// Placeholder for posts whose cover is missing or whose TikTok CDN URL has
// expired (they rot after ~a day; the ingest cache prevents this for new
// posts, but old rows and failed downloads still need a graceful face).
const NICHE_GRADIENT: Record<BusinessType, string> = {
  "Gym & Fitness": "from-indigo-500/35 to-sky-500/10",
  "E-commerce": "from-fuchsia-500/30 to-indigo-500/10",
  "Local Service": "from-emerald-500/30 to-teal-500/10",
  "B2C App": "from-violet-500/35 to-indigo-500/10",
  "Food & Dining": "from-amber-500/30 to-rose-500/10",
};

function TrendCover({
  item,
  className,
}: {
  item: TrendingSlideshow;
  className: string;
}) {
  const [broken, setBroken] = useState(false);
  const ref = useRef<HTMLImageElement>(null);

  // Catch images that already failed before hydration attached onError.
  useEffect(() => {
    const el = ref.current;
    if (el && el.complete && el.naturalWidth === 0) setBroken(true);
  }, []);

  if (!item.cover || broken) {
    return (
      <div
        aria-hidden
        className={`absolute inset-0 grid place-items-center bg-linear-to-br ${NICHE_GRADIENT[item.niche]}`}
      >
        <svg
          width="28"
          height="28"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="text-white/25"
          aria-hidden
        >
          <rect x="3" y="3" width="18" height="18" rx="3" />
          <circle cx="9" cy="9" r="2" />
          <path d="m21 15-3.5-3.5L6 23" />
        </svg>
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      ref={ref}
      src={item.cover}
      alt=""
      loading="lazy"
      decoding="async"
      onError={() => setBroken(true)}
      className={className}
    />
  );
}

// Posted within the last 24h — fresh enough that its momentum is "now".
const HOT_HOURS = 24;

// "5h ago" → "2 days ago" → "11 months ago" → "1 year ago". Hours only
// within the first day; big hour counts read absurd on older posts.
function agoLabel(hours: number): string {
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 61) return days === 1 ? "1 day ago" : `${days} days ago`;
  const months = Math.round(days / 30.44);
  if (months < 12) return `${months} months ago`;
  const years = Math.round(months / 12);
  return years === 1 ? "1 year ago" : `${years} years ago`;
}

function HotTodayChip() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-amber-400/15 px-2 py-0.5 text-[10px] font-bold text-amber-300">
      <svg
        width="10"
        height="10"
        viewBox="0 0 24 24"
        fill="currentColor"
        aria-hidden
      >
        <path d="M12 2c.7 3.2-.6 5-2.2 6.7C8.2 10.4 7 12 7 14.5A5.5 5.5 0 0 0 12.5 20c3.3 0 6-2.6 6-6 0-2.5-1.2-4.4-2.6-6.1C14.6 6.2 13.3 4.3 12 2Zm.5 16a3 3 0 0 1-3-3c0-1.4.7-2.3 1.6-3.3.6 1 1.5 1.7 2.4 2.5.7.6 1 1.1 1 1.8a2 2 0 0 1-2 2Z" />
      </svg>
      Hot today
    </span>
  );
}

// Shows the LIVE climb rate (snapshot delta) when we have one — "+12K/hr now"
// — else the lifetime average since posting.
function VelocityChip({ item }: { item: TrendingSlideshow }) {
  const live = item.risingVph != null;
  const perHour = live ? (item.risingVph as number) : item.viewsPerHour;
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-black/60 px-2 py-0.5 text-[10px] font-bold text-emerald-400 backdrop-blur-sm">
      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M3 17l6-6 4 4 8-8M14 7h7v7" />
      </svg>
      +{formatCount(perHour)}/hr{live ? " now" : ""}
    </span>
  );
}

export function TrendCard({
  item,
  onOpen,
}: {
  item: TrendingSlideshow;
  onOpen: () => void;
}) {
  return (
    <button type="button" onClick={onOpen} className="group block text-left">
      <div className="relative aspect-9/16 overflow-hidden rounded-2xl ring-1 ring-white/10 transition-all duration-300 group-hover:-translate-y-1 group-hover:shadow-xl group-hover:shadow-accent/15 group-hover:ring-accent/50">
        <TrendCover
          item={item}
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
          <VelocityChip item={item} />
        </span>
        <div className="absolute inset-x-2.5 bottom-2 flex items-center gap-3 text-[11px] font-bold text-white">
          <span className="inline-flex items-center gap-1">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
              <path d="M8 5v14l11-7z" />
            </svg>
            {formatCount(item.views24h)}
          </span>
          {item.postedAgoHours <= HOT_HOURS ? (
            <HotTodayChip />
          ) : (
            <span className="text-white/60">{agoLabel(item.postedAgoHours)}</span>
          )}
        </div>
      </div>
      <p className="mt-2 line-clamp-1 text-sm font-semibold text-white">{item.title}</p>
      <p className="mt-0.5 line-clamp-1 text-xs text-white/40">
        {item.author} · {item.hookType ?? item.nicheLabel ?? item.niche}
      </p>
    </button>
  );
}

function Sparkline({ history }: { history: number[] }) {
  const min = Math.min(...history);
  const max = Math.max(...history);
  const range = Math.max(1, max - min);
  const pts = history
    .map(
      (v, i) =>
        `${((i / (history.length - 1)) * 196 + 2).toFixed(1)},${(40 - ((v - min) / range) * 34).toFixed(1)}`,
    )
    .join(" ");
  const [lastX, lastY] = pts.split(" ").pop()!.split(",");
  return (
    <svg viewBox="0 0 200 44" className="h-11 w-full" aria-hidden>
      <polyline
        points={pts}
        fill="none"
        stroke="#34d399"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx={lastX} cy={lastY} r="3" fill="#34d399" />
    </svg>
  );
}

// The Generator's draft-restore slot (Generator.tsx DRAFT_KEY): it reads this
// on mount, prefills the form, and deletes it.
const GENERATOR_DRAFT_KEY = "slideshowai_draft";

export function TrendDetail({
  item,
  onClose,
}: {
  item: TrendingSlideshow | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "remixing" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");

  const remix = async () => {
    if (!item || state === "remixing") return;
    setState("remixing");
    setErrorMsg("");
    try {
      const res = await fetch("/api/trends/remix", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: item.id }),
      });
      const data = (await res.json()) as {
        prompt?: string;
        slides?: string;
        niche?: string;
        format?: unknown;
        error?: string;
      };
      if (!res.ok || !data.prompt) {
        throw new Error(data.error || "Remix failed — try again.");
      }
      localStorage.setItem(
        GENERATOR_DRAFT_KEY,
        JSON.stringify({
          prompt: data.prompt,
          niche: data.niche,
          slides: data.slides,
          // The trend's format recipe + one-click flow: the Generator sends
          // `format` with /api/generate and starts generating on arrival.
          format: data.format,
          autostart: "true",
        }),
      );
      router.push("/dashboard");
    } catch (e) {
      setState("error");
      setErrorMsg(e instanceof Error ? e.message : "Remix failed — try again.");
    }
  };

  return (
    <Modal open={!!item} onClose={onClose} title={item?.title} width="max-w-xl">
      {item && (
        <div className="sm:flex sm:gap-5">
          <div className="relative mx-auto aspect-9/16 w-40 shrink-0 overflow-hidden rounded-xl ring-1 ring-white/10 sm:mx-0">
            <TrendCover item={item} className="absolute inset-0 h-full w-full object-cover" />
            <span className="absolute left-2 top-2 grid h-7 min-w-7 place-items-center rounded-full bg-accent px-1.5 text-xs font-extrabold text-white">
              #{item.rank}
            </span>
          </div>

          <div className="mt-4 min-w-0 flex-1 sm:mt-0">
            <div className="flex flex-wrap items-center gap-2 text-xs font-semibold">
              {item.postedAgoHours <= HOT_HOURS && <HotTodayChip />}
              {(item.nicheMultiple ?? 0) >= 2 && (
                <span className="rounded-full bg-emerald-400/10 px-2.5 py-1 text-emerald-300">
                  {Math.round(item.nicheMultiple!)}x niche average
                </span>
              )}
              {item.hookType && (
                <span className="rounded-full bg-white/[0.06] px-2.5 py-1 text-white/70">
                  {item.hookType}
                </span>
              )}
              <span className="rounded-full bg-white/[0.06] px-2.5 py-1 text-white/70">
                {formatCount(item.views24h)} views
              </span>
              <VelocityChip item={item} />
            </div>
            <p className="mt-2 text-xs text-white/35">
              {item.author} · {item.nicheLabel ?? item.niche} ·{" "}
              {item.medium && item.medium !== "none" ? `sells: ${item.medium} · ` : ""}
              {item.slideCount > 0 ? `${item.slideCount} slides · ` : ""}
              {formatCount(item.likes)} likes · {agoLabel(item.postedAgoHours)}
            </p>

            {(item.history?.length ?? 0) >= 2 && (
              <div className="mt-3 rounded-xl bg-white/[0.04] p-3">
                <div className="flex items-baseline justify-between">
                  <span className="text-[11px] font-medium text-white/35">
                    Views across refreshes
                  </span>
                  <span className="text-xs font-bold text-emerald-400">
                    +{formatCount(item.viewsPerHour)}/hr
                  </span>
                </div>
                <Sparkline history={item.history!} />
              </div>
            )}

            <div className="mt-4 rounded-xl bg-accent/[0.08] p-3.5 ring-1 ring-accent/20">
              <p className="text-[11px] font-bold uppercase tracking-wider text-accent-text">
                Why it works
              </p>
              <p className="mt-1 text-sm leading-relaxed text-white/70">
                {item.whyItWorks}
              </p>
            </div>

            {item.anatomy && item.anatomy.length > 0 && (
              <div className="mt-4">
                <p className="text-[11px] font-bold uppercase tracking-wider text-white/35">
                  Format anatomy
                </p>
                <div className="mt-2 flex flex-col gap-1.5">
                  {item.anatomy.map((b) => (
                    <div key={b.slides} className="flex items-center gap-2.5">
                      <span className="w-11 shrink-0 rounded-md bg-white/[0.06] py-0.5 text-center text-[11px] font-semibold text-white/60">
                        {b.slides}
                      </span>
                      <span className="min-w-0 text-[13px] leading-snug text-white/70">
                        {b.beat}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="mt-5 flex flex-col gap-2 sm:flex-row">
              <button
                type="button"
                onClick={() => void remix()}
                disabled={state === "remixing"}
                className="flex-1 rounded-full bg-accent px-5 py-3 text-sm font-bold text-white shadow-lg shadow-accent/30 transition-all hover:brightness-110 active:scale-[0.98] disabled:cursor-wait disabled:opacity-70"
              >
                {state === "remixing"
                  ? "Remixing for your business…"
                  : "Remix this trend"}
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
            {state === "error" && (
              <p className="mt-2 text-xs text-red-400/80">{errorMsg}</p>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}
