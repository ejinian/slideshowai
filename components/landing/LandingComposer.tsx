"use client";

import { useEffect, useRef, useState } from "react";

import { PINNED_TEMPLATES } from "@/lib/generator-options";

// A faithful, click-through replica of the dashboard composer (Generator.tsx)
// at rest: same card surface, the Slides / Detail / Versions pill row, the
// flush text area with its bar caret, the attach strip, the Try / Let AI decide
// / Supercharge row and the "Use our photos" switch beside the accent ↑.
// One click anywhere opens the real thing.
//
// It has to be re-checked whenever the real composer's controls change — this
// went stale once already, still showing the Layout and Goal pills months after
// both were removed (2026-08-07).

// The real composer types its placeholder out of three shuffled
// PINNED_TEMPLATES and shows the same three in the Try pill, so the replica
// reads from the same pool rather than a hand-written list that drifts.
const START_MS = 700;
const TYPE_MS = 46;
const HOLD_MS = 2200;
const DELETE_MS = 24;
const GAP_MS = 320;
const TRY_MS = 3500;

// Mirrors the real settings row's defaults: SLIDE_COUNTS' resting 6,
// DETAIL_LEVELS[0] and the Versions pill's unlocked "1".
const PILLS = [
  { label: "Slides", value: "6 slides" },
  { label: "Detail", value: "Short captions" },
  { label: "Versions", value: "1 slideshow" },
];

const Chevron = ({ className = "" }: { className?: string }) => (
  <svg
    width="10"
    height="10"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden
    className={className}
  >
    <path d="M6 9l6 6 6-6" />
  </svg>
);

