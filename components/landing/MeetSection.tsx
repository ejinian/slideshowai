"use client";

import { useEffect, useState } from "react";
import { DEMO_SLIDES } from "@/lib/demo-data";
import { AccentBar } from "./AccentBar";
import { Reveal } from "./Reveal";

// Lovable's "Meet" pattern at Lovable's proportions: a big soft panel holding
// an app window, playing a scripted session on a loop (the dashboard composer
// types → the deck builds in with a dashed selection → Post gets clicked)
// while the step titles on the right light up in sync. Pure CSS transitions
// on a stage timer. Reduced-motion shows the finished state, all steps lit.

const PROMPT = "make me a slideshow that sells my product";
const STAGE_MS = 3800;

const STEPS = [
  {
    title: "Start with an idea",
    desc: "Describe your business in one line — or just drop in your own photos.",
  },
  {
    title: "Watch it come to life",
    desc: "AI writes the hook and captions and lays out your slides in front of you.",
  },
  {
    title: "Post and grow",
    desc: "Publish straight to TikTok, or queue it on a schedule so your week goes out automatically.",
  },
];

const PILLS = [
  { label: "Slides", value: "6 slides" },
  { label: "Layout", value: "Title + captions" },
  { label: "Goal", value: "Get followers" },
];

// Cursor waypoints inside the window, one per stage.
const CURSOR: Record<number, { left: string; top: string }> = {
  0: { left: "82%", top: "30%" },
  1: { left: "18%", top: "62%" },
  2: { left: "84%", top: "92%" },
};

