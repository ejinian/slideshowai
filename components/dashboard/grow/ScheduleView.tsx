"use client";

import { useEffect, useMemo, useState } from "react";
import {
  MOCK_ACCOUNTS,
  MOCK_GENERATED,
  MOCK_SCHEDULED,
  schedulePost,
  type GeneratedSlideshow,
} from "@/lib/mock-data";
import { Modal } from "@/components/ui/Modal";
import { Dropdown } from "@/components/ui/Dropdown";
import { Skeleton } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";

const CAPTION_MAX = 2200;
const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

interface Post {
  id: string;
  slideshowId: string;
  date: string; // yyyy-mm-dd
  time: string; // HH:MM
  caption: string;
  accountId: string;
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

const slideshowById = (id: string): GeneratedSlideshow | undefined =>
  MOCK_GENERATED.find((s) => s.id === id);

export function ScheduleView() {
  const [posts, setPosts] = useState<Post[] | null>(null); // null = loading
  const [weekOffset, setWeekOffset] = useState(0);
  const [view, setView] = useState<"calendar" | "list">("calendar");
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [connectOpen, setConnectOpen] = useState(false);
  const [today, setToday] = useState("");

  // Dates are materialized client-side after mount: keeps SSR deterministic
  // and gives the skeleton state a real render.
  useEffect(() => {
    const monday = mondayOf(new Date());
    const t = setTimeout(() => {
      setToday(iso(new Date()));
      setPosts(
        MOCK_SCHEDULED.map((p) => ({
          id: p.id,
          slideshowId: p.slideshowId,
          date: iso(addDays(monday, p.dayOffset)),
          time: p.time,
          caption: p.caption,
          accountId: p.accountId,
        })),
      );
    }, 500);
    return () => clearTimeout(t);
  }, []);

  const week = useMemo(() => {
    const monday = mondayOf(addDays(new Date(), weekOffset * 7));
    return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
  }, [weekOffset]);

  const weekPosts = useMemo(() => {
    if (!posts) return [];
    const days = new Set(week.map(iso));
    return posts
      .filter((p) => days.has(p.date))
      .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  }, [posts, week]);

  const weekLabel = `${week[0].toLocaleDateString("en-US", { month: "short", day: "numeric" })} – ${week[6].toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;

  const account = MOCK_ACCOUNTS[0];

  return (
    <div>
      {/* connected accounts */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-white/[0.02] p-4 ring-1 ring-white/[0.05]">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-xs font-semibold uppercase tracking-wider text-white/30">
            Accounts
          </span>
          <span className="flex items-center gap-2 rounded-full bg-white/[0.06] py-1.5 pl-1.5 pr-3.5">
            <span className="grid h-7 w-7 place-items-center rounded-full bg-linear-to-br from-accent to-fuchsia-500 text-[11px] font-bold text-white">
              {account.displayName.charAt(0)}
            </span>
            <span className="text-sm font-semibold text-white">{account.handle}</span>
            <span className="flex items-center gap-1 text-[11px] font-medium text-emerald-400">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
              Connected
            </span>
          </span>
        </div>
        <button
          type="button"
          onClick={() => setConnectOpen(true)}
          className="rounded-full bg-white/[0.08] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-white/[0.14]"
        >
          Connect TikTok
        </button>
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
          {/* view toggle */}
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
        {posts === null ? (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
            {Array.from({ length: 7 }, (_, i) => (
              <Skeleton key={i} className="h-48 rounded-2xl" />
            ))}
          </div>
        ) : view === "calendar" ? (
          <>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
              {week.map((day, i) => {
                const dayIso = iso(day);
                const dayPosts = weekPosts.filter((p) => p.date === dayIso);
                const isToday = dayIso === today;
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
                        <PostCard key={p.id} post={p} compact />
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
              <PostCard key={p.id} post={p} />
            ))}
          </div>
        )}
      </div>

      <SchedulePostDialog
        open={scheduleOpen}
        onClose={() => setScheduleOpen(false)}
        defaultDate={today}
        onScheduled={(p) => setPosts((cur) => [...(cur ?? []), p])}
      />

      {/* Connect TikTok — clearly-labeled OAuth stub */}
      <Modal
        open={connectOpen}
        onClose={() => setConnectOpen(false)}
        title="Connect a TikTok account"
        width="max-w-md"
      >
        <ol className="space-y-3">
          {[
            "You'll be sent to TikTok to sign in and approve SlideShowAI.",
            "TikTok hands back a secure token — we never see your password.",
            "Scheduled posts publish through TikTok's official Content Posting API.",
          ].map((step, i) => (
            <li key={i} className="flex gap-3 text-sm leading-relaxed text-white/60">
              <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-white/[0.06] text-xs font-bold text-white">
                {i + 1}
              </span>
              {step}
            </li>
          ))}
        </ol>
        <button
          type="button"
          disabled
          className="mt-5 w-full cursor-not-allowed rounded-full bg-white/[0.08] px-5 py-3 text-sm font-bold text-white/40"
        >
          Continue to TikTok (stub — OAuth not wired yet)
        </button>
      </Modal>
    </div>
  );
}

function PostCard({ post, compact = false }: { post: Post; compact?: boolean }) {
  const show = slideshowById(post.slideshowId);
  if (compact) {
    return (
      <div className="rounded-xl bg-[#1c1c1e] p-1.5 ring-1 ring-white/[0.06]">
        <div className="flex gap-2">
          {show && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={show.thumbnail} alt="" loading="lazy" decoding="async" className="h-12 w-8 shrink-0 rounded-md object-cover" />
          )}
          <div className="min-w-0">
            <p className="text-[11px] font-bold text-accent-text">{post.time}</p>
            <p className="line-clamp-2 text-[11px] leading-tight text-white/60">
              {post.caption}
            </p>
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-4 rounded-2xl bg-[#141416] p-3 ring-1 ring-white/[0.06]">
      {show && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={show.thumbnail} alt="" loading="lazy" decoding="async" className="h-16 w-11 shrink-0 rounded-lg object-cover" />
      )}
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-white">{show?.title ?? "Slideshow"}</p>
        <p className="mt-0.5 line-clamp-1 text-xs text-white/40">{post.caption}</p>
      </div>
      <div className="shrink-0 text-right">
        <p className="text-sm font-bold text-accent-text">{post.time}</p>
        <p className="text-xs text-white/35">
          {new Date(`${post.date}T00:00:00`).toLocaleDateString("en-US", {
            weekday: "short",
            month: "short",
            day: "numeric",
          })}
        </p>
      </div>
    </div>
  );
}

function SchedulePostDialog({
  open,
  onClose,
  defaultDate,
  onScheduled,
}: {
  open: boolean;
  onClose: () => void;
  defaultDate: string;
  onScheduled: (post: Post) => void;
}) {
  const [slideshowId, setSlideshowId] = useState<string | null>(null);
  const [date, setDate] = useState("");
  const [time, setTime] = useState("09:00");
  const [caption, setCaption] = useState("");
  const [accountId, setAccountId] = useState(MOCK_ACCOUNTS[0].id);
  const [saving, setSaving] = useState(false);

  // Untouched field falls back to today — no effect needed to sync it.
  const effectiveDate = date || defaultDate;

  const valid = slideshowId && effectiveDate && time && !saving;

  const submit = async () => {
    if (!valid || !slideshowId) return;
    setSaving(true);
    const input = { slideshowId, date: effectiveDate, time, caption, accountId };
    await schedulePost(input);
    onScheduled({ id: `local-${date}-${time}-${slideshowId}`, ...input });
    setSaving(false);
    onClose();
    setSlideshowId(null);
    setCaption("");
  };

  return (
    <Modal open={open} onClose={onClose} title="Schedule a post" width="max-w-xl">
      {/* pick a generated slideshow */}
      <p className="text-xs font-semibold uppercase tracking-wider text-white/30">
        Slideshow
      </p>
      <div className="no-scrollbar -mx-1 mt-2 flex gap-2.5 overflow-x-auto px-1 pb-1">
        {MOCK_GENERATED.map((s) => {
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
                <img src={s.thumbnail} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" />
              </span>
              <span className="mt-1 line-clamp-1 block text-[11px] font-medium text-white/60">
                {s.title}
              </span>
            </button>
          );
        })}
      </div>

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

      {/* account */}
      <div className="mt-4 flex items-center justify-between gap-3">
        <span className="text-xs font-semibold uppercase tracking-wider text-white/30">
          Post to
        </span>
        <Dropdown
          value={accountId}
          onChange={setAccountId}
          options={MOCK_ACCOUNTS.map((a) => ({ value: a.id, label: a.handle }))}
        />
      </div>

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
