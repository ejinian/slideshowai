"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { AutopilotItem, AutopilotPlan } from "@/lib/autopilot/run";

export interface PanelConnection {
  id: string;
  label: string;
  isDefault: boolean;
}
export interface PanelCollection {
  id: string;
  name: string;
  count: number;
}
export interface PanelItem extends AutopilotItem {
  createdAgo: string;
  runId: string | null;
  positions: number[];
}

const PRIVACY: { value: AutopilotPlan["privacy_level"]; label: string }[] = [
  { value: "SELF_ONLY", label: "Private (only you)" },
  { value: "MUTUAL_FOLLOW_FRIENDS", label: "Friends" },
  { value: "FOLLOWER_OF_CREATOR", label: "Followers" },
  { value: "PUBLIC_TO_EVERYONE", label: "Public" },
];
const SLIDE_COUNTS = [4, 5, 6, 7, 8];
const PENDING = [1, 2, 3, 5];

const STATUS: Record<AutopilotItem["status"], { label: string; cls: string }> = {
  generating: { label: "Generating", cls: "bg-white/[0.08] text-white/60" },
  generated: { label: "Awaiting review", cls: "bg-amber-500/15 text-amber-300" },
  needs_review: { label: "Ready for you", cls: "bg-indigo-500/20 text-indigo-200" },
  approved: { label: "Posted", cls: "bg-emerald-500/15 text-emerald-300" },
  rejected: { label: "Rejected", cls: "bg-white/[0.06] text-white/40" },
  failed: { label: "Failed", cls: "bg-red-500/15 text-red-300" },
};

const pill = (on: boolean) =>
  `rounded-full px-3 py-1.5 text-xs transition-colors ${
    on ? "bg-white text-black" : "bg-white/[0.06] text-white/60 hover:bg-white/[0.1] hover:text-white"
  }`;
const ghost =
  "rounded-full border border-white/10 bg-white/[0.04] px-3.5 py-1.5 text-xs font-medium text-white/70 transition-colors hover:border-white/20 hover:text-white disabled:opacity-40";
const primary =
  "rounded-full bg-white px-4 py-1.5 text-xs font-semibold text-black transition-opacity hover:opacity-90 disabled:opacity-40";

async function call<T>(url: string, init: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...(init.headers ?? {}) } });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

type Mode = "manual" | "assisted" | "auto";
const MODES: { value: Mode; label: string; blurb: string }[] = [
  { value: "manual", label: "Manual", blurb: "You press Generate next and approve each deck." },
  { value: "assisted", label: "Assisted", blurb: "The cron generates and reviews; you approve each deck." },
  { value: "auto", label: "Automatic", blurb: "The cron generates, reviews and posts on its own, within the limits below." },
];
const POSTS_PER_DAY = [1, 2, 3, 4, 5];
const MIN_SCORES = [6, 7, 8, 9];

function fmtIn(ms: number): string {
  if (ms <= 0) return "now";
  const h = Math.floor(ms / 3_600_000);
  const m = Math.round((ms % 3_600_000) / 60_000);
  return h > 0 ? `in ~${h}h ${m}m` : `in ~${m}m`;
}

