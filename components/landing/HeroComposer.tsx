"use client";

import { useEffect, useState } from "react";

// The hero's click-through composer, typing real prompt ideas to itself.
// Product-true motion (this is literally what using the app looks like);
// honors prefers-reduced-motion by staying on the first prompt.

const PROMPTS = [
  "3 drinks our regulars gatekeep",
  "5 beginner gym mistakes I see every day",
  "what $60 gets you at our detailing studio",
  "the pasta place locals keep gatekeeping",
];

const TYPE_MS = 45;
const DELETE_MS = 22;
const HOLD_MS = 2200;
const GAP_MS = 400;

export function HeroComposer() {
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
      className="animate-rise mx-auto mt-9 block max-w-xl rounded-2xl bg-white/[0.04] p-5 text-left ring-1 ring-white/10 transition-colors hover:bg-white/[0.06] hover:ring-white/20 lg:mx-0"
      style={{ animationDelay: "180ms" }}
    >
      <p className="min-h-12 text-base text-white/50 sm:min-h-8 sm:text-lg">
        {text}
        <span aria-hidden className="animate-cursor text-accent-text">
          |
        </span>
      </p>
      <div className="mt-4 flex items-center justify-between">
        <span className="inline-flex items-center gap-2 text-sm text-white/35">
          <svg
            aria-hidden
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-4 w-4"
          >
            <rect x="3" y="3" width="18" height="18" rx="3" />
            <circle cx="9" cy="9" r="2" />
            <path d="m21 15-3.5-3.5L6 23" />
          </svg>
          Add photos
        </span>
        <span
          aria-hidden
          className="grid h-9 w-9 place-items-center rounded-full bg-accent text-base font-bold text-white"
        >
          ↑
        </span>
      </div>
    </a>
  );
}
