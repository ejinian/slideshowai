"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  ANALYTICS_STATS,
  POSTED_ROWS,
  VIEWS_30D,
  formatCount,
  type PostedRow,
} from "@/lib/mock-data";
import { Skeleton } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";

type SortCol = "postedAt" | "views" | "likes";

export function AnalyticsView() {
  const [loading, setLoading] = useState(true);
  const [sortCol, setSortCol] = useState<SortCol>("postedAt");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  useEffect(() => {
    const t = setTimeout(() => setLoading(false), 550);
    return () => clearTimeout(t);
  }, []);

  const rows = useMemo(() => {
    const sorted = [...POSTED_ROWS].sort((a, b) => {
      const av = a[sortCol];
      const bv = b[sortCol];
      const cmp = typeof av === "string" ? av.localeCompare(bv as string) : (av as number) - (bv as number);
      return sortDir === "asc" ? cmp : -cmp;
    });
    return sorted;
  }, [sortCol, sortDir]);

  const toggleSort = (col: SortCol) => {
    if (col === sortCol) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortCol(col);
      setSortDir("desc");
    }
  };

  if (loading) {
    return (
      <div>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-24 rounded-2xl" />
          ))}
        </div>
        <Skeleton className="mt-4 h-72 rounded-2xl" />
        <Skeleton className="mt-4 h-64 rounded-2xl" />
      </div>
    );
  }

  return (
    <div>
      {/* stat cards */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {ANALYTICS_STATS.map((s) => (
          <div key={s.label} className="rounded-2xl bg-[#141416] p-4 ring-1 ring-white/[0.06]">
            <p className="text-xs font-medium text-white/40">{s.label}</p>
            <p className="mt-1.5 text-2xl font-extrabold tracking-tight text-white">
              {s.value}
            </p>
            <p
              className={`mt-1 inline-flex items-center gap-1 text-xs font-semibold ${
                s.delta >= 0 ? "text-emerald-400" : "text-red-400"
              }`}
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden className={s.delta >= 0 ? "" : "rotate-180"}>
                <path d="M12 19V5M5 12l7-7 7 7" />
              </svg>
              {Math.abs(s.delta).toFixed(1)}%
              <span className="font-normal text-white/30">vs last week</span>
            </p>
          </div>
        ))}
      </div>

      {/* views over 30 days */}
      <div className="mt-4 rounded-2xl bg-[#141416] p-4 ring-1 ring-white/[0.06] sm:p-5">
        <p className="text-sm font-bold text-white">Views — last 30 days</p>
        <div className="mt-3 h-64">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={VIEWS_30D} margin={{ top: 4, right: 4, bottom: 0, left: -14 }}>
              <defs>
                <linearGradient id="viewsFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#6366f1" stopOpacity={0.35} />
                  <stop offset="100%" stopColor="#6366f1" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="rgba(255,255,255,0.05)" vertical={false} />
              <XAxis
                dataKey="date"
                tick={{ fill: "rgba(255,255,255,0.35)", fontSize: 11 }}
                tickLine={false}
                axisLine={false}
                interval={4}
              />
              <YAxis
                tick={{ fill: "rgba(255,255,255,0.35)", fontSize: 11 }}
                tickLine={false}
                axisLine={false}
                tickFormatter={(v: number) => formatCount(v)}
              />
              <Tooltip
                cursor={{ stroke: "rgba(255,255,255,0.15)" }}
                contentStyle={{
                  background: "#1a1a1c",
                  border: "1px solid rgba(255,255,255,0.08)",
                  borderRadius: 12,
                  color: "#fff",
                  fontSize: 12,
                }}
                formatter={(value) => [formatCount(Number(value ?? 0)), "views"]}
              />
              <Area
                type="monotone"
                dataKey="views"
                stroke="#6366f1"
                strokeWidth={2}
                fill="url(#viewsFill)"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* posted slideshows table */}
      <div className="mt-4 overflow-hidden rounded-2xl bg-[#141416] ring-1 ring-white/[0.06]">
        {rows.length === 0 ? (
          <EmptyState
            title="No posts yet"
            description="Once slideshows go out, their performance shows up here."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-130 text-left text-sm">
              <thead>
                <tr className="border-b border-white/[0.06] text-xs text-white/35">
                  <th className="px-4 py-3 font-semibold">Slideshow</th>
                  <SortHeader label="Posted" col="postedAt" current={sortCol} dir={sortDir} onSort={toggleSort} />
                  <SortHeader label="Views" col="views" current={sortCol} dir={sortDir} onSort={toggleSort} />
                  <SortHeader label="Likes" col="likes" current={sortCol} dir={sortDir} onSort={toggleSort} />
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <TableRow key={row.id} row={row} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function SortHeader({
  label,
  col,
  current,
  dir,
  onSort,
}: {
  label: string;
  col: SortCol;
  current: SortCol;
  dir: "asc" | "desc";
  onSort: (col: SortCol) => void;
}) {
  const active = col === current;
  return (
    <th className="px-4 py-3">
      <button
        type="button"
        onClick={() => onSort(col)}
        className={`inline-flex items-center gap-1 text-xs font-semibold transition-colors ${
          active ? "text-white" : "text-white/35 hover:text-white/70"
        }`}
      >
        {label}
        <svg
          width="10"
          height="10"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
          className={`transition-all ${active ? (dir === "asc" ? "rotate-180 opacity-100" : "opacity-100") : "opacity-0"}`}
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
    </th>
  );
}

function TableRow({ row }: { row: PostedRow }) {
  return (
    <tr className="border-b border-white/[0.04] transition-colors last:border-0 hover:bg-white/[0.02]">
      <td className="px-4 py-3">
        <div className="flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={row.thumbnail}
            alt=""
            loading="lazy"
            decoding="async"
            className="h-12 w-8 shrink-0 rounded-md object-cover ring-1 ring-white/[0.08]"
          />
          <span className="font-semibold text-white">{row.title}</span>
        </div>
      </td>
      <td className="px-4 py-3 text-white/50">
        {new Date(`${row.postedAt}T00:00:00`).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
        })}
      </td>
      <td className="px-4 py-3 font-semibold text-white">{formatCount(row.views)}</td>
      <td className="px-4 py-3 text-white/70">{formatCount(row.likes)}</td>
    </tr>
  );
}
