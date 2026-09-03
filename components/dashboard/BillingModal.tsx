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

// What every paid tier includes (all true today — differentiation is volume).
// "AI-generated backgrounds" used to be listed here and was removed: the
// gpt-image-1 fallback went away on 2026-07-17, so it was selling a feature
// that no longer exists. Backgrounds now come from live Pexels or your uploads.
const SHARED_PERKS = [
  "Post & schedule straight to TikTok",
  "AI captions + vision-matched photos",
  "Live stock photos matched to every slide",
];

function Check() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="mt-0.5 shrink-0 text-accent-text"
      aria-hidden
    >
      <path d="M20 6L9 17l-5-5" />
    </svg>
  );
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
        className="absolute inset-0 cursor-default bg-black/80 backdrop-blur-md"
      />
      {/* no-scrollbar: the native scrollbar rendered inside the rounded corner
          and squared off the panel's top-right radius on mobile. */}
      <div className="no-scrollbar relative z-10 max-h-[92vh] w-full max-w-4xl overflow-y-auto overflow-x-hidden rounded-3xl border border-white/[0.08] bg-[#08080b] shadow-2xl shadow-black/80">
        {/* aurora — floating gradient orbs behind everything */}
        <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="animate-float-a absolute -top-24 left-[12%] h-72 w-72 rounded-full bg-accent/25 blur-[100px]" />
          <div className="animate-float-b absolute -top-16 right-[8%] h-64 w-64 rounded-full bg-fuchsia-500/15 blur-[100px]" />
          <div
            className="animate-float-a absolute bottom-[-4rem] left-1/2 h-56 w-56 -translate-x-1/2 rounded-full bg-violet-500/15 blur-[110px]"
            style={{ animationDelay: "-6s" }}
          />
        </div>

        <div className="relative">
          {/* header */}
          <div className="flex items-start justify-between gap-4 px-7 pb-2 pt-7">
            <div className="animate-rise">
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-accent-text">
                Plans &amp; billing
              </p>
              <h2 className="mt-1.5 text-2xl font-bold tracking-tight text-white sm:text-3xl">
                Make it{" "}
                <em
                  className="text-gradient-animated not-italic"
                  style={{ fontStyle: "normal" }}
                >
                  unstoppable
                </em>
              </h2>
              <p className="mt-1 text-xs text-white/50">
                {usage.quota === null
                  ? "Unlimited slideshows"
                  : `${usage.used} / ${usage.quota} slideshows this month`}
                {usage.credits > 0 ? ` · ${usage.credits} credits banked` : ""}
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
            <div className="mx-7 mt-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
              {err}
            </div>
          )}

          {/* tiers */}
          <div className="grid gap-4 px-7 pb-2 pt-5 sm:grid-cols-3">
            {PAID_PLAN_IDS.map((id, idx) => {
              const p = PLANS[id];
              const current = usage.plan === id;
              const quotaLine =
                p.quota === null
                  ? "Unlimited slideshows"
                  : `${p.quota} slideshows / month`;
              const accountsLine =
                p.tiktokAccounts === 1
                  ? "1 TikTok account"
                  : `${p.tiktokAccounts} TikTok accounts — post or cross-post to any`;

              const card = (
                <div
                  className={`relative flex h-full flex-col rounded-[15px] p-5 ${
                    p.popular || p.bestValue ? "bg-[#0c0c12]" : "bg-white/[0.02]"
                  }`}
                >
                  {p.popular && (
                    <span className="absolute -top-3 right-4 whitespace-nowrap rounded-full bg-accent px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-white shadow-lg shadow-accent/50">
                      Most popular
                    </span>
                  )}
                  {p.bestValue && (
                    <span className="absolute -top-3 right-4 whitespace-nowrap rounded-full bg-emerald-500 px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-white shadow-lg shadow-emerald-500/50">
                      Best value
                    </span>
                  )}
                  <p className="text-sm font-bold text-white">{p.name}</p>
                  <p className="mt-0.5 text-xs text-white/40">{p.tagline}</p>
                  <p className="mt-4 flex items-baseline gap-1">
                    <span
                      className={`text-4xl font-extrabold tracking-tight ${
                        p.popular
                          ? "text-gradient-animated"
                          : p.bestValue
                            ? "text-emerald-300"
                            : "text-white"
                      }`}
                    >
                      ${p.price}
                    </span>
                    <span className="text-xs font-medium text-white/40">/mo</span>
                  </p>

                  <ul className="mt-4 flex flex-col gap-2 text-xs leading-snug text-white/70">
                    <li className="flex items-start gap-2">
                      <Check />
                      <span className="font-semibold text-white">
                        {quotaLine}
                        {p.quota === null && (
                          <span className="font-normal text-white/35"> · fair use</span>
                        )}
                      </span>
                    </li>
                    <li className="flex items-start gap-2">
                      <Check />
                      <span>{accountsLine}</span>
                    </li>
                    {SHARED_PERKS.map((perk) => (
                      <li key={perk} className="flex items-start gap-2">
                        <Check />
                        {perk}
                      </li>
                    ))}
                  </ul>

                  <div className="flex-1" />
                  {/* The CTA answers the card's rotating border on hover: the
                      same conic sweep, spun up and wrapped around the button.
                      Hovering a highlighted tier previously did almost nothing
                      — a faint shadow under the button — so the most important
                      control on the card read as inert. Only the halo is
                      animated; the button keeps its solid fill so the gradient
                      only ever shows as an edge. */}
                  <div className="group relative mt-5">
                    {!current && (p.popular || p.bestValue) && (
                      <div
                        aria-hidden
                        className="pointer-events-none absolute -inset-[2.5px] overflow-hidden rounded-full opacity-0 blur-[0.5px] transition-opacity duration-300 group-hover:opacity-100"
                      >
                        <div
                          className="animate-spin absolute -inset-[150%]"
                          style={{
                            animationDuration: "1.8s",
                            background: p.popular
                              ? "conic-gradient(from 0deg, transparent 0deg, #6366f1 60deg, #d946ef 130deg, transparent 200deg, #6366f1 300deg, transparent 360deg)"
                              : "conic-gradient(from 0deg, transparent 0deg, #10b981 60deg, #6ee7b7 130deg, transparent 200deg, #10b981 300deg, transparent 360deg)",
                          }}
                        />
                      </div>
                    )}
                    <button
                      type="button"
                      disabled={current || busy !== null}
                      onClick={() =>
                        post("/api/stripe/checkout", { kind: "subscription", id }, `sub:${id}`)
                      }
                      className={`relative w-full rounded-full px-4 py-2.5 text-xs font-bold transition-all duration-300 disabled:opacity-50 ${
                        current
                          ? "cursor-default"
                          : "group-hover:-translate-y-0.5 group-active:translate-y-0"
                      } ${
                        p.popular
                          ? "btn-shine bg-accent text-white shadow-lg shadow-accent/40 group-hover:shadow-xl group-hover:shadow-accent/60"
                          : p.bestValue
                            ? "bg-emerald-500 text-white shadow-lg shadow-emerald-500/35 group-hover:shadow-xl group-hover:shadow-emerald-500/60"
                            : "border border-white/15 bg-transparent text-white hover:border-accent hover:text-accent-text"
                      }`}
                    >
                      {current
                        ? "Current plan"
                        : busy === `sub:${id}`
                          ? "Redirecting…"
                          : `Get ${p.name}`}
                    </button>
                  </div>
                </div>
              );

              return (
                <div
                  key={id}
                  className="animate-rise transition-transform duration-300 hover:-translate-y-1.5"
                  style={{ animationDelay: `${80 + idx * 90}ms` }}
                >
                  {p.popular ? (
                    // Rotating conic-gradient border, Higgsfield-style. Only
                    // the spinning layer is clipped so the badge can overhang.
                    <div className="relative h-full rounded-2xl p-px shadow-[0_0_50px_rgba(99,102,241,0.25)]">
                      <div aria-hidden className="absolute inset-0 overflow-hidden rounded-2xl">
                        <div
                          className="animate-spin absolute -inset-[150%]"
                          style={{
                            animationDuration: "5s",
                            background:
                              "conic-gradient(from 0deg, transparent 0deg, #6366f1 70deg, #d946ef 140deg, transparent 220deg, #6366f1 300deg, transparent 360deg)",
                          }}
                        />
                      </div>
                      <div className="relative h-full">{card}</div>
                    </div>
                  ) : p.bestValue ? (
                    // Same rotating border as the popular tier — same direction
                    // and duration, emerald instead of indigo. Opposing spins
                    // read as a glitch, not as variety.
                    <div className="relative h-full rounded-2xl p-px shadow-[0_0_50px_rgba(16,185,129,0.22)]">
                      <div aria-hidden className="absolute inset-0 overflow-hidden rounded-2xl">
                        <div
                          className="animate-spin absolute -inset-[150%]"
                          style={{
                            animationDuration: "5s",
                            background:
                              "conic-gradient(from 0deg, transparent 0deg, #10b981 70deg, #6ee7b7 140deg, transparent 220deg, #10b981 300deg, transparent 360deg)",
                          }}
                        />
                      </div>
                      <div className="relative h-full">{card}</div>
                    </div>
                  ) : (
                    <div className="h-full rounded-2xl border border-white/[0.08] transition-colors hover:border-white/20">
                      {card}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* credits */}
          <div
            className="animate-rise mt-4 border-t border-white/[0.06] px-7 py-5"
            style={{ animationDelay: "340ms" }}
          >
            <p className="text-sm font-bold text-white">Add credits</p>
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
                    onClick={() =>
                      post("/api/stripe/checkout", { kind: "credits", id }, `cr:${id}`)
                    }
                    className="group flex items-center justify-between rounded-xl border border-white/[0.08] bg-white/[0.02] px-4 py-3.5 text-left transition-all hover:-translate-y-0.5 hover:border-accent/50 hover:bg-accent/[0.06] hover:shadow-lg hover:shadow-accent/10 disabled:opacity-50"
                  >
                    <span className="text-sm font-bold text-white">
                      {pack.credits}
                      <span className="ml-1 text-xs font-medium text-white/40">
                        credits
                      </span>
                    </span>
                    <span className="text-sm font-bold text-white/60 transition-colors group-hover:text-accent-text">
                      {busy === `cr:${id}` ? "…" : `$${pack.price}`}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* usage bar (subscribers with a finite quota) */}
          {usage.quota !== null && (
            <div className="border-t border-white/[0.06] px-7 py-4">
              <div className="flex items-center justify-between text-[11px] text-white/40">
                <span>This month</span>
                <span>
                  {usage.used} / {usage.quota}
                  {usage.credits > 0 ? ` · +${usage.credits} credits` : ""}
                </span>
              </div>
              <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-accent via-violet-500 to-fuchsia-500 transition-[width] duration-700"
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
