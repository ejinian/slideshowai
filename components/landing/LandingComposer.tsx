"use client";

import { useEffect, useState } from "react";

// A faithful, click-through replica of the dashboard composer (Generator.tsx):
// same card surface, pill dropdowns, flush text area with bar caret, "Let AI
// decide" pill and the accent ↑ — typing real prompt ideas to itself. One
// click anywhere opens the real thing.

const PROMPTS = [
  "3 drinks our regulars gatekeep",
  "5 beginner gym mistakes I see every day",
  "why nobody's booking your barbershop",
  "what $60 gets you at our detailing studio",
  "the pasta place locals keep gatekeeping",
];

const TYPE_MS = 45;
const DELETE_MS = 20;
const HOLD_MS = 2200;
const GAP_MS = 400;

const PILLS = [
  { label: "Slides", value: "6 slides" },
  { label: "Layout", value: "Title + captions" },
  { label: "Goal", value: "Get followers" },
];

export function LandingComposer() {
  const [text, setText] = useState(PROMPTS[0]);

  useEffect(() => {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    let prompt = 0;
    let chars = PROMPTS[0].length;
    let deleting = true;
    let id: ReturnType<typeof setTimeout>;

    const step = () => {
      const full = PROMPTS[prompt];
      if (!deleting && chars === full.length) {
        deleting = true;
        id = setTimeout(step, HOLD_MS);
        return;
      }
      if (deleting) {
        chars -= 1;
        setText(full.slice(0, chars));
        if (chars === 0) {
          deleting = false;
          prompt = (prompt + 1) % PROMPTS.length;
          id = setTimeout(step, GAP_MS);
        } else {
          id = setTimeout(step, DELETE_MS);
        }
      } else {
        chars += 1;
        setText(PROMPTS[prompt].slice(0, chars));
        id = setTimeout(step, TYPE_MS);
      }
    };

    id = setTimeout(step, HOLD_MS);
    return () => clearTimeout(id);
  }, []);

  return (
    <a
      href="/dashboard"
      aria-label="Open the generator"
      className="mx-auto block w-full max-w-2xl rounded-3xl border border-white/8 bg-[#0f0f16]/[0.92] text-left shadow-[0_40px_80px_rgba(0,0,0,0.5)] transition-colors hover:border-white/15"
    >
      {/* settings row — same pill dropdowns as the real composer */}
      <div className="no-scrollbar flex flex-nowrap items-center gap-2 overflow-x-hidden px-6 pt-5">
        {PILLS.map((pill) => (
          <span
            key={pill.label}
            className="flex items-center gap-1.5 whitespace-nowrap rounded-full border border-white/10 px-3 py-2 text-[13px]"
          >
            <span className="text-white/40">{pill.label}</span>
            <span className="text-white/80">{pill.value}</span>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" className="text-white/40" aria-hidden>
              <path d="m6 9 6 6 6-6" />
            </svg>
          </span>
        ))}
      </div>

      <div className="flex flex-col gap-3 px-6 pb-5 pt-1">
        {/* prompt — flush with the card, bar caret, typing itself */}
        <p className="min-h-[3.4em] pt-4 text-lg leading-snug text-white">
          {text}
          <span
            aria-hidden
            className="animate-cursor ml-px inline-block h-[1.15em] w-px translate-y-px bg-white/35"
          />
        </p>

        {/* footer — attach + Let AI decide left, the accent ↑ right */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="grid h-8 w-8 place-items-center rounded-full border border-white/10 text-white/60">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
                <path d="M12 5v14M5 12h14" />
              </svg>
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 px-3.5 py-1.5 text-[13px] font-semibold text-white/60">
              Let AI decide
            </span>
          </div>
          <span
            aria-hidden
            className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-accent text-white shadow-[0_8px_24px_rgba(122,110,255,0.35)]"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M12 19V5M5 12l7-7 7 7" />
            </svg>
          </span>
        </div>
      </div>
    </a>
  );
}