const Sparkle = ({ size = 12 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
    <path d="M12 2l1.9 5.7a2 2 0 0 0 1.3 1.3L21 11l-5.8 2a2 2 0 0 0-1.3 1.3L12 20l-1.9-5.7A2 2 0 0 0 8.8 13L3 11l5.8-2a2 2 0 0 0 1.3-1.3L12 2z" />
  </svg>
);

export function LandingComposer() {
  // Shuffled on mount, never during render — the server has no way to agree
  // with a random pick, and a hydration mismatch here would swap the hero's
  // headline text on first paint. The real composer picks the same way.
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [text, setText] = useState("");
  const [tryIdx, setTryIdx] = useState(0);
  const anim = useRef({ idx: 0, chars: 0, deleting: false });

  useEffect(() => {
    setSuggestions([...PINNED_TEMPLATES].sort(() => Math.random() - 0.5).slice(0, 3));
  }, []);

  // Types / deletes through the pool, same cadence as the app's placeholder.
  useEffect(() => {
    if (!suggestions.length) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      setText(suggestions[0]);
      return;
    }
    const s = anim.current;
    s.idx = 0;
    s.chars = 0;
    s.deleting = false;
    let id: ReturnType<typeof setTimeout>;

    const step = () => {
      const full = suggestions[s.idx % suggestions.length];
      if (!s.deleting && s.chars >= full.length) {
        s.deleting = true;
        id = setTimeout(step, HOLD_MS);
        return;
      }
      if (s.deleting) {
        s.chars -= 1;
        setText(full.slice(0, Math.max(s.chars, 0)));
        if (s.chars <= 0) {
          s.deleting = false;
          s.idx += 1;
          id = setTimeout(step, GAP_MS);
        } else {
          id = setTimeout(step, DELETE_MS);
        }
      } else {
        s.chars += 1;
        setText(full.slice(0, s.chars));
        id = setTimeout(step, TYPE_MS);
      }
    };

    id = setTimeout(step, START_MS);
    return () => clearTimeout(id);
  }, [suggestions]);

  // The Try pill cycles the same three on its own timer, as it does in the app.
  useEffect(() => {
    if (!suggestions.length) return;
    const t = setInterval(
      () => setTryIdx((i) => (i + 1) % suggestions.length),
      TRY_MS,
    );
    return () => clearInterval(t);
  }, [suggestions]);

  return (
    <div className="mx-auto w-full max-w-3xl">
      <a
        href="/dashboard"
        aria-label="Open the generator"
        className="mx-auto block w-full max-w-3xl rounded-3xl border border-white/8 bg-[#0f0f16]/[0.92] px-3 pb-3 pt-1 text-left shadow-[0_40px_80px_rgba(0,0,0,0.5)] transition-colors hover:border-white/15 sm:px-0 sm:pb-0 sm:pt-0"
      >
        {/* Settings row — Slides / Detail / Versions, same pills as the real
            composer. Desktop only: on phones the app tucks them behind the
            slide-count pill in the bottom edge. */}
        <div className="no-scrollbar hidden flex-nowrap items-center gap-2 overflow-x-hidden px-6 pt-5 sm:flex">
          {PILLS.map((pill) => (
            <span
              key={pill.label}
              className="flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-white/10 px-3 py-2"
            >
              <span className="select-none text-[13px] text-white/40">{pill.label}</span>
              <span className="text-[13px] font-semibold text-white">{pill.value}</span>
              <Chevron className="text-white/30" />
            </span>
          ))}
        </div>

        <div className="flex flex-col gap-2 pt-0.5 sm:gap-3 sm:px-6 sm:pb-5 sm:pt-1">
          {/* prompt — flush with the card, bar caret, typing itself. Muted
              like the real composer's animated placeholder, because that is
              exactly what it is standing in for: an empty box mid-suggestion,
              not text someone has already committed to. */}
          <p className="min-h-[3.2em] pt-3 text-base leading-snug text-white/30 sm:min-h-[5.1em] sm:pt-4 sm:text-lg">
            {text}
            <span
              aria-hidden
              className="animate-cursor ml-px inline-block h-[1.15em] w-px translate-y-px bg-white/35"
            />
          </p>

          {/* Attach strip — desktop only, exactly as the empty upload state
              renders it: the "+" menu, the 10-photo counter, the hint. */}
          <div className="hidden flex-wrap items-center gap-2 sm:flex">
            <span className="grid h-8 w-8 place-items-center rounded-full border border-white/10 text-white/40">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
                <path d="M12 5v14M5 12h14" />
              </svg>
            </span>
            <span className="text-[12px] tabular-nums text-white/30">0/10</span>
            <span className="text-[12px] text-white/35">Add a photo to generate</span>
          </div>

          {/* Try suggestion + the two mode pills. Desktop only. */}
          <div className="hidden flex-wrap items-center gap-2 sm:flex">
            <span className="flex min-w-0 max-w-full items-center gap-1.5 rounded-full border border-white/10 px-3.5 py-1.5 text-[13px] text-white/60">
              <span className="shrink-0 text-white/35">Try:</span>
              {/* Keyed on the index so each rotation remounts and replays the
                  fade — the same trick the real pill uses. */}
              <span key={tryIdx} className="try-swap min-w-0 truncate">
                {suggestions[tryIdx % suggestions.length] ?? PINNED_TEMPLATES[0]}
              </span>
              <Chevron className="shrink-0 text-white/35" />
            </span>
            <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-accent/35 bg-accent/10 px-3.5 py-1.5 text-[13px] font-semibold text-accent-text">
              <Sparkle />
              Let AI decide
            </span>
            <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.03] px-3.5 py-1.5 text-[13px] font-semibold text-white/60">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                <path d="M13 2 4.5 12.5a1 1 0 0 0 .8 1.6H11l-1 8 8.5-10.6a1 1 0 0 0-.8-1.6H12l1-8z" />
              </svg>
              Supercharge
            </span>
          </div>
        </div>

        {/* Control row — the composer's bottom edge. On phones the controls
            live inside it, Claude-style; on desktop it's the ⌘↵ hint on the
            left and the source switch beside the accent ↑ on the right. */}
        <div className="flex items-center justify-between gap-2 pt-1 sm:gap-3 sm:px-6 sm:pb-5 sm:pt-0">
          <span className="hidden text-[13px] text-white/30 sm:inline">
            {"⌘↵"} to generate
          </span>

          {/* Phone cluster: attach, the slide-count pill, the AI sparkle. */}
          <div className="no-scrollbar flex min-w-0 items-center gap-1 overflow-x-hidden sm:hidden">
            <span className="flex h-10 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-full bg-white/[0.07] px-3 text-[13px] text-white min-[430px]:pr-3.5">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
                <path d="M12 5v14M5 12h14" />
              </svg>
              <span className="hidden min-[430px]:inline">Add photos</span>
            </span>
            <span className="flex h-10 shrink-0 items-center gap-1 whitespace-nowrap rounded-full bg-white/[0.07] px-3.5 text-[13px] text-white">
              6<span className="hidden min-[360px]:inline">slides</span>
              <Chevron className="text-white/35" />
            </span>
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-white/[0.07] text-accent-text">
              <Sparkle size={15} />
            </span>
          </div>

          <div className="flex items-center gap-2.5">
            {/* "Use our photos" — the desktop source switch, off by default
                (Upload is the resting source). */}
            <span className="hidden shrink-0 items-center gap-2.5 whitespace-nowrap rounded-full px-2 py-2 sm:flex">
              <span className="text-[13px] text-white/40">Use our photos</span>
              <span aria-hidden className="relative h-6 w-11 shrink-0 rounded-full bg-white/15">
                <span className="absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow-sm" />
              </span>
            </span>
            <span
              aria-hidden
              className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-accent text-white sm:h-11 sm:w-11 sm:shadow-[0_8px_24px_rgba(122,110,255,0.35)]"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M12 19V5M5 12l7-7 7 7" />
              </svg>
            </span>
          </div>
        </div>
      </a>

      {/* The under-box source control the app shows on phones — segmented, not
          a switch, with the resting "My photos" filled. */}
      <div className="mt-3 flex justify-center sm:hidden">
        <div className="flex items-center gap-1 rounded-full bg-white/[0.06] p-1">
          <span className="flex min-h-9 items-center rounded-full bg-accent px-4 text-[13px] font-semibold text-white shadow-[0_4px_14px_rgba(99,102,241,0.45)]">
            My photos
          </span>
          <span className="flex min-h-9 items-center rounded-full px-4 text-[13px] text-white/45">
            Our photos
          </span>
        </div>
      </div>
    </div>
  );
}
