"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { accountLabel } from "@/lib/tiktok/accountLabel";
import { EmptyState } from "@/components/ui/EmptyState";

export interface AccountCardData {
  id: string;
  openId: string;
  displayName: string | null;
  username: string | null;
  avatarUrl: string | null;
  isDefault: boolean;
  connectedAt: string | null;
  postsPublished: number;
  lastPostedAt: string | null;
  queued: number;
}

// add=1 → the OAuth flow knows this is "connect ANOTHER account": it asks
// TikTok to skip auto-auth, and the callback reports same-account no-ops
// instead of silently succeeding.
const CONNECT_HREF = `/api/auth/tiktok?return_to=${encodeURIComponent("/dashboard/accounts")}&add=1`;

const dateLabel = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

export function AccountsView({ accounts }: { accounts: AccountCardData[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  // Two-step disconnect: first click arms, second click fires. Cheaper and
  // calmer than a modal for an action that just needs one beat of intent.
  const [confirming, setConfirming] = useState<string | null>(null);
  // Outcome of an OAuth round-trip back to this page (?tiktok_error /
  // ?tiktok_connected) — surfaced as a banner, then stripped from the URL so a
  // refresh doesn't repeat it.
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const err = params.get("tiktok_error");
    if (err) setNotice({ kind: "error", text: err });
    else if (params.get("tiktok_connected") === "1")
      setNotice({ kind: "ok", text: "TikTok account connected." });
    else return;
    params.delete("tiktok_error");
    params.delete("tiktok_connected");
    const qs = params.toString();
    window.history.replaceState(null, "", window.location.pathname + (qs ? `?${qs}` : ""));
  }, []);

  const setDefault = async (id: string) => {
    setBusy(id);
    try {
      const res = await fetch("/api/tiktok/accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ connectionId: id }),
      });
      if (res.ok) router.refresh();
    } finally {
      setBusy(null);
    }
  };

  const disconnect = async (id: string) => {
    if (confirming !== id) {
      setConfirming(id);
      return;
    }
    setBusy(id);
    setConfirming(null);
    try {
      const res = await fetch("/api/auth/tiktok/disconnect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ connectionId: id }),
      });
      if (res.ok) router.refresh();
    } finally {
      setBusy(null);
    }
  };

  if (accounts.length === 0) {
    return (
      <div>
        {notice?.kind === "error" ? (
          <p className="mb-4 rounded-2xl bg-red-500/10 px-4 py-3 text-sm text-red-300 ring-1 ring-red-500/20">
            {notice.text}
          </p>
        ) : null}
        <div className="overflow-hidden rounded-2xl bg-[#141416] ring-1 ring-white/[0.06]">
        <EmptyState
          title="No TikTok accounts connected"
          description="Connect one to post, schedule, and see your numbers. You can add more later and pick which account each post goes to."
          action={
            <a
              href={CONNECT_HREF}
              className="rounded-full bg-accent px-5 py-2.5 text-sm font-bold text-white shadow-lg shadow-accent/25 transition-all hover:brightness-110"
            >
              Connect TikTok
            </a>
          }
        />
        </div>
      </div>
    );
  }

  return (
    <div>
      {notice ? (
        <p
          className={`mb-4 rounded-2xl px-4 py-3 text-sm ring-1 ${
            notice.kind === "error"
              ? "bg-red-500/10 text-red-300 ring-red-500/20"
              : "bg-emerald-500/10 text-emerald-300 ring-emerald-500/20"
          }`}
        >
          {notice.text}
        </p>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {accounts.map((a) => {
          const isBusy = busy === a.id;
          return (
            <div
              key={a.id}
              className={`flex flex-col rounded-2xl bg-[#141416] p-5 ring-1 ring-white/[0.06] ${
                isBusy ? "opacity-60" : ""
              }`}
            >
              <div className="flex items-center gap-3">
                {a.avatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={a.avatarUrl}
                    alt=""
                    className="h-12 w-12 shrink-0 rounded-full object-cover ring-1 ring-white/[0.08]"
                  />
                ) : (
                  <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-linear-to-br from-accent to-fuchsia-500 text-base font-bold text-white">
                    {(a.displayName ?? a.username ?? "T").slice(0, 1).toUpperCase()}
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold text-white">
                    {a.displayName ?? accountLabel(a)}
                  </p>
                  {a.username ? (
                    <p className="truncate text-xs text-white/40">@{a.username}</p>
                  ) : null}
                </div>
                {a.isDefault ? (
                  <span className="flex shrink-0 items-center gap-1 rounded-full bg-emerald-400/10 px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-emerald-300">
                    Default
                  </span>
                ) : null}
              </div>

              <dl className="mt-4 grid grid-cols-3 gap-2">
                {[
                  { label: "Posted", value: String(a.postsPublished) },
                  { label: "Queued", value: String(a.queued) },
                  {
                    label: "Last post",
                    value: a.lastPostedAt
                      ? new Date(a.lastPostedAt).toLocaleDateString("en-US", {
                          month: "short",
                          day: "numeric",
                        })
                      : "—",
                  },
                ].map((s) => (
                  <div key={s.label} className="rounded-xl bg-white/[0.03] px-2.5 py-2">
                    <dt className="text-[10px] font-medium uppercase tracking-wide text-white/35">
                      {s.label}
                    </dt>
                    <dd className="mt-0.5 truncate text-sm font-bold text-white">{s.value}</dd>
                  </div>
                ))}
              </dl>

              {a.connectedAt ? (
                <p className="mt-3 text-[11px] text-white/30">
                  Connected {dateLabel(a.connectedAt)}
                </p>
              ) : null}

              <div className="mt-4 flex items-center justify-between border-t border-white/[0.06] pt-3">
                {a.isDefault ? (
                  <span className="text-xs text-white/35">
                    Used when no account is picked
                  </span>
                ) : (
                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={() => void setDefault(a.id)}
                    className="rounded-full bg-white/[0.06] px-3 py-1.5 text-xs font-semibold text-white/70 transition-colors hover:bg-white/[0.1] hover:text-white disabled:opacity-50"
                  >
                    Make default
                  </button>
                )}
                <button
                  type="button"
                  disabled={isBusy}
                  onClick={() => void disconnect(a.id)}
                  onBlur={() => setConfirming((c) => (c === a.id ? null : c))}
                  className={`rounded-full px-3 py-1.5 text-xs font-semibold transition-colors disabled:opacity-50 ${
                    confirming === a.id
                      ? "bg-red-500/15 text-red-300"
                      : "text-white/35 hover:text-red-300"
                  }`}
                >
                  {confirming === a.id ? "Really disconnect?" : "Disconnect"}
                </button>
              </div>
            </div>
          );
        })}

        {/* connect another */}
        <a
          href={CONNECT_HREF}
          className="flex min-h-44 flex-col items-center justify-center gap-2 rounded-2xl bg-white/[0.02] ring-1 ring-white/[0.06] transition-colors hover:bg-white/[0.04] hover:ring-white/[0.12]"
        >
          <span className="grid h-10 w-10 place-items-center rounded-full bg-white/[0.06] text-xl font-medium text-white/60">
            +
          </span>
          <span className="text-sm font-semibold text-white/70">Connect another account</span>
          <span className="px-6 text-center text-[11px] text-white/30">
            Adding more than one is a Scale feature
          </span>
        </a>
      </div>

      {/* The gotcha everyone hits: TikTok connects whichever account its own
          site is logged into, silently skipping consent for a known account. */}
      <p className="mt-4 text-xs text-white/30">
        TikTok connects whichever account is signed in at tiktok.com — to add a
        different account, switch accounts there first (or use a private window
        and sign in fresh).
      </p>
    </div>
  );
}
