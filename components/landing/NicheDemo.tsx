"use client";

import { useEffect, useState } from "react";
import {
  DEFAULT_NICHE,
  DEMO_SLIDES,
  NICHES,
  type NicheId,
} from "@/lib/demo-data";
import { SlidePreview } from "./SlidePreview";
import { Reveal } from "./Reveal";

export function NicheDemo() {
  const [active, setActive] = useState<NicheId>(DEFAULT_NICHE);
  const [auto, setAuto] = useState(true);
  const slides = DEMO_SLIDES[active];

  // Auto-cycle through niches on load so the demo feels alive; stops once the
  // visitor takes control (or if they prefer reduced motion).
  useEffect(() => {
    if (!auto) return;
    if (
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
    ) {
      return;
    }
    const id = setInterval(() => {
      setActive((cur) => {
        const idx = NICHES.findIndex((n) => n.id === cur);
        return NICHES[(idx + 1) % NICHES.length].id;
      });
    }, 3500);
    return () => clearInterval(id);
  }, [auto]);

  function pick(id: NicheId) {
    setAuto(false);
    setActive(id);
  }

  return (
    <section id="demo" className="scroll-mt-20 bg-surface py-20 sm:py-24">
      <div className="mx-auto max-w-6xl px-5 sm:px-8">
        <Reveal className="mx-auto max-w-2xl text-center">
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
                className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold transition-all duration-200 active:scale-95 ${
                  selected
                    ? "scale-105 border-accent bg-accent text-accent-foreground shadow-md shadow-accent/30"
                    : "border-border bg-card text-muted hover:-translate-y-0.5 hover:border-accent hover:text-accent-text"
                }`}
              >
                <span aria-hidden>{niche.emoji}</span>
                {niche.label}
              </button>
            );
          })}
        </div>

        {/* slide previews with a soft glow behind them */}
        <div className="relative mt-10">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-1/2 -z-10 h-2/3 -translate-y-1/2 rounded-full bg-accent/10 blur-3xl"
          />
          {/* horizontal scroll on mobile, grid on desktop. keyed by niche so
              the fade-up animation replays on every switch. */}
          <div
            key={active}
            className="no-scrollbar flex snap-x snap-mandatory gap-4 overflow-x-auto pb-2 md:grid md:grid-cols-4 md:gap-5 md:overflow-visible md:pb-0"
          >
            {slides.map((slide, i) => (
              <div
                key={slide.image}
                className="w-[62%] shrink-0 snap-center animate-fade-up transition-transform duration-300 hover:-translate-y-1.5 sm:w-[44%] md:w-auto"
                style={{ animationDelay: `${i * 70}ms` }}
              >
                <SlidePreview slide={slide} index={i} total={slides.length} />
              </div>
            ))}
          </div>
        </div>

        <p className="mt-6 text-center text-sm text-muted">
          Preview only — real slideshows are generated from your products.
        </p>
      </div>
    </section>
  );
}
