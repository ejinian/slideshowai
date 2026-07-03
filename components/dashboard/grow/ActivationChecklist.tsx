"use client";

import { useState } from "react";
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

export function ActivationChecklist() {
  const [steps] = useState(ACTIVATION_STEPS);
  const [dismissed, setDismissed] = useState(false);
  const [dismissing, setDismissing] = useState(false);

  const done = steps.filter((s) => s.done).length;
  const allDone = done === steps.length;
  const progress = Math.round((done / steps.length) * 100);

  if (dismissed) return null;

  const dismiss = async () => {
    if (!allDone || dismissing) return;
    setDismissing(true);
    await dismissActivation();
    setDismissed(true);
  };

  return (
    <section
      aria-label="Get set up"
      className="rounded-2xl bg-[#141416] p-5 ring-1 ring-white/[0.06]"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-bold text-white">Get set up</h2>
          <p className="mt-0.5 text-xs text-white/40">
            {done} of {steps.length} complete — finish these and your first post
            schedules itself.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void dismiss()}
          disabled={!allDone}
          aria-label={
            allDone ? "Dismiss checklist" : "Complete all steps to dismiss"
          }
          title={allDone ? "Dismiss" : "Complete all steps to dismiss"}
          className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-white/40 transition-colors hover:bg-white/[0.06] hover:text-white disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent"
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* progress */}
      <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
        <div
          className="h-full rounded-full bg-accent transition-all duration-500"
          style={{ width: `${progress}%` }}
        />
      </div>

      <ul className="mt-4 space-y-1">
        {steps.map((step) => (
          <li key={step.id}>
            <Link
              href={STEP_HREF[step.id]}
              className="group flex items-center gap-3 rounded-xl px-2 py-2.5 transition-colors hover:bg-white/[0.04]"
            >
              <span
                className={`grid h-6 w-6 shrink-0 place-items-center rounded-full transition-colors ${
                  step.done
                    ? "bg-accent text-white"
                    : "ring-1 ring-white/[0.2] group-hover:ring-white/[0.4]"
                }`}
              >
                {step.done && (
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="M20 6L9 17l-5-5" />
                  </svg>
                )}
              </span>
              <span
                className={`flex-1 text-sm font-medium ${
                  step.done ? "text-white/35 line-through" : "text-white/80"
                }`}
              >
                {step.label}
              </span>
              {!step.done && (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="text-white/20 transition-all group-hover:translate-x-0.5 group-hover:text-white/50">
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
