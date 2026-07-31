"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  BUSINESS_TYPES,
  formatCount,
  getTrendingSlideshows,
  type BusinessType,
  type TrendingFeed,
  type TrendingSlideshow,
} from "@/lib/mock-data";
import { buildTopics } from "@/lib/trend-topics";
import {
  PERIOD_HOURS,
  PERIOD_OPTIONS,
  periodCandidates,
  type TrendPeriod,
} from "@/lib/trend-periods";
import { Modal } from "@/components/ui/Modal";
import { CardGridSkeleton } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { Dropdown } from "@/components/ui/Dropdown";
import { TopicDetail, TopicsTable } from "./TrendTopics";
import {
  HOT_HOURS,
  HotTodayChip,
  Sparkline,
  TrendCover,
  VelocityChip,
  agoLabel,
} from "./trend-parts";

const GRID =
  "grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5";

/* Modeled on TikTok Studio's Inspiration → Trending: entity tabs (Topics /
   Posts), a category rail, and a period selector — instead of the old
   "Best today / Best this week" tabs.

   Those tabs were removed on purpose. They ranked by `views24h`, which was
   really LIFETIME views (see lib/mock-data), so "the day's biggest" surfaced
   3-month-old giants over today's real climbers; and when the 24h window came
   back empty the view silently substituted the whole pool, so a tab labelled
   "today" showed whatever existed. Everything here is now labelled by what it
   actually measures. */

type Entity = "topics" | "posts";
type Period = TrendPeriod;
type PostSort = "views" | "rising";

// Category rail chip. Bare text until selected — a rail of a dozen filled
// pills reads as a dozen competing buttons; TikTok's only fills the active one.
function CategoryChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`shrink-0 whitespace-nowrap rounded-full px-3.5 py-1.5 text-sm transition-colors ${
        active
          ? "bg-white/[0.10] font-semibold text-white"
          : "text-white/45 hover:text-white"
      }`}
    >
      {label}
    </button>
  );
}

// Horizontally scrolling rail with the trailing "›" affordance. Bare-text
// chips don't read as scrollable on their own, so the arrow (and the fade it
// sits on) is what says there's more to the right. Both hide when everything
// already fits.
function CategoryRail({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [more, setMore] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const check = () =>
      setMore(el.scrollWidth - el.clientWidth - el.scrollLeft > 8);
    check();
    el.addEventListener("scroll", check, { passive: true });
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", check);
      ro.disconnect();
    };
  }, []);

  return (
    <div className="relative">
      <div
        ref={ref}
        className="-mx-1 flex items-center gap-1 overflow-x-auto px-1 no-scrollbar"
      >
        {children}
      </div>
      {more && (
        <>
          <div
            aria-hidden
            className="pointer-events-none absolute inset-y-0 right-0 w-16 bg-linear-to-l from-black to-transparent"
          />
          {/* Pointer-only. On touch you swipe the rail, and the opaque button
              landed on top of the chip it was meant to reveal — the fade above
              is affordance enough there. */}
          <button
            type="button"
            aria-label="Scroll categories right"
            onClick={() =>
              ref.current?.scrollBy({ left: 260, behavior: "smooth" })
            }
            className="absolute right-0 top-1/2 hidden h-7 w-7 -translate-y-1/2 place-items-center rounded-full bg-[#1a1a1c] text-white/70 shadow-lg ring-1 ring-white/[0.08] transition-colors hover:text-white sm:grid"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M9 18l6-6-6-6" />
            </svg>
          </button>
        </>
      )}
    </div>
  );
}

const SORT_OPTIONS = [
  { value: "views" as const, label: "Most views" },
  { value: "rising" as const, label: "Climbing fastest" },
];

