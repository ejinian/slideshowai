"use client";

import { formatCount, type TrendingSlideshow } from "@/lib/mock-data";
import { PROVEN_POSTS, type TrendTopic } from "@/lib/trend-topics";
import { Sparkline, TrendCover, agoLabel } from "./trend-parts";

/* TikTok Studio's Inspiration → Trending layout, in our palette: a ranked
   table of topics (views, momentum, the posts that prove it) and a detail
   panel with the big view chart. Rows are FORMATS — see lib/trend-topics.ts
   for why that's the honest unit at our sample size. */

// TikTok medals the top three. Struck-metal treatment lives in globals.css
// (.rank-medal — bevel, halo, and a staggered shine sweep); ranks 4+ stay a
// quiet chip so the podium keeps its hierarchy.
const MEDAL: Record<number, string> = {
  1: "rank-medal rank-medal-1",
  2: "rank-medal rank-medal-2",
  3: "rank-medal rank-medal-3",
};

function RankBadge({ rank }: { rank: number }) {
  const medal = MEDAL[rank];
  return (
    <span
      className={`grid h-6 w-6 shrink-0 place-items-center rounded-md text-[11px] font-extrabold ${
        medal ?? "bg-white/[0.06] text-white/40"
      }`}
    >
      {rank}
    </span>
  );
}

// Says out loud why this row outranks a bigger-but-lonelier one: the format is
// carried by PROVEN_POSTS+ separate posts, not one lucky hit.
function ProvenChip() {
  return (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-accent/15 px-2 py-0.5 text-[10px] font-bold text-accent-text">
      <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M20 6L9 17l-5-5" />
      </svg>
      Proven
    </span>
  );
}

function FlameViews({ views }: { views: number }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-white/80">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden className="text-white/30">
        <path d="M12 2c.7 3.2-.6 5-2.2 6.7C8.2 10.4 7 12 7 14.5A5.5 5.5 0 0 0 12.5 20c3.3 0 6-2.6 6-6 0-2.5-1.2-4.4-2.6-6.1C14.6 6.2 13.3 4.3 12 2Zm.5 16a3 3 0 0 1-3-3c0-1.4.7-2.3 1.6-3.3.6 1 1.5 1.7 2.4 2.5.7.6 1 1.1 1 1.8a2 2 0 0 1-2 2Z" />
      </svg>
      {formatCount(views)}
    </span>
  );
}

/** The five proof thumbnails in the "Related posts" column. */
function ProofStrip({
  posts,
  limit = 5,
}: {
  posts: TrendingSlideshow[];
  limit?: number;
}) {
  return (
    <div className="flex gap-1.5">
      {posts.slice(0, limit).map((p) => (
        <div
          key={p.id}
          className="relative aspect-9/16 w-11 shrink-0 overflow-hidden rounded-md ring-1 ring-white/10"
        >
          <TrendCover item={p} className="absolute inset-0 h-full w-full object-cover" />
          <div aria-hidden className="absolute inset-x-0 bottom-0 h-1/2 bg-linear-to-t from-black/85 to-transparent" />
          <span className="absolute inset-x-0 bottom-0.5 text-center text-[8px] font-bold text-white">
            {formatCount(p.views)}
          </span>
        </div>
      ))}
    </div>
  );
}

