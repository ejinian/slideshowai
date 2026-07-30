"use client";

import { useEffect, useRef, useState } from "react";
import { formatCount, type BusinessType, type TrendingSlideshow } from "@/lib/mock-data";

/* Shared presentational bits for the Trends surface. Extracted so the posts
   grid (TrendsView) and the topics table (TrendTopics) can both use them
   without importing each other. */

// Placeholder for posts whose cover is missing or whose TikTok CDN URL has
// expired (they rot after ~a day; the ingest cache prevents this for new
// posts, but old rows and failed downloads still need a graceful face).
export const NICHE_GRADIENT: Record<BusinessType, string> = {
  "Gym & Fitness": "from-indigo-500/35 to-sky-500/10",
  "E-commerce": "from-fuchsia-500/30 to-indigo-500/10",
  "Local Service": "from-emerald-500/30 to-teal-500/10",
  "B2C App": "from-violet-500/35 to-indigo-500/10",
  "Food & Dining": "from-amber-500/30 to-rose-500/10",
};

const FALLBACK_GRADIENT = "from-indigo-500/30 to-violet-500/10";

export function TrendCover({
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
        className={`absolute inset-0 grid place-items-center bg-linear-to-br ${
          NICHE_GRADIENT[item.niche] ?? FALLBACK_GRADIENT
        }`}
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
export const HOT_HOURS = 24;

// "5h ago" → "2 days ago" → "11 months ago" → "1 year ago". Hours only
// within the first day; big hour counts read absurd on older posts.
export function agoLabel(hours: number): string {
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 61) return days === 1 ? "1 day ago" : `${days} days ago`;
  const months = Math.round(days / 30.44);
  if (months < 12) return `${months} months ago`;
  const years = Math.round(months / 12);
  return years === 1 ? "1 year ago" : `${years} years ago`;
}

export function HotTodayChip() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-amber-400/15 px-2 py-0.5 text-[10px] font-bold text-amber-300">
      <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
        <path d="M12 2c.7 3.2-.6 5-2.2 6.7C8.2 10.4 7 12 7 14.5A5.5 5.5 0 0 0 12.5 20c3.3 0 6-2.6 6-6 0-2.5-1.2-4.4-2.6-6.1C14.6 6.2 13.3 4.3 12 2Zm.5 16a3 3 0 0 1-3-3c0-1.4.7-2.3 1.6-3.3.6 1 1.5 1.7 2.4 2.5.7.6 1 1.1 1 1.8a2 2 0 0 1-2 2Z" />
      </svg>
      Hot today
    </span>
  );
}

// Shows the LIVE climb rate (snapshot delta) when we have one — "+12K/hr now"
// — else the lifetime average since posting.
export function VelocityChip({ item }: { item: TrendingSlideshow }) {
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

/** Compact momentum line — the Trends table's "Trend" column. */
export function Sparkline({
  history,
  className = "h-11 w-full",
  stroke = "#34d399",
}: {
  history: number[];
  className?: string;
  stroke?: string;
}) {
  if (history.length < 2) return null;
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
    <svg viewBox="0 0 200 44" className={className} preserveAspectRatio="none" aria-hidden>
      <polyline
        points={pts}
        fill="none"
        stroke={stroke}
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
      <circle cx={lastX} cy={lastY} r="3" fill={stroke} />
    </svg>
  );
}