export function TrendsView({
  initialFeed,
  inspirationFeed,
  defaultNiche,
}: {
  /** Server-fetched feed (live or sample). Absent = client loads the sample. */
  initialFeed?: TrendingFeed | null;
  /** 12-month hall-of-fame feed backing the All-time period (absent = hidden). */
  inspirationFeed?: TrendingFeed | null;
  /** Pre-selects the user's own niche (from onboarding) in the filter bar. */
  defaultNiche?: BusinessType | null;
}) {
  const [feed, setFeed] = useState<TrendingFeed | null>(initialFeed ?? null);
  const [entity, setEntity] = useState<Entity>("topics");
  const [period, setPeriod] = useState<Period>("7d");
  const [sort, setSort] = useState<PostSort>("views");
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(defaultNiche ? [defaultNiche] : []),
  );
  const [selectedMediums, setSelectedMediums] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [openItem, setOpenItem] = useState<TrendingSlideshow | null>(null);
  const [openTopicId, setOpenTopicId] = useState<string | null>(null);

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

  // Single-select: clicking a pill selects ONLY that facet (click again to
  // clear). Multi-select sets left users with stale selections — a pizza post
  // "under Relationships" was really a still-active Food & Dining pill.
  const single =
    (set: (fn: (cur: Set<string>) => Set<string>) => void) => (value: string) =>
      set((cur) => (cur.has(value) ? new Set() : new Set([value])));
  const selectNiche = single(setSelected);
  const toggleMedium = single(setSelectedMediums);
  // The niche rail shows the FULL library catalog. The live charts only track
  // the five business niches, so picking a library-only niche switches to
  // All-time instead of stranding the user on an empty chart.
  const toggleNiche = (niche: string) => {
    if (
      period !== "alltime" &&
      !(BUSINESS_TYPES as readonly string[]).includes(niche) &&
      !selected.has(niche)
    ) {
      setPeriod("alltime");
    }
    setOpenTopicId(null);
    selectNiche(niche);
  };

  // The library (All-time) has OPEN niches + product mediums — its facets are
  // computed from the data, with counts, like a real directory.
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

  // Posts matching the current filters, for a given period. All-time reads the
  // hall-of-fame feed; the live periods read the trends feed.
  const filterFor = useCallback(
    (p: Period) => {
      const src = p === "alltime" ? inspirationFeed : feed;
      if (!src) return [];
      const maxHours = PERIOD_HOURS[p];
      const q = query.trim().toLowerCase();
      return src.items.filter(
        (i) =>
          i.postedAgoHours <= maxHours &&
          (selected.size === 0 || selected.has(i.nicheLabel ?? i.niche)) &&
          (p !== "alltime" ||
            selectedMediums.size === 0 ||
            (i.medium != null && selectedMediums.has(i.medium))) &&
          (!q ||
            i.title.toLowerCase().includes(q) ||
            i.author.toLowerCase().includes(q) ||
            (i.hookType ?? "").toLowerCase().includes(q) ||
            (i.medium ?? "").toLowerCase().includes(q)),
      );
    },
    [feed, inspirationFeed, selected, selectedMediums, query],
  );

  // An empty period is never shown as a dead end — we widen to the next period
  // that actually has posts (7d → 30d → all-time).
  //
  // This is NOT the old silent substitution. That bug kept the label "Best
  // today" while listing older posts, so the UI stated something false. Here
  // the SELECTION itself advances: the period dropdown re-reads "Last 30 days",
  // so what the control says and what the list contains always agree. Widening
  // only — an explicit pick of a wider period is never narrowed.
  const widened = useMemo(() => {
    const hit = periodCandidates(period, !!inspirationFeed)
      .map((p) => ({ period: p, items: filterFor(p) }))
      .find((c) => c.items.length > 0);
    // Everything empty — keep the user's own pick and let the empty states
    // below explain the real reason (a filter, a search, or no data yet).
    return hit ?? { period, items: [] as TrendingSlideshow[] };
  }, [period, filterFor, inspirationFeed]);

  const effectivePeriod = widened.period;
  const filtered = widened.items;

  const activeFeed = effectivePeriod === "alltime" ? (inspirationFeed ?? null) : feed;

  const topics = useMemo(() => buildTopics(filtered), [filtered]);
  const openTopic = topics.find((t) => t.id === openTopicId) ?? null;

  const posts = useMemo(() => {
    const key = (i: TrendingSlideshow) =>
      sort === "rising" ? (i.risingVph ?? -1) : i.views;
    return [...filtered]
      .sort((a, b) => key(b) - key(a) || b.viewsPerHour - a.viewsPerHour)
      .map((item, i) => ({ ...item, rank: i + 1 }));
  }, [filtered, sort]);

  // Says exactly what the current view ranks by — no more "the day's biggest"
  // over a list that wasn't the day's.
  const rankLabel =
    entity === "topics"
      ? "Formats proven across the most posts first, then by total views"
      : sort === "rising"
        ? "Climbing fastest right now — views gained since the last refresh"
        : "Ranked by lifetime views on the post";

  return (
    <div>
      <div className="flex flex-col gap-4">
        {/* Row 1 — entity pills left, controls right (TikTok's tab bar). */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            {(
              [
                { value: "topics" as const, label: "Formats" },
                { value: "posts" as const, label: "Posts" },
              ]
            ).map((tab) => (
              <button
                key={tab.value}
                type="button"
                aria-pressed={entity === tab.value}
                onClick={() => setEntity(tab.value)}
                className={`rounded-full px-4 py-2 text-sm font-semibold transition-colors ${
                  entity === tab.value
                    ? "bg-white text-black"
                    : "bg-white/[0.06] text-white/55 hover:bg-white/[0.1] hover:text-white"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {entity === "posts" && (
              <Dropdown
                value={sort}
                options={SORT_OPTIONS}
                onChange={setSort}
                label="Sort:"
              />
            )}
            <Dropdown
              // The EFFECTIVE period, so the control never claims a window the
              // list isn't actually from (see the widening memo above).
              value={effectivePeriod}
              options={PERIOD_OPTIONS.filter(
                (o) => o.value !== "alltime" || inspirationFeed,
              )}
              onChange={(p) => {
                setOpenTopicId(null);
                setPeriod(p);
              }}
            />
          </div>
        </div>

        {/* Row 2 — category rail. Bare text until selected, no counts: the
            numbers were noise on a rail this wide, and they described the
            hall-of-fame library rather than what's actually on screen. */}
        <CategoryRail>
          <CategoryChip
            label="All categories"
            active={selected.size === 0}
            onClick={() => {
              setOpenTopicId(null);
              setSelected(new Set());
            }}
          />
          {(libraryFacets.niches.length > 0
            ? libraryFacets.niches.map(([niche]) => niche)
            : [...BUSINESS_TYPES]
          ).map((niche) => (
            <CategoryChip
              key={niche}
              label={niche}
              active={selected.has(niche)}
              onClick={() => toggleNiche(niche)}
            />
          ))}
        </CategoryRail>

        {effectivePeriod === "alltime" && libraryFacets.mediums.length > 0 && (
          <CategoryRail>
            <CategoryChip
              label="All products"
              active={selectedMediums.size === 0}
              onClick={() => setSelectedMediums(new Set())}
            />
            {libraryFacets.mediums.slice(0, 14).map(([medium]) => (
              <CategoryChip
                key={medium}
                label={medium}
                active={selectedMediums.has(medium)}
                onClick={() => toggleMedium(medium)}
              />
            ))}
          </CategoryRail>
        )}

        {/* w-full on mobile: `self-start` with no width let the input fall back
            to its intrinsic ~20-character size, so the field was an arbitrary
            214px with the placeholder cut and dead space beside it. */}
        <label className="flex w-full min-w-0 items-center gap-2 self-start rounded-full bg-white/[0.06] px-4 py-2 transition-colors focus-within:bg-white/[0.09] sm:w-72">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden className="shrink-0 text-white/30">
            <circle cx="11" cy="11" r="7" />
            <path d="M21 21l-4.3-4.3" />
          </svg>
          <input
            value={query}
            onChange={(e) => {
              setOpenTopicId(null);
              setQuery(e.target.value);
            }}
            placeholder="Search hooks, authors, formats"
            className="w-full bg-transparent text-sm text-white outline-none placeholder:text-white/25"
          />
        </label>

        {activeFeed && !openTopic && (
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs font-medium text-white/35">
            <span className="relative flex h-1.5 w-1.5 shrink-0">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400" />
            </span>
            {/* Wrapped, not bare: a bare text node is ONE anonymous flex item,
                so at phone widths it couldn't wrap beside the dot and dropped
                to its own line, leaving the dot stranded above it. */}
            <span className="min-w-0 flex-1">{rankLabel}</span>
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
        ) : filtered.length === 0 ? (
          query.trim() ? (
            <EmptyState
              title="Nothing matches that search"
              description="Try a different phrase, or clear the niche filter — new formats land on every refresh."
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
          ) : selected.size > 0 || selectedMediums.size > 0 ? (
            // A filter is the only reachable reason left — the period ladder
            // already widened as far as it could go. Point at the filter, not
            // at the window.
            <EmptyState
              title="Nothing in that niche yet"
              description="The refresh hasn't picked up posts here. Clear the filter to see every format we're tracking."
              action={
                <button
                  type="button"
                  onClick={() => {
                    setSelected(new Set());
                    setSelectedMediums(new Set());
                  }}
                  className="rounded-full bg-white/[0.08] px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-white/[0.14]"
                >
                  Show all niches
                </button>
              }
            />
          ) : (
            // No filters, no search, every period empty: there's genuinely no
            // data yet (fresh install / the trends migration hasn't run).
            <EmptyState
              title="Trends are still coming in"
              description="Once the first refresh lands, the formats winning in your niches show up here."
            />
          )
        ) : entity === "topics" ? (
          openTopic ? (
            <TopicDetail
              topic={openTopic}
              onBack={() => setOpenTopicId(null)}
              onOpenPost={setOpenItem}
            />
          ) : (
            <TopicsTable topics={topics} onOpen={(t) => setOpenTopicId(t.id)} />
          )
        ) : (
          <div className={GRID}>
            {posts.map((item) => (
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
            {formatCount(item.views)}
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

// The Generator's draft-restore slot (Generator.tsx DRAFT_KEY): it reads this
// on mount, prefills the form, and deletes it.
const GENERATOR_DRAFT_KEY = "slidelabsai_draft";

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
          // The trend's format recipe, sent with /api/generate. Deliberately
          // NO autostart: Remix lands you in the composer with the prompt and
          // settings filled in, and you press Generate yourself — a remix is a
          // starting point to edit, not a decision already made (and it spends
          // a credit).
          format: data.format,
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
                {formatCount(item.views)} views
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