export function TopicsTable({
  topics,
  onOpen,
}: {
  topics: TrendTopic[];
  onOpen: (topic: TrendTopic) => void;
}) {
  return (
    <div className="overflow-hidden rounded-2xl border border-white/[0.08] bg-white/[0.02]">
      {/* Column header — desktop only; the mobile rows are self-labelling. */}
      <div className="hidden grid-cols-[2rem_1fr_7rem_6rem_15rem] items-center gap-4 border-b border-white/[0.06] px-5 py-3 text-[11px] font-bold uppercase tracking-wider text-white/30 lg:grid">
        <span />
        <span>Topics</span>
        <span>Views</span>
        <span>Trend</span>
        <span>Related posts</span>
      </div>

      {topics.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => onOpen(t)}
          className="group flex w-full flex-col gap-3 border-b border-white/[0.05] px-4 py-4 text-left transition-colors last:border-0 hover:bg-white/[0.03] lg:grid lg:grid-cols-[2rem_1fr_7rem_6rem_15rem] lg:items-center lg:gap-4 lg:px-5"
        >
          {/* rank + label share a row on mobile */}
          <div className="flex items-center gap-3 lg:contents">
            <RankBadge rank={t.rank} />
            <div className="min-w-0">
              <div className="flex min-w-0 items-center gap-2">
                <p className="truncate text-[15px] font-semibold text-white">{t.label}</p>
                {t.tier === 0 && <ProvenChip />}
              </div>
              <p
                className={`mt-0.5 truncate text-xs ${
                  // A 1–2 post row is a single outlier, not yet a pattern —
                  // dimmed so the count reads as the caveat it is.
                  t.tier === 2 ? "text-white/25" : "text-white/35"
                }`}
              >
                {t.postCount} {t.postCount === 1 ? "post" : "posts"}
                {t.tier === 0 && ` · ${PROVEN_POSTS}+ proven`}
                {t.niches.length > 0 && ` · ${t.niches.slice(0, 2).join(", ")}`}
              </p>
            </div>
          </div>

          {/* meta row on mobile, columns on desktop */}
          <div className="flex items-center gap-4 lg:contents">
            <FlameViews views={t.views} />
            <div className="w-16 lg:w-auto">
              {t.history.length >= 2 ? (
                <Sparkline history={t.history} className="h-7 w-full" />
              ) : (
                <span className="text-[11px] text-white/20">—</span>
              )}
            </div>
          </div>

          <ProofStrip posts={t.posts} />
        </button>
      ))}
    </div>
  );
}

/* ── Topic detail ─────────────────────────────────────────────────────────── */

const fmtDate = (ms: number) =>
  new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric" });

