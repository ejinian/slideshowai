"use client";

import { useEffect, useRef, useState } from "react";
import {
  DEFAULT_NICHE,
  DEMO_SLIDES,
  NICHES,
  type NicheId,
} from "@/lib/demo-data";
import { SlidePreview } from "./SlidePreview";
import { Reveal } from "./Reveal";
import { Eyebrow } from "./Eyebrow";

// One "beat" of the autoplay spotlight — how long each slide stays lit before
// the highlight jumps to the next card.
const PLAY_MS = 1900;

export function NicheDemo() {
  const [active, setActive] = useState<NicheId>(DEFAULT_NICHE);
  const [auto, setAuto] = useState(true);
  const [paused, setPaused] = useState(false);
  const [tick, setTick] = useState(0);
  const [mounted, setMounted] = useState(false);
  const reduced = useRef(false);

  const slides = DEMO_SLIDES[active];

  useEffect(() => {
    setMounted(true);
    reduced.current =
      typeof window !== "undefined" &&
      !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  }, []);

  // The heartbeat: advance the spotlight one card at a time. Pauses while the
  // visitor is hovering a card (so they can actually read it).
  useEffect(() => {
    if (!mounted || paused || reduced.current) return;
    const id = setInterval(() => setTick((t) => t + 1), PLAY_MS);
    return () => clearInterval(id);
  }, [mounted, paused]);

  // When the spotlight finishes a full pass over the 4 slides, roll on to the
  // next niche — but only while we're still auto-playing (the visitor hasn't
  // taken over by tapping a pill).
  useEffect(() => {
    if (!auto || tick === 0 || tick % slides.length !== 0) return;
    setActive((cur) => {
      const idx = NICHES.findIndex((n) => n.id === cur);
      return NICHES[(idx + 1) % NICHES.length].id;
    });
  }, [tick, auto, slides.length]);

  function pick(id: NicheId) {
    setAuto(false);
    setActive(id);
    setTick(0); // restart the spotlight from slide 1 of the chosen niche
  }

  const spotlight = mounted && !reduced.current;
  const current = spotlight ? tick % slides.length : -1;

  return (
    <section id="demo" className="scroll-mt-20 bg-surface py-20 sm:py-24">
      <div className="mx-auto max-w-6xl px-5 sm:px-8">
        <Reveal className="mx-auto max-w-2xl text-center">
          <Eyebrow>Live demo</Eyebrow>
          <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
            See it in action
          </h2>
          <p className="mt-4 text-lg text-muted">
            Pick a niche and watch the slideshow change. Every set is sized for
            TikTok Photo Mode and captioned to stop the scroll.
          </p>
        </Reveal>

        {/* niche selector pills */}
        <div
          role="group"
          aria-label="Choose a niche"
          className="mt-9 flex flex-wrap items-center justify-center gap-2.5"
        >
          {NICHES.map((niche) => {
            const selected = niche.id === active;
            return (
              <button
                key={niche.id}
                type="button"
                aria-pressed={selected}
                onClick={() => pick(niche.id)}
                className={`inline-flex items-center rounded-full border px-5 py-2 text-sm font-semibold transition-all duration-200 active:scale-95 ${
                  selected
                    ? "scale-105 border-accent bg-accent text-accent-foreground shadow-md shadow-accent/30"
                    : "border-border bg-card text-muted hover:-translate-y-0.5 hover:border-accent hover:text-accent-text"
                }`}
              >
                {niche.label}
              </button>
            );
          })}
        </div>

        {/* live autoplay status line */}
        <div className="mt-5 flex items-center justify-center gap-2 text-xs font-medium text-muted">
          {spotlight && !paused ? (
            <>
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent-text opacity-75" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-accent-text" />
              </span>
              Auto-playing — hover any slide to pause
            </>
          ) : (
            <span className="text-muted/80">Paused — move away to resume</span>
          )}
        </div>

        {/* slide previews with a soft glow behind them */}
        <div className="relative mt-8">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-1/2 -z-10 h-2/3 -translate-y-1/2 rounded-full bg-accent/10 blur-3xl"
          />
          {/* horizontal scroll on mobile, grid on desktop. keyed by niche so
              the generate-in animation replays on every switch. */}
          <div
            key={active}
            onMouseEnter={() => setPaused(true)}
            onMouseLeave={() => setPaused(false)}
            className="no-scrollbar flex snap-x snap-mandatory gap-4 overflow-x-auto px-1 pb-6 pt-3 md:grid md:grid-cols-4 md:gap-5 md:overflow-visible"
          >
            {slides.map((slide, i) => (
              <div
                key={slide.image}
                className="w-[62%] shrink-0 snap-center animate-generate sm:w-[44%] md:w-auto"
                style={{ animationDelay: `${i * 90}ms` }}
              >
                <SlidePreview
                  slide={slide}
                  index={i}
                  total={slides.length}
                  active={i === current}
                  dimmed={current !== -1 && i !== current}
                  cycle={tick}
                  playMs={PLAY_MS}
                />
              </div>
            ))}
          </div>
        </div>

        <p className="mt-4 text-center text-sm text-muted">
          Preview only — real slideshows are generated from your products.
        </p>
      </div>
    </section>
  );
}
