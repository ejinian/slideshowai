"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { signout } from "@/app/login/actions";
import type { BillingUsage } from "@/components/dashboard/BillingModal";
import {
  CREDIT_PACKS,
  CREDIT_PACK_IDS,
  PAID_PLAN_IDS,
  PLANS,
} from "@/lib/billing/plans";

// Account settings — a two-pane modal: sections on the left, the selected
// section's panel on the right. UI ONLY for now; every section except Overview
// is a placeholder, and nothing here writes anything.

type SectionId = "overview" | "billing" | "credits" | "connections";

const SECTIONS: { id: SectionId; label: string; icon: React.ReactNode }[] = [
  {
    id: "overview",
    label: "Overview",
    icon: (
      <>
        <circle cx="12" cy="8" r="4" />
        <path d="M4 21c0-4 3.6-6 8-6s8 2 8 6" />
      </>
    ),
  },
  {
    id: "billing",
    label: "Billing & Plans",
    icon: (
      <>
        <rect x="2" y="5" width="20" height="14" rx="2" />
        <path d="M2 10h20" />
      </>
    ),
  },
  {
    id: "credits",
    label: "Add Credits",
    icon: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 8v8M8 12h8" />
      </>
    ),
  },
  {
    id: "connections",
    label: "Connected Accounts",
    icon: (
      <>
        <path d="M9 15l6-6" />
        <path d="M11 6l1-1a4 4 0 1 1 6 6l-1 1M13 18l-1 1a4 4 0 1 1-6-6l1-1" />
      </>
    ),
  },
];

const PLAN_LABEL: Record<string, string> = {
  free: "Free",
  growth: "Growth",
  scale: "Scale",
  unlimited: "Unlimited",
};

// Same endpoints BillingModal uses — Stripe owns the real prices, these are the
// display values from lib/billing/plans.
async function startCheckout(
  endpoint: string,
  payload: object,
): Promise<string | null> {
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = (await res.json()) as { url?: string; error?: string };
    if (data.url) {
      window.location.href = data.url;
      return null; // leaving the page — keep the busy state
    }
    return data.error || "Something went wrong.";
  } catch {
    return "Network error — try again.";
  }
}