/** Big view-history chart with a real date axis, like TikTok's topic page. */
function TopicChart({ topic }: { topic: TrendTopic }) {
  const h = topic.history;
  if (h.length < 2) {
    return (
      <p className="mt-3 text-xs text-white/30">
        Momentum needs two refreshes — the curve appears once this format has
        been measured again.
      </p>
    );
  }
  const W = 520;
  const H = 130;
  const min = Math.min(...h);
  const max = Math.max(...h);
  const range = Math.max(1, max - min);
  const x = (i: number) => (i / (h.length - 1)) * (W - 8) + 4;
  const y = (v: number) => H - 16 - ((v - min) / range) * (H - 36);
  const line = h.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const area = `${line} ${x(h.length - 1).toFixed(1)},${H - 4} ${x(0).toFixed(1)},${H - 4}`;

  // Timestamps come from the longest member series; fall back to no labels.
  const at = topic.posts.find((p) => (p.historyAt?.length ?? 0) === h.length)?.historyAt;

  return (
    <div className="mt-3">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-32 w-full" aria-hidden>
        <defs>
          <linearGradient id={`tg-${topic.id}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#6366f1" stopOpacity="0.35" />
            <stop offset="1" stopColor="#6366f1" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0, 0.5, 1].map((f) => (
          <line
            key={f}
            x1="0"
            x2={W}
            y1={y(min + f * range)}
            y2={y(min + f * range)}
            stroke="rgba(255,255,255,0.06)"
            strokeWidth="1"
          />
        ))}
        <polygon points={area} fill={`url(#tg-${topic.id})`} />
        <polyline
          points={line}
          fill="none"
          stroke="#818cf8"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {h.map((v, i) => (
          <circle key={i} cx={x(i)} cy={y(v)} r="2.5" fill="#818cf8" />
        ))}
      </svg>
      <div className="flex justify-between text-[10px] font-medium text-white/25">
        <span>{at ? fmtDate(at[0]) : "earliest refresh"}</span>
        <span>{at ? fmtDate(at[at.length - 1]) : "latest refresh"}</span>
      </div>
    </div>
  );
}

export function TopicDetail({
  topic,
  onBack,
  onOpenPost,
}: {
  topic: TrendTopic;
  onBack: () => void;
  onOpenPost: (post: TrendingSlideshow) => void;
}) {
  return (
    <div>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onBack}
          aria-label="Back to trending topics"
          className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-white/[0.08] text-white/60 transition-colors hover:bg-white/[0.06] hover:text-white"
        >
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>
        <p className="text-sm font-semibold text-white/50">Trending formats</p>
      </div>

      {/* Header card: identity on the left, the view chart on the right. */}
      <div className="mt-4 rounded-2xl border border-white/[0.08] bg-white/[0.02] p-5 sm:p-6 lg:flex lg:items-center lg:gap-8">
        <div className="min-w-0 flex-1">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-accent/15 px-2.5 py-1 text-[11px] font-bold text-accent-text">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
              <path d="M12 2c.7 3.2-.6 5-2.2 6.7C8.2 10.4 7 12 7 14.5A5.5 5.5 0 0 0 12.5 20c3.3 0 6-2.6 6-6 0-2.5-1.2-4.4-2.6-6.1C14.6 6.2 13.3 4.3 12 2Z" />
            </svg>
            Top {topic.rank}
          </span>
          <div className="mt-2.5 flex flex-wrap items-center gap-2.5">
            <h2 className="text-2xl font-bold tracking-tight text-white">
              {topic.label}
            </h2>
            {topic.tier === 0 && <ProvenChip />}
          </div>
          <p className="mt-1.5 text-sm text-white/40">
            {topic.postCount} {topic.postCount === 1 ? "post" : "posts"}
            {topic.niches.length > 0 && ` · ${topic.niches.slice(0, 3).join(", ")}`}
          </p>
          {topic.tier === 2 && (
            <p className="mt-2 text-xs text-white/30">
              Only {topic.postCount === 1 ? "one post" : "a couple of posts"} so
              far — promising, but not yet a proven pattern.
            </p>
          )}
        </div>

        <div className="mt-5 shrink-0 border-t border-white/[0.06] pt-4 lg:mt-0 lg:w-[22rem] lg:border-l lg:border-t-0 lg:pl-8 lg:pt-0">
          <p className="text-xs font-medium text-white/40">Total views</p>
          <p className="text-2xl font-bold text-white">{formatCount(topic.views)}</p>
          {topic.risingVph != null && (
            <p className="mt-0.5 text-xs font-bold text-emerald-400">
              +{formatCount(topic.risingVph)}/hr right now
            </p>
          )}
          <TopicChart topic={topic} />
        </div>
      </div>

      {/* The posts behind the number. */}
      <p className="mt-7 text-[11px] font-bold uppercase tracking-wider text-white/30">
        Posts using this format
      </p>
      <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3 lg:grid-cols-5">
        {topic.posts.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => onOpenPost(p)}
            className="group block text-left"
          >
            <div className="relative aspect-9/16 overflow-hidden rounded-xl ring-1 ring-white/10 transition-all duration-300 group-hover:-translate-y-1 group-hover:ring-accent/50">
              <TrendCover
                item={p}
                className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
              />
              <div aria-hidden className="absolute inset-x-0 bottom-0 h-2/5 bg-linear-to-t from-black/85 to-transparent" />
              <div className="absolute inset-x-2 bottom-1.5 flex items-center gap-2.5 text-[10px] font-bold text-white">
                <span className="inline-flex items-center gap-1">
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                    <path d="M8 5v14l11-7z" />
                  </svg>
                  {formatCount(p.views)}
                </span>
                <span className="inline-flex items-center gap-1 text-white/70">
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                    <path d="M12 21s-7-4.5-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 11c0 5.5-7 10-7 10z" />
                  </svg>
                  {formatCount(p.likes)}
                </span>
              </div>
            </div>
            <p className="mt-2 line-clamp-2 text-[13px] leading-snug text-white/80">
              {p.title}
            </p>
            <p className="mt-0.5 truncate text-[11px] text-white/30">
              {p.author} · {agoLabel(p.postedAgoHours)}
            </p>
          </button>
        ))}
      </div>
    </div>
  );
}
