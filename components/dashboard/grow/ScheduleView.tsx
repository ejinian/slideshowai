"use client";

import { useEffect, useMemo, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { EmptyState } from "@/components/ui/EmptyState";

const CAPTION_MAX = 2200;
const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export interface ScheduledPost {
  id: string;
  slideshow_id: string;
  caption: string;
  scheduled_at: string; // ISO
  status: "queued" | "publishing" | "posted" | "failed";
  fail_reason: string | null;
  posted_at: string | null;
}

export interface PickableSlideshow {
  id: string;
  title: string;
  created_at: string;
}

// Local-date ISO (yyyy-mm-dd). toISOString() would shift to UTC and put
// evening users on tomorrow's date.
const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

function mondayOf(base: Date): Date {
  const d = new Date(base);
  const day = (d.getDay() + 6) % 7; // 0 = Monday
  d.setDate(d.getDate() - day);
  d.setHours(0, 0, 0, 0);
  return d;
}

function addDays(base: Date, days: number): Date {
  const d = new Date(base);
  d.setDate(d.getDate() + days);
  return d;
}

const localDate = (isoTs: string) => iso(new Date(isoTs));
const localTime = (isoTs: string) =>
  new Date(isoTs).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

const STATUS_STYLES: Record<ScheduledPost["status"], string> = {
  queued: "bg-white/[0.08] text-white/60",
  publishing: "bg-amber-400/15 text-amber-300",
  posted: "bg-emerald-400/15 text-emerald-300",
  failed: "bg-red-400/15 text-red-300",
};

export function ScheduleView({
  connected,
  initialPosts,
  slideshows,
}: {
  connected: boolean;
  initialPosts: ScheduledPost[];
  slideshows: PickableSlideshow[];
}) {
  const [posts, setPosts] = useState<ScheduledPost[]>(initialPosts);
  const [weekOffset, setWeekOffset] = useState(0);
  const [view, setView] = useState<"calendar" | "list">("calendar");
  const [scheduleOpen, setScheduleOpen] = useState(false);
  // `now` stays null through SSR + first client render, then gets set on mount.
  // The server clock is UTC, so deriving "today" server-side puts evening users
  // on tomorrow's date — gating on mount makes every date follow the user's
  // real local time (and avoids a hydration mismatch, since both renders agree
  // on null first).
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => setNow(new Date()), []);
  const today = now ? iso(now) : null;

  const week = useMemo(() => {
    const monday = mondayOf(addDays(now ?? new Date(), weekOffset * 7));
    return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
  }, [now, weekOffset]);

  const weekPosts = useMemo(() => {
    const days = new Set(week.map(iso));
    return posts
      .filter((p) => days.has(localDate(p.scheduled_at)))
      .sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at));
  }, [posts, week]);

  const weekLabel = `${week[0].toLocaleDateString("en-US", { month: "short", day: "numeric" })} – ${week[6].toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;

  const cancel = async (id: string) => {
    const res = await fetch(`/api/schedule/${id}`, { method: "DELETE" });
    if (res.ok) setPosts((cur) => cur.filter((p) => p.id !== id));
  };

  return (
    <div>
      {/* connection state */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-white/[0.02] p-4 ring-1 ring-white/[0.05]">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-xs font-semibold uppercase tracking-wider text-white/30">
            Account
          </span>
          {connected ? (
            <span className="flex items-center gap-2 rounded-full bg-white/[0.06] py-1.5 pl-1.5 pr-3.5">
              <span className="grid h-7 w-7 place-items-center rounded-full bg-linear-to-br from-accent to-fuchsia-500 text-[11px] font-bold text-white">
                T
              </span>
              <span className="text-sm font-semibold text-white">TikTok</span>
              <span className="flex items-center gap-1 text-[11px] font-medium text-emerald-400">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                Connected
              </span>
            </span>
          ) : (
            <span className="text-sm text-white/45">
              No TikTok account connected — scheduled posts need one.
            </span>
          )}
          <a
            href="/guides/how-to-warm-up-a-new-tiktok-account"
            target="_blank"
            rel="noopener"
            className="text-xs font-medium text-white/35 underline decoration-white/20 underline-offset-2 transition-colors hover:text-accent-text"
          >
            New account? Warm it up first
          </a>
        </div>
        {!connected && (
          <a
            href={`/api/auth/tiktok?return_to=${encodeURIComponent("/dashboard/schedule")}`}
            className="rounded-full bg-accent px-4 py-2 text-sm font-bold text-white shadow-lg shadow-accent/30 transition-all hover:brightness-110"
          >
            Connect TikTok
          </a>
        )}
      </div>

      {/* controls */}
      <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            aria-label="Previous week"
            onClick={() => setWeekOffset((w) => w - 1)}
            className="grid h-9 w-9 place-items-center rounded-full bg-white/[0.06] text-white/60 transition-colors hover:bg-white/[0.1] hover:text-white"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M15 18l-6-6 6-6" /></svg>
          </button>
          <span className="min-w-32 text-center text-sm font-bold text-white">
            {weekLabel}
          </span>
          <button
            type="button"
            aria-label="Next week"
            onClick={() => setWeekOffset((w) => w + 1)}
            className="grid h-9 w-9 place-items-center rounded-full bg-white/[0.06] text-white/60 transition-colors hover:bg-white/[0.1] hover:text-white"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M9 6l6 6-6 6" /></svg>
          </button>
          {weekOffset !== 0 && (
            <button
              type="button"
              onClick={() => setWeekOffset(0)}
              className="rounded-full px-3 py-1.5 text-xs font-semibold text-accent-text transition-colors hover:bg-accent/10"
            >
              Today
            </button>
          )}
        </div>

        <div className="flex items-center gap-2">
          <div className="flex rounded-full bg-white/[0.06] p-1">
            {(["calendar", "list"] as const).map((v) => (
              <button
                key={v}
                type="button"
                aria-pressed={view === v}
                onClick={() => setView(v)}
                className={`rounded-full px-3.5 py-1.5 text-xs font-bold capitalize transition-colors ${
                  view === v ? "bg-white text-black" : "text-white/50 hover:text-white"
                }`}
              >
                {v}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setScheduleOpen(true)}
            className="rounded-full bg-accent px-5 py-2.5 text-sm font-bold text-white shadow-lg shadow-accent/30 transition-all hover:brightness-110 active:scale-[0.98]"
          >
            Schedule Post
          </button>
        </div>
      </div>

      {/* calendar / list */}
      <div className="mt-5">
        {view === "calendar" ? (
          <>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
              {week.map((day, i) => {
                const dayIso = iso(day);
                const dayPosts = weekPosts.filter(
                  (p) => localDate(p.scheduled_at) === dayIso,
                );
                const isToday = today !== null && dayIso === today;
                return (
                  <div
                    key={dayIso}
                    className={`min-h-48 rounded-2xl p-2 ring-1 transition-colors ${
                      isToday
                        ? "bg-accent/[0.07] ring-accent/40"
                        : "bg-white/[0.02] ring-white/[0.05]"
                    }`}
                  >
                    <p className="flex items-baseline justify-between px-1 pb-2 pt-1">
                      <span className="text-[11px] font-semibold uppercase tracking-wider text-white/35">
                        {DAY_LABELS[i]}
                      </span>
                      <span
                        className={`text-sm font-bold ${isToday ? "text-accent-text" : "text-white/60"}`}
                      >
                        {day.getDate()}
                      </span>
                    </p>
                    <div className="space-y-2">
                      {dayPosts.map((p) => (
                        <PostCard key={p.id} post={p} onCancel={cancel} compact />
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
            {weekPosts.length === 0 && (
              <p className="mt-4 text-center text-sm text-white/35">
                Nothing scheduled this week —{" "}
                <button
                  type="button"
                  onClick={() => setScheduleOpen(true)}
                  className="font-semibold text-accent-text hover:underline"
                >
                  schedule a post
                </button>
                .
              </p>
            )}
          </>
        ) : weekPosts.length === 0 ? (
          <EmptyState
            title="Nothing scheduled this week"
            description="Consistency wins on TikTok — queue a post and keep the streak alive."
            action={
              <button
                type="button"
                onClick={() => setScheduleOpen(true)}
                className="rounded-full bg-accent px-5 py-2.5 text-sm font-bold text-white shadow-lg shadow-accent/30 transition-all hover:brightness-110"
              >
                Schedule Post
              </button>
            }
          />
        ) : (
          <div className="space-y-2">
            {weekPosts.map((p) => (
              <PostCard key={p.id} post={p} onCancel={cancel} />
            ))}
          </div>
        )}
      </div>

      <SchedulePostDialog
        open={scheduleOpen}
        onClose={() => setScheduleOpen(false)}
        defaultDate={today ?? iso(new Date())}
        connected={connected}
        slideshows={slideshows}
        onScheduled={(p) =>
          setPosts((cur) =>
            [...cur, p].sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at)),
          )
        }
      />
    </div>
  );
}

function StatusChip({ post }: { post: ScheduledPost }) {
  return (
    <span
      title={post.status === "failed" ? (post.fail_reason ?? undefined) : undefined}
      className={`inline-block rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide ${STATUS_STYLES[post.status]}`}
    >
      {post.status}
    </span>
  );
}

function PostCard({
  post,
  onCancel,
  compact = false,
}: {
  post: ScheduledPost;
  onCancel: (id: string) => void;
  compact?: boolean;
}) {
  // Session-authed on-demand render of the slideshow's first slide.
  const thumb = `/api/slideshows/${post.slideshow_id}/render/0`;
  if (compact) {
    return (
      <div className="group/card rounded-xl bg-[#1c1c1e] p-1.5 ring-1 ring-white/[0.06]">
        <div className="flex gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={thumb} alt="" loading="lazy" decoding="async" className="h-12 w-8 shrink-0 rounded-md object-cover" />
          <div className="min-w-0 flex-1">
            <p className="flex items-center justify-between gap-1 text-[11px] font-bold text-accent-text">
              {localTime(post.scheduled_at)}
              <StatusChip post={post} />
            </p>
            <p className="line-clamp-2 text-[11px] leading-tight text-white/60">
              {post.caption || "No caption"}
            </p>
          </div>
        </div>
        {post.status === "queued" && (
          <button
            type="button"
            onClick={() => void onCancel(post.id)}
            className="mt-1 hidden w-full rounded-md py-0.5 text-[10px] font-semibold text-white/30 transition-colors hover:bg-white/[0.06] hover:text-red-300 group-hover/card:block"
          >
            Cancel
          </button>
        )}
      </div>
    );
  }
  return (
    <div className="flex items-center gap-4 rounded-2xl bg-[#141416] p-3 ring-1 ring-white/[0.06]">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={thumb} alt="" loading="lazy" decoding="async" className="h-16 w-11 shrink-0 rounded-lg object-cover" />
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2 text-sm font-semibold text-white">
          {localTime(post.scheduled_at)}
          <StatusChip post={post} />
        </p>
        <p className="mt-0.5 line-clamp-1 text-xs text-white/40">
          {post.caption || "No caption"}
        </p>
        {post.status === "failed" && post.fail_reason && (
          <p className="mt-0.5 line-clamp-1 text-xs text-red-400/80">{post.fail_reason}</p>
        )}
      </div>
      <div className="shrink-0 text-right">
        <p className="text-xs text-white/35">
          {new Date(post.scheduled_at).toLocaleDateString("en-US", {
            weekday: "short",
            month: "short",
            day: "numeric",
          })}
        </p>
        {post.status === "queued" && (
          <button
            type="button"
            onClick={() => void onCancel(post.id)}
            className="mt-1 rounded-full px-2.5 py-1 text-xs font-semibold text-white/40 transition-colors hover:bg-white/[0.06] hover:text-red-300"
          >
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}

function SchedulePostDialog({
  open,
  onClose,
  defaultDate,
  connected,
  slideshows,
  onScheduled,
}: {
  open: boolean;
  onClose: () => void;
  defaultDate: string;
  connected: boolean;
  slideshows: PickableSlideshow[];
  onScheduled: (post: ScheduledPost) => void;
}) {
  const [slideshowId, setSlideshowId] = useState<string | null>(null);
  const [date, setDate] = useState("");
  const [time, setTime] = useState("09:00");
  const [caption, setCaption] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // Untouched field falls back to today — no effect needed to sync it.
  const effectiveDate = date || defaultDate;
  const valid = slideshowId && effectiveDate && time && connected && !saving;

  const submit = async () => {
    if (!valid || !slideshowId) return;
    setSaving(true);
    setError("");
    try {
      const scheduledAt = new Date(`${effectiveDate}T${time}`).toISOString();
      const res = await fetch("/api/schedule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slideshowId, scheduledAt, caption }),
      });
      const data = (await res.json()) as { post?: ScheduledPost; error?: string };
      if (!res.ok || !data.post) throw new Error(data.error || "Scheduling failed.");
      onScheduled(data.post);
      onClose();
      setSlideshowId(null);
      setCaption("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Scheduling failed.");
    }
    setSaving(false);
  };

  return (
    <Modal open={open} onClose={onClose} title="Schedule a post" width="max-w-xl">
      {!connected && (
        <p className="mb-4 rounded-xl bg-amber-400/10 px-3.5 py-2.5 text-sm text-amber-300">
          Connect your TikTok account first — scheduled posts publish through it.
        </p>
      )}

      {/* pick a saved slideshow */}
      <p className="text-xs font-semibold uppercase tracking-wider text-white/30">
        Slideshow
      </p>
      {slideshows.length === 0 ? (
        <p className="mt-2 text-sm text-white/45">
          No saved slideshows yet — generate one first.
        </p>
      ) : (
        <div className="no-scrollbar -mx-1 mt-2 flex gap-2.5 overflow-x-auto px-1 py-1.5">
          {slideshows.map((s) => {
            const active = slideshowId === s.id;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => setSlideshowId(s.id)}
                className={`w-24 shrink-0 text-left transition-all ${active ? "" : "opacity-70 hover:opacity-100"}`}
              >
                <span
                  className={`block aspect-9/16 overflow-hidden rounded-xl transition-all ${
                    active ? "ring-2 ring-accent" : "ring-1 ring-white/[0.08]"
                  }`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={`/api/slideshows/${s.id}/render/0`}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    className="h-full w-full object-cover"
                  />
                </span>
                <span className="mt-1 line-clamp-1 block text-[11px] font-medium text-white/60">
                  {s.title}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* date + time */}
      <div className="mt-4 grid grid-cols-2 gap-3">
        <label className="block">
          <span className="text-xs font-semibold uppercase tracking-wider text-white/30">
            Date
          </span>
          <input
            type="date"
            value={effectiveDate}
            onChange={(e) => setDate(e.target.value)}
            className="mt-1.5 block w-full rounded-xl bg-white/[0.05] px-3.5 py-2.5 text-sm text-white outline-none ring-1 ring-white/[0.08] [color-scheme:dark] focus:ring-2 focus:ring-accent"
          />
        </label>
        <label className="block">
          <span className="text-xs font-semibold uppercase tracking-wider text-white/30">
            Time
          </span>
          <input
            type="time"
            value={time}
            onChange={(e) => setTime(e.target.value)}
            className="mt-1.5 block w-full rounded-xl bg-white/[0.05] px-3.5 py-2.5 text-sm text-white outline-none ring-1 ring-white/[0.08] [color-scheme:dark] focus:ring-2 focus:ring-accent"
          />
        </label>
      </div>

      {/* caption */}
      <label className="mt-4 block">
        <span className="flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wider text-white/30">
            Caption
          </span>
          <span
            className={`text-[11px] font-medium ${
              caption.length > CAPTION_MAX ? "text-red-400" : "text-white/30"
            }`}
          >
            {caption.length} / {CAPTION_MAX}
          </span>
        </span>
        <textarea
          value={caption}
          onChange={(e) => setCaption(e.target.value)}
          rows={3}
          maxLength={CAPTION_MAX}
          placeholder="Hook first. Hashtags last."
          className="mt-1.5 block w-full resize-none rounded-xl bg-white/[0.05] px-3.5 py-2.5 text-sm leading-relaxed text-white outline-none ring-1 ring-white/[0.08] placeholder:text-white/25 focus:ring-2 focus:ring-accent"
        />
      </label>

      <p className="mt-3 text-xs text-white/30">
        Posts publish privately (SELF_ONLY) until the app passes TikTok&apos;s
        audit — same as immediate posting. The queue is checked every ~10
        minutes, so exact minutes are approximate.
      </p>

      {error && <p className="mt-3 text-sm text-red-400/90">{error}</p>}

      <div className="mt-5 flex justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          className="rounded-full px-4 py-2.5 text-sm font-semibold text-white/50 transition-colors hover:text-white"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => void submit()}
          disabled={!valid}
          className="rounded-full bg-accent px-6 py-2.5 text-sm font-bold text-white shadow-lg shadow-accent/30 transition-all hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {saving ? "Scheduling…" : "Schedule"}
        </button>
      </div>
    </Modal>
  );
}
