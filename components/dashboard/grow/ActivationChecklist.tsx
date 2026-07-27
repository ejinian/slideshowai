"use client";

import { useState, useSyncExternalStore } from "react";
import Link from "next/link";
import {
  ACTIVATION_STEPS,
  dismissActivation,
  type ActivationStep,
} from "@/lib/mock-data";

// Step id → where clicking it takes you.
const STEP_HREF: Record<ActivationStep["id"], string> = {
  create: "/dashboard",
  connect: "/dashboard/schedule",
  schedule: "/dashboard/schedule",
};

// Dismissal has to outlive the component — dismissActivation() is still a mock
// with no backend, so without this the card returns on every reload and the X
// reads as broken.
const DISMISS_KEY = "slidelabsai_activation_dismissed";

// The server has no localStorage, so the stored value is read through a store
// with a `false` server snapshot — React swaps in the real value right after
// hydration rather than mismatching the markup.
function subscribeDismissed(onChange: () => void) {
  window.addEventListener("storage", onChange);
  return () => window.removeEventListener("storage", onChange);
}
function readDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISS_KEY) === "1";
  } catch {
    // Private mode / storage disabled — just show the card.
    return false;
  }
}

export function ActivationChecklist() {
  const [steps] = useState(ACTIVATION_STEPS);
  const [dismissed, setDismissed] = useState(false);
  const [dismissing, setDismissing] = useState(false);
  const storedDismissed = useSyncExternalStore(
    subscribeDismissed,
    readDismissed,
    () => false,
  );

  const done = steps.filter((s) => s.done).length;
  const progress = Math.round((done / steps.length) * 100);

  if (dismissed || storedDismissed) return null;

  const dismiss = async () => {
    if (dismissing) return;
    setDismissing(true);
    try {
      localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      /* non-fatal — it just comes back next session */
    }
    setDismissed(true);
    await dismissActivation();
  };

  // Compact card sized for the sidebar (sits above the plan card).
  return (
    <section
      aria-label="Get set up"
      className="rounded-xl border border-border bg-card p-3.5"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-white">Get set up</h2>
          <p className="mt-0.5 text-xs text-muted">
            {done} of {steps.length} complete
          </p>
        </div>
        <button
          type="button"
          onClick={() => void dismiss()}
          disabled={dismissing}
          aria-label="Dismiss checklist"
          title="Dismiss"
          className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-white/40 transition-colors hover:bg-white/[0.06] hover:text-white disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* progress */}
      <div className="mt-2.5 h-1 overflow-hidden rounded-full bg-white/[0.06]">
        <div
          className="h-full rounded-full bg-accent transition-all duration-500"
          style={{ width: `${progress}%` }}
        />
      </div>

      <ul className="mt-2 space-y-0.5">
        {steps.map((step) => (
          <li key={step.id}>
            <Link
              href={STEP_HREF[step.id]}
              className="group flex items-center gap-2.5 rounded-lg px-1.5 py-1.5 transition-colors hover:bg-white/[0.04]"
            >
              <span
                className={`grid h-5 w-5 shrink-0 place-items-center rounded-full transition-colors ${
                  step.done
                    ? "bg-accent text-white"
                    : "ring-1 ring-white/[0.2] group-hover:ring-white/[0.4]"
                }`}
              >
                {step.done && (
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="M20 6L9 17l-5-5" />
                  </svg>
                )}
              </span>
              <span
                className={`min-w-0 flex-1 truncate text-xs font-medium ${
                  step.done ? "text-white/35 line-through" : "text-white/75"
                }`}
              >
                {step.label}
              </span>
              {!step.done && (
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="shrink-0 text-white/20 transition-all group-hover:translate-x-0.5 group-hover:text-white/50">
                  <path d="M9 6l6 6-6 6" />
                </svg>
              )}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