export function MeetSection() {
  const [stage, setStage] = useState(0);
  const [typed, setTyped] = useState(PROMPT);
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      setReduced(true);
      setStage(2);
      return;
    }
    const id = setInterval(() => setStage((s) => (s + 1) % 3), STAGE_MS);
    return () => clearInterval(id);
  }, []);

  // Retype the prompt at the start of every loop.
  useEffect(() => {
    if (reduced) return;
    if (stage !== 0) {
      setTyped(PROMPT);
      return;
    }
    setTyped("");
    let chars = 0;
    const id = setInterval(() => {
      chars += 1;
      setTyped(PROMPT.slice(0, chars));
      if (chars >= PROMPT.length) clearInterval(id);
    }, 50);
    return () => clearInterval(id);
  }, [stage, reduced]);

  const tiles = DEMO_SLIDES.coffee;
  const built = stage >= 1 || reduced;

  return (
    <section
      id="how-it-works"
      className="relative scroll-mt-20 overflow-hidden py-20 sm:py-28"
    >
      <div
        aria-hidden
        className="glow-blob animate-float-b -top-20 left-[6%] h-80 w-80 bg-accent/10"
      />
      <Reveal className="mx-auto max-w-6xl px-5 sm:px-8">
        <h2 className="font-tiktok max-w-3xl text-balance text-3xl font-extrabold tracking-tight sm:text-4xl">
          Meet SlideLabsAI
        </h2>
        <AccentBar />

        <div className="mt-12 grid items-center gap-12 lg:grid-cols-[1.4fr_1fr] lg:gap-16">
          {/* ── the big canvas: soft panel wrapping an app window ── */}
          <div className="rounded-3xl bg-white/[0.03] p-2.5 ring-1 ring-white/8 sm:p-10">
            <div className="relative overflow-hidden rounded-2xl border border-white/8 bg-[#0a0a0d] shadow-[0_40px_80px_rgba(0,0,0,0.5)]">
              {/* window top bar — desktop only; at phone width the chrome
                  eats space and reads as clutter */}
              <div className="hidden items-center justify-between border-b border-white/6 px-4 py-2.5 sm:flex">
                <div className="flex items-center gap-1.5">
                  {[0, 1, 2].map((i) => (
                    <span key={i} className="h-2 w-2 rounded-full bg-white/15" />
                  ))}
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="h-2 w-12 rounded-full bg-white/8" />
                  <span className="h-2 w-8 rounded-full bg-white/8" />
                </div>
              </div>

              <div className="p-3 sm:p-6">
                {/* the dashboard composer, exactly — typing the idea */}
                <div className="rounded-3xl border border-white/8 bg-[#0f0f16]/[0.92] shadow-[0_20px_50px_rgba(0,0,0,0.45)]">
                  {/* Settings pills are desktop-only, exactly like the real
                      composer — on a phone the app hides them behind the
                      slide-count pill in the control row below. */}
                  <div className="hidden flex-wrap items-center gap-1.5 px-3.5 pt-3.5 sm:flex sm:gap-2 sm:px-5 sm:pt-4">
                    {PILLS.map((pill) => (
                      <span
                        key={pill.label}
                        className="flex items-center gap-1.5 whitespace-nowrap rounded-full border border-white/10 px-2.5 py-1 text-[11px] sm:px-3 sm:py-1.5 sm:text-xs"
                      >
                        <span className="text-white/40">{pill.label}</span>
                        <span className="text-white/80">{pill.value}</span>
                        <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" className="text-white/40" aria-hidden>
                          <path d="m6 9 6 6 6-6" />
                        </svg>
                      </span>
                    ))}
                  </div>
                  <div className="flex flex-col gap-2 px-3 pb-3 pt-1 sm:gap-3 sm:px-5 sm:pb-4">
                    <p className="min-h-[2.6em] text-pretty pt-3 text-[13px] leading-snug text-white sm:text-base">
                      {stage === 0 && !reduced ? typed : PROMPT}
                      {stage === 0 && !reduced && (
                        <span
                          aria-hidden
                          className="animate-cursor ml-px inline-block h-[1.1em] w-px translate-y-px bg-white/35"
                        />
                      )}
                    </p>
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex min-w-0 items-center gap-1.5 sm:gap-2">
                        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-white/[0.07] text-white/80 sm:h-7 sm:w-7 sm:bg-transparent sm:text-white/60 sm:ring-1 sm:ring-white/10 sm:ring-inset">
                          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden className="sm:h-3 sm:w-3">
                            <path d="M12 5v14M5 12h14" />
                          </svg>
                        </span>
                        {/* Phone: the app's slide-count pill + sparkle circle. */}
                        <span className="flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full bg-white/[0.07] px-3.5 py-2.5 text-[13px] text-white sm:hidden">
                          6 slides
                          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="text-white/35">
                            <path d="m6 9 6 6 6-6" />
                          </svg>
                        </span>
                        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-white/[0.07] text-accent-text sm:hidden">
                          <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                            <path d="M12 2l1.9 5.7a2 2 0 0 0 1.3 1.3L21 11l-5.8 2a2 2 0 0 0-1.3 1.3L12 20l-1.9-5.7A2 2 0 0 0 8.8 13L3 11l5.8-2a2 2 0 0 0 1.3-1.3L12 2z" />
                          </svg>
                        </span>
                        <span className="hidden items-center gap-1.5 rounded-full border border-white/10 px-3 py-1 text-xs font-semibold text-white/60 sm:inline-flex">
                          Let AI decide
                        </span>
                      </div>
                      <span
                        aria-hidden
                        className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-accent text-white sm:h-9 sm:w-9 sm:shadow-[0_8px_24px_rgba(122,110,255,0.35)]"
                      >
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="sm:h-[15px] sm:w-[15px]">
                          <path d="M12 19V5M5 12l7-7 7 7" />
                        </svg>
                      </span>
                    </div>
                  </div>
                </div>

                {/* the quiet line the app puts under the box on phones */}
                <div className="mt-2.5 flex items-center justify-center gap-2.5 text-[12px] text-white/30 sm:hidden">
                  <span className="text-white/45">Use this idea</span>
                  <span aria-hidden className="text-white/15">·</span>
                  <span>
                    No photos? <span className="text-white/60">Use ours</span>
                  </span>
                </div>

                {/* the deck builds in — stage 1 */}
                <div className="mt-4 grid grid-cols-4 gap-1.5 sm:mt-5 sm:gap-3">
                  {tiles.map((slide, i) => (
                    <figure
                      key={slide.image}
                      className={`relative aspect-9/16 overflow-hidden rounded-xl ring-1 ring-white/10 transition-all duration-500 ${
                        built ? "scale-100 opacity-100" : "scale-90 opacity-0"
                      }`}
                      style={{ transitionDelay: built ? `${i * 130}ms` : "0ms" }}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={slide.image}
                        alt=""
                        loading="lazy"
                        decoding="async"
                        className="absolute inset-0 h-full w-full object-cover"
                      />
                      <figcaption className="tiktok-caption absolute inset-x-1 top-[58%] -translate-y-1/2 text-center text-[8px] leading-tight sm:inset-x-1.5 sm:text-[10px]">
                        {slide.caption}
                      </figcaption>
                      {i === 0 && stage === 1 && !reduced && (
                        <span
                          aria-hidden
                          className="absolute inset-0 rounded-xl border-2 border-dashed border-accent"
                        />
                      )}
                    </figure>
                  ))}
                </div>

                {/* footer — stage 2 clicks Post */}
                <div className="mt-4 flex items-center justify-between sm:mt-5">
                  <span
                    className={`rounded-full bg-emerald-400/15 px-3 py-1.5 text-xs font-semibold text-emerald-300 transition-opacity duration-300 ${
                      stage === 2 || reduced ? "opacity-100" : "opacity-0"
                    }`}
                  >
                    Posted ✓
                  </span>
                  <span
                    className={`rounded-full bg-accent px-5 py-2 text-sm font-semibold text-white transition-all duration-300 ${
                      stage === 2 && !reduced ? "scale-95 brightness-125" : ""
                    }`}
                  >
                    Post to TikTok
                  </span>
                </div>
              </div>

              {/* the roaming cursor */}
              {!reduced && (
                <span
                  aria-hidden
                  className="pointer-events-none absolute z-10 hidden transition-all duration-700 ease-out sm:block"
                  style={CURSOR[stage]}
                >
                  <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden>
                    <path
                      d="M5 2.5 L18.5 11.5 L11.8 12.6 L15.2 19.6 L12.2 21 L8.9 14 L5 17.5 Z"
                      fill="#fff"
                      stroke="#000"
                      strokeWidth="1.2"
                    />
                  </svg>
                </span>
              )}
            </div>
          </div>

          {/* ── the steps rail, lit in sync ── */}
          <div className="space-y-9">
            {STEPS.map((step, i) => {
              const active = reduced || stage === i;
              return (
                <div key={step.title}>
                  <h3
                    className={`font-tiktok text-2xl font-extrabold tracking-tight transition-colors duration-500 sm:text-3xl ${
                      active ? "text-white" : "text-white/30"
                    }`}
                  >
                    {step.title}
                  </h3>
                  <p
                    className={`mt-2 max-w-md text-[15px] leading-relaxed transition-colors duration-500 ${
                      active ? "text-white/70" : "text-white/30"
                    }`}
                  >
                    {step.desc}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      </Reveal>
    </section>
  );
}