export function SettingsModal({
  open,
  onClose,
  businessName,
  email,
  usage,
  tiktokConnected = false,
}: {
  open: boolean;
  onClose: () => void;
  businessName: string | null;
  email: string | null;
  usage: BillingUsage;
  tiktokConnected?: boolean;
}) {
  const [section, setSection] = useState<SectionId>("overview");
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [confirmSignOut, setConfirmSignOut] = useState(false);
  // Portals need a DOM; `useSyncExternalStore` gives false on the server and
  // true after hydration without a setState-in-effect.
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );

  // Escape backs out one layer at a time: the confirmation first, then the
  // modal. Closing the modal always clears the confirmation, so reopening
  // settings never lands on a stale "are you sure".
  const close = () => {
    setConfirmSignOut(false);
    onClose();
  };
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setConfirmSignOut((confirming) => {
        if (!confirming) onClose();
        return false;
      });
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open || !mounted) return null;

  const initial = (businessName || email || "?").charAt(0).toUpperCase();

  return createPortal(
    <div className="fixed inset-0 z-100 flex items-center justify-center p-0 sm:p-6">
      <button
        type="button"
        aria-hidden
        tabIndex={-1}
        onClick={close}
        className="absolute inset-0 cursor-default bg-black/70"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
        className="relative flex h-full w-full flex-col overflow-hidden bg-[#141416] sm:h-[34rem] sm:max-w-4xl sm:flex-row sm:rounded-2xl sm:border sm:border-white/8 sm:shadow-2xl"
      >
        {/* ── section rail. Below `sm` it's a scrollable tab strip across the
               top, since a 224px rail would eat half a phone screen. ── */}
        <nav className="shrink-0 border-white/8 sm:w-56 sm:border-r">
          <div className="hidden items-center gap-2.5 px-4 py-4 sm:flex">
            <Avatar initial={initial} size="sm" />
            <div className="min-w-0">
              <p className="truncate text-[13px] font-semibold text-white">
                {businessName || "Your business"}
              </p>
              <p className="truncate text-[11px] text-white/40">{email}</p>
            </div>
          </div>

          <div className="no-scrollbar flex gap-1 overflow-x-auto px-3 py-3 sm:flex-col sm:px-2 sm:py-0">
            {SECTIONS.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setSection(s.id)}
                aria-current={section === s.id}
                className={`flex shrink-0 items-center gap-2.5 whitespace-nowrap rounded-lg px-3 py-2 text-[13px] font-medium transition-colors ${
                  section === s.id
                    ? "bg-white/8 text-white"
                    : "text-white/50 hover:bg-white/[0.04] hover:text-white"
                }`}
              >
                <svg
                  width="15"
                  height="15"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden
                  className="shrink-0"
                >
                  {s.icon}
                </svg>
                {s.label}
              </button>
            ))}
          </div>

          <div className="mt-auto hidden border-t border-white/8 p-2 sm:block">
            <button
              type="button"
              onClick={() => setConfirmSignOut(true)}
              className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] font-medium text-white/50 transition-colors hover:bg-white/[0.04] hover:text-white"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />
              </svg>
              Sign Out
            </button>
          </div>
        </nav>

        {/* ── panel ── */}
        <div className="relative min-w-0 flex-1 overflow-y-auto p-5 sm:p-7">
          <button
            type="button"
            onClick={close}
            aria-label="Close settings"
            className="absolute right-4 top-4 grid h-8 w-8 place-items-center rounded-full text-white/40 transition-colors hover:bg-white/[0.06] hover:text-white"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>

          {section === "connections" ? (
            <ConnectionsSection connected={tiktokConnected} />
          ) : section === "billing" ? (
            <BillingSection usage={usage} busy={busy} setBusy={setBusy} err={err} setErr={setErr} />
          ) : section === "credits" ? (
            <CreditsSection usage={usage} busy={busy} setBusy={setBusy} err={err} setErr={setErr} />
          ) : (
            <>
              <div className="flex items-center gap-3.5">
                <Avatar initial={initial} size="lg" />
                <div className="min-w-0">
                  <h2 className="truncate text-xl font-bold text-white">
                    {businessName || "Your business"}
                  </h2>
                  <p className="truncate text-[13px] text-white/40">{email}</p>
                </div>
              </div>

              <div className="mt-7">
                <p className="text-[15px] font-semibold text-white">
                  {PLAN_LABEL[usage.plan] ?? usage.plan}
                </p>
                <p className="mt-1 text-[13px] text-white/40">
                  {usage.plan === "free"
                    ? "No active subscription"
                    : `${usage.used} of ${usage.quota} slideshows used this month`}
                </p>
                <button
                  type="button"
                  onClick={() => setSection("billing")}
                  className="mt-4 w-full rounded-xl border border-white/12 py-2.5 text-[13px] font-semibold text-white transition-colors hover:bg-white/[0.06]"
                >
                  View Plans
                </button>
              </div>
            </>
          )}

          {/* Sign out lives in the rail on desktop; on a phone the rail is a tab
              strip with no room for it. */}
          <button
            type="button"
            onClick={() => setConfirmSignOut(true)}
            className="mt-8 w-full rounded-xl border border-white/12 py-2.5 text-[13px] font-semibold text-white/70 sm:hidden"
          >
            Sign Out
          </button>
        </div>

        {/* ── sign-out confirmation ──────────────────────────────────
               Sits inside the dialog so the settings context stays behind it.
               Names the account being signed out — on a shared machine "sign
               out" alone doesn't say whose session ends. */}
        {confirmSignOut && (
          <div className="absolute inset-0 z-10 grid place-items-center p-6">
            <button
              type="button"
              aria-hidden
              tabIndex={-1}
              onClick={() => setConfirmSignOut(false)}
              className="absolute inset-0 cursor-default bg-black/70"
            />
            <div
              role="alertdialog"
              aria-modal="true"
              aria-label="Confirm sign out"
              className="animate-dropdown-in relative w-full max-w-xs rounded-2xl border border-white/10 bg-[#1c1c1e] p-5 text-center shadow-2xl"
            >
              <p className="text-[15px] font-semibold text-white">
                Are you sure you want to sign out?
              </p>
              <p className="mt-1.5 truncate text-[13px] text-white/45">
                {businessName || email}
              </p>
              <div className="mt-5 flex gap-2">
                <button
                  type="button"
                  onClick={() => setConfirmSignOut(false)}
                  className="flex-1 rounded-full border border-white/12 py-2.5 text-[13px] font-semibold text-white transition-colors hover:bg-white/[0.06]"
                >
                  Cancel
                </button>
                <form action={signout} className="flex-1">
                  <button
                    type="submit"
                    className="w-full rounded-full bg-red-500/90 py-2.5 text-[13px] font-semibold text-white transition-colors hover:bg-red-500"
                  >
                    Sign Out
                  </button>
                </form>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

interface SectionProps {
  usage: BillingUsage;
  busy: string | null;
  setBusy: (v: string | null) => void;
  err: string | null;
  setErr: (v: string | null) => void;
}

function SectionHead({ title, sub }: { title: string; sub: string }) {
  return (
    <div className="mb-5 pr-10">
      <h2 className="text-lg font-bold text-white">{title}</h2>
      <p className="mt-1 text-[13px] text-white/40">{sub}</p>
    </div>
  );
}

function ErrorLine({ err }: { err: string | null }) {
  if (!err) return null;
  return (
    <p className="mt-4 rounded-lg border border-red-500/20 bg-red-500/8 px-3 py-2 text-[13px] text-red-400">
      {err}
    </p>
  );
}

function BillingSection({ usage, busy, setBusy, err, setErr }: SectionProps) {
  const isSubscriber = usage.plan !== "free";
  const go = async (endpoint: string, payload: object, tag: string) => {
    setBusy(tag);
    setErr(null);
    const e = await startCheckout(endpoint, payload);
    if (e) {
      setErr(e);
      setBusy(null);
    }
  };

  return (
    <>
      <SectionHead
        title="Billing & Plans"
        sub={
          usage.quota === null
            ? "Unlimited slideshows within fair use."
            : `${usage.used} of ${usage.quota} slideshows used this month.`
        }
      />

      <div className="space-y-2.5">
        {PAID_PLAN_IDS.map((id) => {
          const plan = PLANS[id];
          const current = usage.plan === id;
          return (
            <div
              key={id}
              className={`flex items-center gap-4 rounded-xl border p-4 ${
                current ? "border-accent/50 bg-accent/8" : "border-white/8 bg-white/[0.02]"
              }`}
            >
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2 text-[15px] font-semibold text-white">
                  {plan.name}
                  {plan.popular && !current && (
                    <span className="rounded-full bg-accent/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-accent-text">
                      Most popular
                    </span>
                  )}
                  {plan.bestValue && !current && (
                    <span className="rounded-full bg-emerald-400/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-300">
                      Best value
                    </span>
                  )}
                  {current && (
                    <span className="rounded-full bg-accent px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
                      Current
                    </span>
                  )}
                </p>
                <p className="mt-0.5 text-[13px] text-white/40">
                  {plan.quota === null
                    ? "Unlimited slideshows"
                    : `${plan.quota} slideshows a month`}{" "}
                  · {plan.tagline}
                </p>
              </div>
              <div className="shrink-0 text-right">
                <p className="text-[15px] font-bold text-white">
                  ${plan.price}
                  <span className="text-[12px] font-medium text-white/35">/mo</span>
                </p>
                {!current && (
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() =>
                      void go("/api/stripe/checkout", { kind: "subscription", id }, `sub:${id}`)
                    }
                    className="mt-1.5 rounded-full bg-accent px-3.5 py-1.5 text-[12px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-40"
                  >
                    {busy === `sub:${id}` ? "Opening…" : isSubscriber ? "Switch" : "Upgrade"}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {isSubscriber && (
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => void go("/api/stripe/portal", {}, "portal")}
          className="mt-4 w-full rounded-xl border border-white/12 py-2.5 text-[13px] font-semibold text-white transition-colors hover:bg-white/[0.06] disabled:opacity-40"
        >
          {busy === "portal" ? "Opening…" : "Manage billing"}
        </button>
      )}
      <ErrorLine err={err} />
    </>
  );
}

function CreditsSection({ usage, busy, setBusy, err, setErr }: SectionProps) {
  const go = async (id: string) => {
    setBusy(`cr:${id}`);
    setErr(null);
    const e = await startCheckout("/api/stripe/checkout", { kind: "credits", id });
    if (e) {
      setErr(e);
      setBusy(null);
    }
  };

  return (
    <>
      <SectionHead
        title="Add Credits"
        sub="One-time top-ups. Credits never expire and are only used once your monthly allowance runs out."
      />

      <p className="mb-4 text-[13px] text-white/50">
        Balance: <span className="font-semibold text-white">{usage.credits}</span>{" "}
        credit{usage.credits === 1 ? "" : "s"}
      </p>

      <div className="grid gap-2.5 sm:grid-cols-3">
        {CREDIT_PACK_IDS.map((id) => {
          const pack = CREDIT_PACKS[id];
          return (
            <button
              key={id}
              type="button"
              disabled={busy !== null}
              onClick={() => void go(id)}
              className="rounded-xl border border-white/8 bg-white/[0.02] p-4 text-left transition-colors hover:border-accent/50 hover:bg-accent/6 disabled:opacity-40"
            >
              <p className="text-[15px] font-bold text-white">{pack.credits} credits</p>
              <p className="mt-0.5 text-[13px] text-white/40">
                ${pack.price} · ${(pack.price / pack.credits).toFixed(2)} each
              </p>
              <p className="mt-3 text-[12px] font-semibold text-accent-text">
                {busy === `cr:${id}` ? "Opening…" : "Buy"}
              </p>
            </button>
          );
        })}
      </div>
      <ErrorLine err={err} />
    </>
  );
}

function ConnectionsSection({ connected }: { connected: boolean }) {
  return (
    <>
      <SectionHead
        title="Connected Accounts"
        sub="Publish and schedule straight from SlideLabsAI."
      />

      <div className="flex items-center gap-4 rounded-xl border border-white/8 bg-white/[0.02] p-4">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-white/[0.06] text-white">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
            <path d="M16.5 5.4a5 5 0 0 1-2.9-2.5V2h-2.9v12.2a2.5 2.5 0 1 1-1.8-2.4V8.8a5.5 5.5 0 1 0 4.7 5.4V8.7a7.8 7.8 0 0 0 4.4 1.4V7.2a4.7 4.7 0 0 1-1.5-.3z" />
          </svg>
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-semibold text-white">TikTok</p>
          <p className="mt-0.5 text-[13px] text-white/40">
            {connected
              ? "Connected — posts and scheduled publishing are enabled."
              : "Not connected. Connect to post and schedule from the app."}
          </p>
        </div>
        {connected ? (
          <span className="shrink-0 rounded-full bg-emerald-400/12 px-3 py-1 text-[12px] font-semibold text-emerald-300">
            Connected
          </span>
        ) : (
          // A full navigation, not a popup: the OAuth callback redirects back
          // to `return_to`, and settings is a modal with no URL of its own.
          <a
            href={`/api/auth/tiktok?return_to=${encodeURIComponent("/dashboard/schedule")}`}
            className="shrink-0 rounded-full bg-accent px-4 py-2 text-[13px] font-semibold text-white transition-opacity hover:opacity-90"
          >
            Connect
          </a>
        )}
      </div>

      {connected && (
        <p className="mt-3 text-[12px] text-white/30">
          Manage or disconnect this account from the Schedule page.
        </p>
      )}
    </>
  );
}

function Avatar({ initial, size }: { initial: string; size: "sm" | "lg" }) {
  return (
    <span
      className={`grid shrink-0 place-items-center rounded-full bg-linear-to-br from-accent to-fuchsia-500 font-bold uppercase text-white ${
        size === "lg" ? "h-14 w-14 text-xl" : "h-8 w-8 text-[13px]"
      }`}
    >
      {initial}
    </span>
  );
}

