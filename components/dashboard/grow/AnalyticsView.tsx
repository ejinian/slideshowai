"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { AnalyticsSummary, PostedRow } from "@/lib/analytics/summary";
import type { AccountSummary } from "@/lib/analytics/accountStats";
import { formatCount } from "@/lib/mock-data";
import { EmptyState } from "@/components/ui/EmptyState";

// Real data only. Account stats and per-post views come from hourly scrapes of
// the user's public profile (lib/analytics/scrape.ts); this component fires
// the refresh when the server says the newest snapshot is stale, then
// re-renders the server page. A "—" is an honest gap (unmatched post, private
// account, or the scrape hasn't run), never a placeholder.

type SortCol = "postedAt" | "title" | "status" | "views" | "likes";

const SORT_COLS: { col: SortCol; label: string }[] = [
  { col: "postedAt", label: "Posted" },
  { col: "title", label: "Title" },
  { col: "views", label: "Views" },
  { col: "likes", label: "Likes" },
  { col: "status", label: "Status" },
];

const STATUS_STYLE: Record<PostedRow["status"], { label: string; className: string }> = {
  posted: { label: "Posted", className: "bg-emerald-400/10 text-emerald-300" },
  processing: { label: "Processing", className: "bg-amber-400/10 text-amber-300" },
  failed: { label: "Failed", className: "bg-red-400/10 text-red-300" },
};

const postedLabel = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });

