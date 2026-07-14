"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
  CREDIT_PACKS,
  CREDIT_PACK_IDS,
  PAID_PLAN_IDS,
  PLANS,
  type PlanId,
} from "@/lib/billing/plans";

export interface BillingUsage {
  plan: PlanId;
  quota: number | null; // null = unlimited
  used: number;
  credits: number;
}

export function BillingModal({
  open,
  onClose,
  usage,
}: {
  open: boolean;
  onClose: () => void;
  usage: BillingUsage;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  async function post(endpoint: string, payload: object, tag: string) {
    setBusy(tag);
    setErr(null);
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await res.json()) as { url?: string; error?: string };
      if (data.url) {
        window.location.href = data.url;
        return; // leaving the page — keep the loading state
      }
      setErr(data.error || "Something went wrong.");
    } catch {
      setErr("Network error — try again.");
    }
    setBusy(null);
  }

  const isSubscriber = usage.plan !== "free";
  const pct =
    usage.quota && usage.quota > 0
      ? Math.min(100, Math.round((usage.used / usage.quota) * 100))
      : 0;

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Billing and plans"
    >
      <button
        aria-hidden
        tabIndex={-1}
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-black/80 backdrop-blur-sm"
      />
      <div className="relative z-10 max-h-[90vh] w-full max-w-4xl overflow-y-auto rounded-2xl border border-white/[0.08] bg-[#0a0a0b] shadow-2xl">
        {/* header */}
        <div className="flex items-start justify-between gap-4 px-6 py-5">
          <div>
            <h2 className="text-lg font-semibold text-white">Billing &amp; Plans</h2>
            <p className="mt-0.5 text-xs text-white/50">
              {usage.quota === null
                ? "Unlimited slideshows"
                : `${usage.used} / ${usage.quota} slideshows this month`}
              {usage.credits > 0 ? ` · ${usage.credits} credits` : ""}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {isSubscriber && (
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => post("/api/stripe/portal", {}, "portal")}
                className="rounded-full border border-white/15 px-3.5 py-1.5 text-xs font-semibold text-white transition-colors hover:border-white/40 disabled:opacity-50"
              >
                {busy === "portal" ? "Opening…" : "Manage billing"}
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="grid h-8 w-8 place-items-center rounded-full text-white/50 transition-colors hover:bg-white/5 hover:text-white"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </div>
        </div>

        {err && (
          <div className="mx-6 mb-1 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
            {err}
          </div>
        )}

        {/* tiers */}
        <div className="grid gap-4 px-6 pb-2 sm:grid-cols-3">
          {PAID_PLAN_IDS.map((id) => {
            const p = PLANS[id];
            const current = usage.plan === id;
            return (
              <div
                key={id}
                className={`relative flex flex-col rounded-xl border p-5 ${
                  p.popular
                    ? "border-accent/60 bg-accent/[0.06]"
                    : "border-white/[0.08] bg-white/[0.02]"
                }`}
              >
                {p.popular && (
                  <span className="absolute -top-2.5 left-5 rounded-full bg-accent px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
                    Most popular
                  </span>
                )}
                <p className="text-sm font-semibold text-white">{p.name}</p>
                <p className="mt-0.5 text-xs text-white/40">{p.tagline}</p>
                <p className="mt-3">
                  <span className="text-2xl font-bold text-white">${p.price}</span>
                  <span className="text-xs text-white/40">/mo</span>
                </p>
                <p className="mt-2 text-xs text-white/70">
                  {p.quota === null
                    ? "Unlimited slideshows"
                    : `${p.quota} slideshows / month`}
                </p>
                {p.quota === null && (
                  <p className="mt-0.5 text-[10px] text-white/30">
                    Fair use applies
                  </p>
                )}
                <button
                  type="button"
                  disabled={current || busy !== null}
                  onClick={() => post("/api/stripe/checkout", { kind: "subscription", id }, `sub:${id}`)}
                  className={`mt-4 w-full rounded-full px-4 py-2 text-xs font-semibold transition-opacity disabled:opacity-50 ${
                    p.popular
                      ? "bg-accent text-white hover:opacity-90"
                      : "border border-white/15 text-white hover:border-white/40"
                  } ${current ? "cursor-default" : ""}`}
                >
                  {current
                    ? "Current plan"
                    : busy === `sub:${id}`
                      ? "Redirecting…"
                      : "Upgrade"}
                </button>
              </div>
            );
          })}
        </div>

        {/* credits */}
        <div className="mt-2 border-t border-white/[0.06] px-6 py-5">
          <p className="text-sm font-semibold text-white">Add credits</p>
          <p className="mt-0.5 text-xs text-white/40">
            One-time top-up · 1 credit = 1 slideshow · never expires
          </p>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            {CREDIT_PACK_IDS.map((id) => {
              const pack = CREDIT_PACKS[id];
              return (
                <button
                  key={id}
                  type="button"
                  disabled={busy !== null}
                  onClick={() => post("/api/stripe/checkout", { kind: "credits", id }, `cr:${id}`)}
                  className="flex items-center justify-between rounded-xl border border-white/[0.08] bg-white/[0.02] px-4 py-3 text-left transition-colors hover:border-white/25 disabled:opacity-50"
                >
                  <span className="text-sm font-semibold text-white">
                    {pack.credits} credits
                  </span>
                  <span className="text-xs font-semibold text-white/60">
                    {busy === `cr:${id}` ? "…" : `$${pack.price}`}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* usage bar (subscribers with a finite quota) */}
        {usage.quota !== null && (
          <div className="border-t border-white/[0.06] px-6 py-4">
            <div className="flex items-center justify-between text-[11px] text-white/40">
              <span>This month</span>
              <span>
                {usage.used} / {usage.quota}
                {usage.credits > 0 ? ` · +${usage.credits} credits` : ""}
              </span>
            </div>
            <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
              <div className="h-full rounded-full bg-accent" style={{ width: `${pct}%` }} />
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
