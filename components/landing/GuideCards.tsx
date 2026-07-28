"use client";

import Link from "next/link";
import type { GuideMeta } from "@/lib/guides";

// Each card leads with a saturated gradient tile carrying the title — the
// blog-index pattern where the artwork IS the headline, so a card reads at a
// glance instead of as three lines of grey type. Byline, title and summary sit
// underneath, unboxed.
const TILES = [
  "from-[#8b5cf6] to-[#6366f1]",
  "from-[#fb923c] to-[#ea580c]",
  "from-[#f472b6] to-[#db2777]",
  "from-[#fb7185] to-[#dc2626]",
  "from-[#38bdf8] to-[#0ea5e9]",
  "from-[#34d399] to-[#059669]",
];

export function GuideCards({ guides }: { guides: GuideMeta[] }) {
  return (
    <div className="mt-6 grid gap-x-6 gap-y-9 sm:grid-cols-2">
      {guides.map((g, i) => (
        <Link key={g.slug} href={`/guides/${g.slug}`} className="group block">
          {/* headline tile */}
          <div
            className={`grid aspect-16/10 place-items-center overflow-hidden rounded-2xl bg-linear-to-br p-6 transition-transform duration-300 group-hover:-translate-y-0.5 ${
              TILES[i % TILES.length]
            }`}
          >
            <span className="font-tiktok text-balance text-center text-lg font-extrabold leading-tight text-black/80 sm:text-xl">
              {g.title}
            </span>
          </div>

          {/* byline */}
          <div className="mt-3.5 flex items-center gap-2">
            <span aria-hidden className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-white/10">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none">
                <rect x="8" y="3.5" width="10" height="17" rx="2.6" fill="#a5b4fc" opacity="0.45" transform="translate(-5 0.6) rotate(-12 12 12)" />
                <rect x="8" y="3.5" width="10" height="17" rx="2.6" fill="#c4b5fd" />
              </svg>
            </span>
            <span className="text-[13px] font-medium text-white/70">SlideLabsAI</span>
            <span aria-hidden className="text-white/15">·</span>
            <span className="text-[13px] text-white/35">{g.minutes} min</span>
          </div>

          <p className="mt-2 text-[15px] font-semibold leading-snug text-white transition-colors group-hover:text-accent-text">
            {g.title}
          </p>
          {g.description && (
            <p className="mt-1.5 text-[13px] leading-relaxed text-white/45">
              {g.description}
            </p>
          )}
        </Link>
      ))}
    </div>
  );
}