export function AutopilotPanel({
  plan,
  items,
  connections,
  collections,
  now,
}: {
  plan: AutopilotPlan | null;
  items: PanelItem[];
  connections: PanelConnection[];
  collections: PanelCollection[];
  /** Server time at render — the status line is computed from it, not from Date.now() in render. */
  now: number;
}) {
  const router = useRouter();
  const [connectionId, setConnectionId] = useState<string | null>(
    plan?.connection_id ?? connections.find((c) => c.isDefault)?.id ?? connections[0]?.id ?? null,
  );
  const [collectionId, setCollectionId] = useState<string | null>(plan?.collection_id ?? null);
  const [brief, setBrief] = useState(plan?.brief ?? "");
  const [topics, setTopics] = useState((plan?.topics ?? []).join("\n"));
  const [slideCount, setSlideCount] = useState(plan?.slide_count ?? 5);
  const [privacy, setPrivacy] = useState<AutopilotPlan["privacy_level"]>(plan?.privacy_level ?? "SELF_ONLY");
  const [mode, setMode] = useState<Mode>(plan?.auto_post ? "auto" : plan?.enabled ? "assisted" : "manual");
  const [maxPending, setMaxPending] = useState(plan?.max_pending ?? 2);
  const [postsPerDay, setPostsPerDay] = useState(plan?.posts_per_day ?? 1);
  const [minScore, setMinScore] = useState(plan?.min_score ?? 7);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<string | null>(null); // human-readable progress
  const [error, setError] = useState("");

  const topicList = topics.split("\n").map((t) => t.trim()).filter(Boolean);
  const hasSource = brief.trim().length > 0 || topicList.length > 0;
  const mark = <T,>(set: (v: T) => void) => (v: T) => {
    set(v);
    setDirty(true);
  };

  async function save() {
    await call("/api/admin/autopilot/plan", {
      method: "PUT",
      body: JSON.stringify({
        connection_id: connectionId,
        collection_id: collectionId,
        brief,
        topics: topicList,
        slide_count: slideCount,
        privacy_level: privacy,
        enabled: mode !== "manual",
        auto_post: mode === "auto",
        max_pending: maxPending,
        posts_per_day: postsPerDay,
        min_score: minScore,
      }),
    });
    setDirty(false);
  }

  async function run(fn: () => Promise<void>, label: string) {
    setError("");
    setBusy(label);
    try {
      await fn();
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(null);
    }
  }

  const generate = (topic?: string) =>
    run(async () => {
      if (dirty || !plan) await save();
      setBusy("Writing the deck… usually about a minute");
      const { item } = await call<{ item: AutopilotItem }>("/api/admin/autopilot/run", {
        method: "POST",
        body: JSON.stringify(topic ? { topic } : {}),
      });
      setBusy("Writing the description and reviewing the slides…");
      await call(`/api/admin/autopilot/items/${item.id}`, { method: "POST", body: JSON.stringify({ action: "review" }) });
    }, "Starting…");

  const act = (id: string, action: "review" | "approve" | "reject") =>
    run(async () => {
      await call(`/api/admin/autopilot/items/${id}`, { method: "POST", body: JSON.stringify({ action }) });
    }, action === "approve" ? "Posting to TikTok…" : action === "review" ? "Reviewing…" : "Updating…");
  const privacyLabel = PRIVACY.find((p) => p.value === privacy)?.label ?? privacy;

  const canGenerate = !busy && hasSource && !!connectionId;

  // Automatic-mode status, from the same rows the cron reads.
  const dayAgo = now - 86_400_000;
  const postedToday = items.filter((i) => i.status === "approved" && new Date(i.updated_at).getTime() >= dayAgo).length;
  const ready = items.filter(
    (i) => i.status === "needs_review" && i.review?.verdict === "post" && (i.review?.score ?? 0) >= minScore,
  ).length;
  const nextDue =
    plan?.auto_post && postedToday < postsPerDay
      ? plan.last_posted_at
        ? fmtIn(new Date(plan.last_posted_at).getTime() + (86_400_000 / postsPerDay) * 0.9 - now)
        : "at the next cron tick"
      : null;

  return (
    <div className="mt-6 space-y-6">
      {/* Plan */}
      <section className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-5">
        <div className="grid gap-6 sm:grid-cols-2">
          <Field label="Post from">
            {connections.length === 0 ? (
              <p className="text-sm text-white/40">
                No TikTok account connected.{" "}
                <Link href="/dashboard/accounts" className="text-white underline-offset-2 hover:underline">
                  Connect one
                </Link>{" "}
                first.
              </p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {connections.map((c) => (
                  <button key={c.id} type="button" onClick={() => mark(setConnectionId)(c.id)} className={pill(connectionId === c.id)}>
                    {c.label}
                  </button>
                ))}
              </div>
            )}
          </Field>
          <Field label="Images">
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => mark(setCollectionId)(null)} className={pill(collectionId === null)}>
                Stock photos
              </button>
              {collections.map((c) => (
                <button key={c.id} type="button" onClick={() => mark(setCollectionId)(c.id)} className={pill(collectionId === c.id)}>
                  {c.name} · {c.count}
                </button>
              ))}
            </div>
          </Field>
        </div>

        <Field label="What this account posts — audience, angle, voice" className="mt-6">
          <textarea
            value={brief}
            onChange={(e) => mark(setBrief)(e.target.value)}
            rows={3}
            maxLength={1500}
            placeholder="money and business habits for young entrepreneurs. first person, plain and confident, no hype. every post should leave someone with one thing they can actually do."
            className="w-full resize-y rounded-xl bg-white/[0.04] px-3.5 py-2.5 text-sm text-white outline-none ring-1 ring-white/[0.08] placeholder:text-white/25 focus:ring-2 focus:ring-accent"
          />
          <p className="mt-1 text-[11px] text-white/30">
            With a brief, every new deck gets a freshly invented topic in the style of the examples below. Leave it empty
            to use the list below in order instead.
          </p>
        </Field>

        <Field label={brief.trim() ? "Example hooks — one per line, the style to copy" : "Topics — one per line, used in order"} className="mt-6">
          <textarea
            value={topics}
            onChange={(e) => mark(setTopics)(e.target.value)}
            rows={4}
            placeholder={"4 habits that made me a wealthy entrepreneur\nwhat i wish i knew before my first business\nsigns you're ready to quit your 9 to 5"}
            className="w-full resize-y rounded-xl bg-white/[0.04] px-3.5 py-2.5 text-sm text-white outline-none ring-1 ring-white/[0.08] placeholder:text-white/25 focus:ring-2 focus:ring-accent"
          />
          <p className="mt-1 text-[11px] text-white/30">
            {topicList.length} line{topicList.length === 1 ? "" : "s"}
            {!brief.trim() && plan && topicList.length > 0
              ? ` · next up: "${topicList[plan.next_topic_index % topicList.length]}"`
              : ""}
          </p>
        </Field>

        <div className="mt-6 grid gap-6 sm:grid-cols-2">
          <Field label="Slides">
            <div className="flex flex-wrap gap-2">
              {SLIDE_COUNTS.map((n) => (
                <button key={n} type="button" onClick={() => mark(setSlideCount)(n)} className={pill(slideCount === n)}>
                  {n}
                </button>
              ))}
            </div>
          </Field>
          <Field label="Visibility when posted">
            <div className="flex flex-wrap gap-2">
              {PRIVACY.map((p) => (
                <button key={p.value} type="button" onClick={() => mark(setPrivacy)(p.value)} className={pill(privacy === p.value)}>
                  {p.label}
                </button>
              ))}
            </div>
          </Field>
        </div>

        <Field label="Mode" className="mt-6">
          <div className="flex flex-wrap gap-2">
            {MODES.map((m) => (
              <button key={m.value} type="button" onClick={() => mark(setMode)(m.value)} className={pill(mode === m.value)}>
                {m.label}
              </button>
            ))}
          </div>
          <p className="mt-2 text-[11px] text-white/40">{MODES.find((m) => m.value === mode)?.blurb}</p>
          {mode === "auto" && (
            <div className="mt-4 grid gap-5 sm:grid-cols-3">
              <div>
                <p className="mb-2 text-[11px] text-white/40">Posts per day</p>
                <div className="flex flex-wrap gap-2">
                  {POSTS_PER_DAY.map((n) => (
                    <button key={n} type="button" onClick={() => mark(setPostsPerDay)(n)} className={pill(postsPerDay === n)}>
                      {n}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <p className="mb-2 text-[11px] text-white/40">Post only if the reviewer scores at least</p>
                <div className="flex flex-wrap gap-2">
                  {MIN_SCORES.map((n) => (
                    <button key={n} type="button" onClick={() => mark(setMinScore)(n)} className={pill(minScore === n)}>
                      {n}/10
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <p className="mb-2 text-[11px] text-white/40">Keep ready ahead of time</p>
                <div className="flex flex-wrap gap-2">
                  {PENDING.map((n) => (
                    <button key={n} type="button" onClick={() => mark(setMaxPending)(n)} className={pill(maxPending === n)}>
                      {n}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
          {mode === "assisted" && (
            <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-white/40">
              keep at most
              {PENDING.map((n) => (
                <button key={n} type="button" onClick={() => mark(setMaxPending)(n)} className={pill(maxPending === n)}>
                  {n}
                </button>
              ))}
              waiting for review
            </div>
          )}
        </Field>

        <div className="mt-6 flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => generate()} disabled={!canGenerate} className={primary}>
            {busy ? "Working…" : "Generate next"}
          </button>
          <button type="button" onClick={() => run(save, "Saving…")} disabled={!!busy || !dirty} className={ghost}>
            {dirty ? "Save plan" : "Saved"}
          </button>
          {busy && <span className="text-xs text-white/40">{busy}</span>}
        </div>
        {error && (
          <p className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</p>
        )}
        {plan?.auto_post && !dirty && (
          <p className="mt-3 text-xs text-white/50">
            {postedToday} of {postsPerDay} posted in the last 24h · {ready} ready to post
            {nextDue ? ` · next post ${nextDue}` : " · daily budget used"} · goes out as {privacyLabel}
          </p>
        )}
        {mode !== "manual" && (
          <p className="mt-3 text-[11px] text-white/30">
            Needs a cron-job.org job hitting /api/cron/autopilot?secret=CRON_SECRET every hour. Each tick does one
            step, so the first post lands within the hour and the rest are spaced across the day.
          </p>
        )}
      </section>

      {/* Queue */}
      <section>
        <h2 className="text-sm font-semibold text-white/60">Decks</h2>
        {items.length === 0 ? (
          <p className="mt-3 text-sm text-white/30">Nothing yet. Add a brief or topics and hit Generate next.</p>
        ) : (
          <div className="mt-3 space-y-3">
            {items.map((it) => (
              <ItemCard
                key={it.id}
                item={it}
                busy={!!busy}
                privacyLabel={privacyLabel}
                onAct={act}
                onRegenerate={(t) => generate(t)}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function Field({ label, className = "", children }: { label: string; className?: string; children: React.ReactNode }) {
  return (
    <div className={className}>
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-white/30">{label}</p>
      {children}
    </div>
  );
}

function ItemCard({
  item,
  busy,
  privacyLabel,
  onAct,
  onRegenerate,
}: {
  item: PanelItem;
  busy: boolean;
  privacyLabel: string;
  onAct: (id: string, action: "review" | "approve" | "reject") => void;
  onRegenerate: (topic: string) => void;
}) {
  // Two-step approve, in the card: posting is the one irreversible action here,
  // and the app uses no native dialogs (the admin Refund button works the same way).
  const [confirming, setConfirming] = useState(false);
  const st = STATUS[item.status];
  const review = item.review;
  const canReview = (item.status === "generated" || item.status === "failed") && !!item.slideshow_id;
  return (
    <article className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium ${st.cls}`}>{st.label}</span>
        <span className="text-[11px] text-white/30">{item.createdAgo}</span>
        {review && (
          <span
            className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium ${
              review.verdict === "post" ? "bg-emerald-500/15 text-emerald-300" : "bg-amber-500/15 text-amber-300"
            }`}
          >
            {review.verdict === "post" ? "Reviewer: looks good" : "Reviewer: hold"} · {review.score}/10
          </span>
        )}
      </div>
      <p className="mt-2 text-sm font-medium text-white">{item.topic}</p>

      {item.slideshow_id && item.positions.length > 0 && (
        <div className="mt-3 flex gap-1.5 overflow-x-auto">
          {item.positions.slice(0, 8).map((pos) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={pos}
              src={`/api/slideshows/${item.slideshow_id}/render/${pos}?w=240&v=${encodeURIComponent(item.updated_at)}`}
              alt=""
              loading="lazy"
              className="h-28 w-16 shrink-0 rounded-md object-cover ring-1 ring-white/[0.08]"
            />
          ))}
        </div>
      )}

      {item.description && (
        <p className="mt-3 whitespace-pre-line text-xs leading-relaxed text-white/60">{item.description}</p>
      )}
      {review && (review.summary || review.issues.length > 0) && (
        <div className="mt-3 rounded-lg bg-white/[0.03] px-3 py-2 text-xs text-white/50">
          {review.summary && <p>{review.summary}</p>}
          {review.issues.length > 0 && (
            <ul className="mt-1 list-disc space-y-0.5 pl-4 text-amber-200/80">
              {review.issues.map((iss, i) => (
                <li key={i}>{iss}</li>
              ))}
            </ul>
          )}
        </div>
      )}
      {item.error && (
        <p className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">{item.error}</p>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {item.status === "needs_review" && !confirming && (
          <>
            <button type="button" disabled={busy} onClick={() => setConfirming(true)} className={primary}>
              Approve & post
            </button>
            <button type="button" disabled={busy} onClick={() => onAct(item.id, "reject")} className={ghost}>
              Reject
            </button>
          </>
        )}
        {item.status === "needs_review" && confirming && (
          <>
            <span className="text-xs text-white/50">Post to TikTok now as {privacyLabel}?</span>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setConfirming(false);
                onAct(item.id, "approve");
              }}
              className={primary}
            >
              Yes, post it
            </button>
            <button type="button" disabled={busy} onClick={() => setConfirming(false)} className={ghost}>
              Cancel
            </button>
          </>
        )}
        {canReview && (
          <button type="button" disabled={busy} onClick={() => onAct(item.id, "review")} className={primary}>
            Review now
          </button>
        )}
        {item.status !== "generating" && (
          <button type="button" disabled={busy} onClick={() => onRegenerate(item.topic)} className={ghost}>
            Regenerate
          </button>
        )}
        {item.slideshow_id && (
          <Link href={`/dashboard/slideshows/${item.slideshow_id}`} className={ghost}>
            Open deck
          </Link>
        )}
        {item.runId && (
          <Link href={`/dashboard/admin/runs/${item.runId}`} className={ghost}>
            Diagnostics
          </Link>
        )}
        {item.tiktok_post_id && (
          <Link href={`/dashboard/posts/${item.tiktok_post_id}`} className={ghost}>
            View post
          </Link>
        )}
      </div>
    </article>
  );
}