export function AnalyticsView({
  data,
  account,
}: {
  data: AnalyticsSummary;
  account: AccountSummary;
}) {
  const router = useRouter();
  const [sortCol, setSortCol] = useState<SortCol>("postedAt");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [refresh, setRefresh] = useState<"idle" | "running" | "failed" | "private">("idle");

  // The server renders instantly from stored snapshots and tells us whether
  // they're stale; the scrape (up to ~2min worst case) runs here, after paint,
  // and the page re-renders when it lands. Once per mount on purpose —
  // router.refresh() keeps this component mounted, so a completed refresh
  // doesn't re-trigger itself.
  useEffect(() => {
    if (!account.stale || account.status === "disconnected") return;
    let cancelled = false;
    setRefresh("running");
    fetch("/api/analytics/refresh", { method: "POST" })
      .then((r) => r.json())
      .then((j: { refreshed?: boolean; fresh?: boolean; privateAccount?: boolean }) => {
        if (cancelled) return;
        if (j.refreshed) {
          setRefresh(j.privateAccount ? "private" : "idle");
          router.refresh();
        } else {
          setRefresh(j.fresh ? "idle" : "failed");
        }
      })
      .catch(() => {
        if (!cancelled) setRefresh("failed");
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const rows = useMemo(() => {
    return [...data.rows].sort((a, b) => {
      let cmp: number;
      if (sortCol === "views" || sortCol === "likes") {
        // Numeric; an unmatched post ("—") counts as lowest.
        cmp = (a[sortCol] ?? -1) - (b[sortCol] ?? -1);
      } else if (sortCol === "postedAt") {
        cmp = a.postedAt.localeCompare(b.postedAt);
      } else {
        cmp = a[sortCol].localeCompare(b[sortCol]);
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [data.rows, sortCol, sortDir]);

  const toggleSort = (col: SortCol) => {
    if (col === sortCol) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortCol(col);
      setSortDir("desc");
    }
  };

  const hasPosted = data.rows.length > 0;

  const acct = account.stats;
  // A single reading is a dot, not a trend — the chart only earns its space
  // once there are two points to draw a line between.
  const hasTrend = account.trend.length >= 2;

  return (
    <div>
      {/* ── TikTok account ────────────────────────────────────────────
             Followers / likes / per-post views, scraped hourly from the
             user's public profile — TikTok's API doesn't offer them. */}
      {/* Always says something when account stats are absent. An earlier
          version rendered nothing at all unless the status matched one exact
          branch, so a failed lookup left the page silently blank —
          indistinguishable from a broken page. */}
      {account.status === "disconnected" && !acct ? (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-white/[0.03] px-4 py-3 ring-1 ring-white/[0.06]">
          <p className="text-sm text-white/50">
            Connect TikTok to see your follower counts and post views here.
          </p>
          <a
            href="/api/auth/tiktok?return_to=/dashboard/analytics"
            className="shrink-0 rounded-full bg-white/[0.08] px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-white/[0.14]"
          >
            Connect
          </a>
        </div>
      ) : account.status === "pending" && !acct ? (
        <div className="mb-4 rounded-2xl bg-white/[0.03] px-4 py-3 ring-1 ring-white/[0.06]">
          <p className="text-sm text-white/50">
            {refresh === "failed"
              ? "Your TikTok stats couldn't be fetched right now. Your posting stats below are unaffected — this retries on your next visit."
              : "Fetching your TikTok stats — this first load can take a minute."}
          </p>
        </div>
      ) : null}

      {/* A quiet heartbeat while stored numbers are being re-scraped. */}
      {acct && refresh === "running" ? (
        <p className="mb-2 text-xs text-white/30">Updating from TikTok…</p>
      ) : acct && refresh === "failed" ? (
        <p className="mb-2 text-xs text-white/30">
          Showing your last saved numbers — TikTok couldn&apos;t be reached just now.
        </p>
      ) : refresh === "private" ? (
        <p className="mb-2 text-xs text-white/30">
          Your TikTok account is private, so per-post view counts aren&apos;t visible —
          follower stats still update.
        </p>
      ) : null}

      {acct ? (
        <div className="mb-3 grid grid-cols-3 gap-3">
          {[
            { label: "Followers", value: acct.followerCount },
            { label: "Total likes", value: acct.likesCount },
            { label: "Videos", value: acct.videoCount },
          ].map((s) => (
            <div key={s.label} className="rounded-2xl bg-[#141416] p-4 ring-1 ring-white/[0.06]">
              <p className="text-xs font-medium text-white/40">{s.label}</p>
              <p className="mt-1.5 text-2xl font-extrabold tracking-tight text-white">
                {s.value == null ? "—" : formatCount(s.value)}
              </p>
            </div>
          ))}
        </div>
      ) : null}

      {hasTrend ? (
        <div className="mb-4 rounded-2xl bg-[#141416] p-4 ring-1 ring-white/[0.06] sm:p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <p className="text-sm font-bold text-white">Followers</p>
            <p className="text-xs text-white/30">
              Recorded on each visit — TikTok only reports the current number
            </p>
          </div>
          <div className="mt-3 h-48 sm:h-56">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={account.trend} margin={{ top: 4, right: 4, bottom: 0, left: -22 }}>
                <defs>
                  <linearGradient id="followersFill" x1="0" y1="0" x2="0" y2="1">
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
                  minTickGap={24}
                />
                <YAxis
                  tick={{ fill: "rgba(255,255,255,0.35)", fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                  // Follower counts rarely start near zero, so a 0-based axis
                  // flattens real movement into a straight line.
                  domain={["dataMin - 5", "dataMax + 5"]}
                  tickFormatter={(v: number) => formatCount(Math.round(v))}
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
                  formatter={(value) => [`${Number(value ?? 0).toLocaleString()}`, "followers"]}
                />
                <Area
                  type="monotone"
                  dataKey="followers"
                  stroke="#6366f1"
                  strokeWidth={2}
                  fill="url(#followersFill)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      ) : null}

      {/* stat cards */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {data.stats.map((s) => (
          <div key={s.label} className="rounded-2xl bg-[#141416] p-4 ring-1 ring-white/[0.06]">
            <p className="text-xs font-medium text-white/40">{s.label}</p>
            <p className="mt-1.5 text-2xl font-extrabold tracking-tight text-white">
              {s.value}
            </p>
            {/* A delta is shown only when there's a real baseline to compare
                against — the first 30 days have nothing behind them, and
                "+100%" from a single post is noise dressed as insight. */}
            {s.delta != null ? (
              <p
                className={`mt-1 inline-flex items-center gap-1 text-xs font-semibold ${
                  s.delta >= 0 ? "text-emerald-400" : "text-red-400"
                }`}
              >
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden className={s.delta >= 0 ? "" : "rotate-180"}>
                  <path d="M12 19V5M5 12l7-7 7 7" />
                </svg>
                {Math.abs(s.delta).toFixed(0)}%
                <span className="font-normal text-white/30">vs prev 30d</span>
              </p>
            ) : s.hint ? (
              <p className="mt-1 text-xs text-white/30">{s.hint}</p>
            ) : null}
          </div>
        ))}
      </div>

      {/* posting cadence */}
      <div className="mt-4 rounded-2xl bg-[#141416] p-4 ring-1 ring-white/[0.06] sm:p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <p className="text-sm font-bold text-white">Posts published — last 30 days</p>
          <p className="text-xs text-white/30">
            Per-post views and likes are in the table below
          </p>
        </div>
        <div className="mt-3 h-56 sm:h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data.activity} margin={{ top: 4, right: 4, bottom: 0, left: -22 }}>
              <CartesianGrid stroke="rgba(255,255,255,0.05)" vertical={false} />
              <XAxis
                dataKey="date"
                tick={{ fill: "rgba(255,255,255,0.35)", fontSize: 11 }}
                tickLine={false}
                axisLine={false}
                interval={6}
              />
              <YAxis
                tick={{ fill: "rgba(255,255,255,0.35)", fontSize: 11 }}
                tickLine={false}
                axisLine={false}
                // Posts are whole numbers; the default ticks produced 0.5 / 1.5
                // gridlines on a low-volume account.
                allowDecimals={false}
              />
              <Tooltip
                cursor={{ fill: "rgba(255,255,255,0.05)" }}
                contentStyle={{
                  background: "#1a1a1c",
                  border: "1px solid rgba(255,255,255,0.08)",
                  borderRadius: 12,
                  color: "#fff",
                  fontSize: 12,
                }}
                formatter={(value) => [
                  `${Number(value ?? 0)} ${Number(value) === 1 ? "post" : "posts"}`,
                  "",
                ]}
              />
              <Bar dataKey="posts" fill="#6366f1" radius={[3, 3, 0, 0]} maxBarSize={14} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* posted slideshows */}
      <div className="mt-4 overflow-hidden rounded-2xl bg-[#141416] ring-1 ring-white/[0.06]">
        {!hasPosted ? (
          <EmptyState
            title={data.connected ? "No posts yet" : "Connect TikTok to start posting"}
            description={
              data.connected
                ? "Post a slideshow and it'll show up here with its status."
                : "Once your account is connected and slideshows go out, they'll be listed here."
            }
          />
        ) : (
          <>
            {/* Phones get a stacked list — the table's min width put the later
                columns off-screen at 375px. */}
            <div className="sm:hidden">
              <div className="no-scrollbar flex items-center gap-1 overflow-x-auto border-b border-white/[0.06] px-3 py-2">
                <span className="shrink-0 pr-1 text-[11px] font-semibold uppercase tracking-wide text-white/30">
                  Sort
                </span>
                {SORT_COLS.map(({ col, label }) => {
                  const active = col === sortCol;
                  return (
                    <button
                      key={col}
                      type="button"
                      aria-pressed={active}
                      onClick={() => toggleSort(col)}
                      className={`flex min-h-9 shrink-0 items-center gap-1 rounded-full px-3 text-xs font-semibold transition-colors ${
                        active ? "bg-white/[0.10] text-white" : "text-white/40 active:text-white/70"
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
                        className={`transition-all ${
                          active ? (sortDir === "asc" ? "rotate-180 opacity-100" : "opacity-100") : "opacity-0"
                        }`}
                      >
                        <path d="M6 9l6 6 6-6" />
                      </svg>
                    </button>
                  );
                })}
              </div>
              <ul className="divide-y divide-white/[0.06]">
                {rows.map((r) => (
                  <li key={r.id} className="flex items-center gap-3 px-3 py-3">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={r.thumbnail}
                      alt=""
                      className="h-14 w-10 shrink-0 rounded-md object-cover ring-1 ring-white/[0.06]"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-white">{r.title}</p>
                      <p className="mt-0.5 text-xs text-white/35">
                        {postedLabel(r.postedAt)}
                        {r.views != null ? (
                          <span className="text-white/50">
                            {" · "}
                            {formatCount(r.views)} views
                            {r.likes != null ? ` · ${formatCount(r.likes)} likes` : ""}
                          </span>
                        ) : null}
                      </p>
                      {r.status === "failed" && r.failReason ? (
                        <p className="mt-0.5 line-clamp-2 text-xs text-red-300/80">
                          {r.failReason}
                        </p>
                      ) : null}
                    </div>
                    <span
                      className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATUS_STYLE[r.status].className}`}
                    >
                      {STATUS_STYLE[r.status].label}
                    </span>
                  </li>
                ))}
              </ul>
            </div>

            <table className="hidden w-full text-sm sm:table">
              <thead>
                <tr className="border-b border-white/[0.06] text-left text-xs text-white/35">
                  <th className="py-3 pl-5 pr-3 font-medium">Slideshow</th>
                  {SORT_COLS.filter((c) => c.col !== "title").map(({ col, label }) => (
                    <th key={col} className="px-3 py-3 font-medium">
                      <button
                        type="button"
                        onClick={() => toggleSort(col)}
                        className="inline-flex items-center gap-1 transition-colors hover:text-white"
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
                          className={`transition-all ${
                            col === sortCol
                              ? sortDir === "asc"
                                ? "rotate-180 opacity-100"
                                : "opacity-100"
                              : "opacity-0"
                          }`}
                        >
                          <path d="M6 9l6 6 6-6" />
                        </svg>
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.06]">
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td className="py-3 pl-5 pr-3">
                      <div className="flex items-center gap-3">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={r.thumbnail}
                          alt=""
                          className="h-14 w-10 shrink-0 rounded-md object-cover ring-1 ring-white/[0.06]"
                        />
                        <div className="min-w-0">
                          <p className="truncate font-medium text-white">{r.title}</p>
                          {r.status === "failed" && r.failReason ? (
                            <p className="mt-0.5 truncate text-xs text-red-300/80">
                              {r.failReason}
                            </p>
                          ) : null}
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-3 text-white/50">{postedLabel(r.postedAt)}</td>
                    <td className="px-3 py-3 tabular-nums text-white/70">
                      {r.views == null ? <span className="text-white/25">—</span> : formatCount(r.views)}
                    </td>
                    <td className="px-3 py-3 tabular-nums text-white/70">
                      {r.likes == null ? <span className="text-white/25">—</span> : formatCount(r.likes)}
                    </td>
                    <td className="px-3 py-3">
                      <span
                        className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATUS_STYLE[r.status].className}`}
                      >
                        {STATUS_STYLE[r.status].label}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>
    </div>
  );
}
