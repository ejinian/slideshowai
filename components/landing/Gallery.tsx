"use client";

import { useEffect, useRef, useState } from "react";
import { AccentBar } from "./AccentBar";
import { Reveal } from "./Reveal";

// One phone, five real generator exports. The panel beside it deliberately
// MIRRORS the dashboard's trend-detail card (components/dashboard/grow/
// TrendsView.tsx): chip row → accent "Why it works" card → "Format anatomy"
// beats. Same language as the product, so the landing doesn't invent a
// second design system. Keep them in sync if that panel changes.
//
// Copy is structural analysis of the hook/format — NO invented metrics.

type Deck = {
  label: string;
  dir: string;
  count: number;
  title: string;
  chips: string[];
  why: string;
  anatomy: { slides: string; beat: string }[];
};

const DECKS: Deck[] = [
  {
    label: "Self improvement",
    dir: "morning-habits",
    count: 6,
    title: "4 morning habits that totally transformed my day",
    chips: ["Numbered listicle", "6 slides", "Personal voice"],
    why: "The number promises an ending, so viewers start swiping instead of scrolling — and “transformed my day” reads like someone sharing, not a brand teaching.",
    anatomy: [
      { slides: "1", beat: "Numbered hook — promises exactly four payoffs" },
      { slides: "2–5", beat: "One habit per slide, each a concrete action" },
      { slides: "6", beat: "Soft close, no hard sell" },
    ],
  },
  {
    label: "Finance",
    dir: "money-habits",
    count: 6,
    title: "4 money habits silently draining your wallet",
    chips: ["Curiosity gap", "6 slides", "Plain language"],
    why: "“Silently draining” implies the viewer is already losing money without knowing — a tension that's impossible to scroll past unresolved.",
    anatomy: [
      { slides: "1", beat: "Accusation hook — you're already doing this" },
      { slides: "2–5", beat: "One habit revealed per slide" },
      { slides: "6", beat: "Reframe: what to do instead" },
    ],
  },
  {
    label: "Car buying",
    dir: "car-salesmen",
    count: 6,
    title: "4 tricks car salesmen pray you never learn",
    chips: ["Forbidden knowledge", "6 slides", "Clear villain"],
    why: "Framing the post as information someone doesn't want shared is the strongest hook shape there is — and it puts the viewer on the smart side of a lopsided deal.",
    anatomy: [
      { slides: "1", beat: "Insider-secret hook with a named villain" },
      { slides: "2–5", beat: "One tactic per slide, usable this weekend" },
      { slides: "6", beat: "Close on the viewer's advantage" },
    ],
  },
  {
    label: "Gym",
    dir: "quit-gym",
    count: 6,
    title: "4 hidden reasons people quit the gym every january",
    chips: ["Hidden-reason hook", "6 slides", "Self-recognition"],
    why: "“Hidden” promises something the viewer hasn't read a hundred times, and everyone who has quit before recognises themselves in slide one — which is what drives comments.",
    anatomy: [
      { slides: "1", beat: "Hook names a fear the viewer has lived" },
      { slides: "2–5", beat: "One reason per slide, no lecturing" },
      { slides: "6", beat: "Close on how to avoid it" },
    ],
  },
  {
    label: "Creator growth",
    dir: "tiktok-growth",
    count: 5,
    title: "3 tricks that took my tiktok from 200 to 50k views",
    chips: ["Before → after", "5 slides", "Concrete result"],
    why: "Specific numbers read as a real result rather than a claim, and only three promises keep the commitment low — which lifts the completion rate that decides how far a post travels.",
    anatomy: [
      { slides: "1", beat: "Before-and-after hook with hard numbers" },
      { slides: "2–4", beat: "One trick per slide" },
      { slides: "5", beat: "Close on the outcome" },
    ],
  },
];

const SLIDE_MS = 2800;

export function Gallery() {
  const [deckIndex, setDeckIndex] = useState(0);
  const [slide, setSlide] = useState(0);
  const reduced = useRef(false);

  useEffect(() => {
    reduced.current =
      !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  }, []);

  // Always playing. There is deliberately NO hover-pause: the cursor often
  // rests over the phone while reading the teardown beside it, which silently
  // froze the deck and read as "the slides aren't changing".
  useEffect(() => {
    if (reduced.current) return;
    const id = setInterval(
      () => setSlide((s) => (s + 1) % DECKS[deckIndex].count),
      SLIDE_MS,
    );
    return () => clearInterval(id);
  }, [deckIndex]);

  const deck = DECKS[deckIndex];
  const frames = Array.from(
    { length: deck.count },
    (_, i) => `/showcase/${deck.dir}/slide-0${i + 1}.jpg`,
  );

  return (
    <section className="relative overflow-hidden py-20 sm:py-28">
      <div
        aria-hidden
        className="bg-landing-glow-mid pointer-events-none absolute inset-0 -z-10"
      />
      <Reveal className="mx-auto max-w-5xl px-5 sm:px-8">
        <div className="flex flex-col items-center text-center">
          <h2 className="font-tiktok text-balance text-3xl font-extrabold tracking-tight sm:text-4xl">
            Made with SlideLabsAI
          </h2>
          <AccentBar />
        </div>

        {/* deck selector */}
        <div className="no-scrollbar mt-9 flex items-center justify-start gap-2 overflow-x-auto sm:justify-center">
          {DECKS.map((d, i) => (
            <button
              key={d.label}
              type="button"
              onClick={() => {
                setDeckIndex(i);
                setSlide(0);
              }}
              className={`shrink-0 rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
                i === deckIndex
                  ? "bg-white text-black"
                  : "border border-white/10 text-white/60 hover:border-white/25 hover:text-white"
              }`}
            >
              {d.label}
            </button>
          ))}
        </div>

        {/* the deck + its teardown, in one panel — same shell as the app's
            trend detail sheet */}
        <div className="card-depth mt-10 grid gap-8 p-5 sm:p-7 lg:grid-cols-[auto_1fr] lg:gap-10">
          {/* phone */}
          <div className="mx-auto w-[220px] sm:w-[240px]">
            <div className="relative aspect-9/19 rounded-[2.25rem] border border-white/10 bg-neutral-950 p-2 shadow-2xl shadow-black/60">
              <div className="relative h-full w-full overflow-hidden rounded-[1.75rem] bg-black">
                <div
                  aria-hidden
                  className="absolute left-1/2 top-1.5 z-30 h-5 w-20 -translate-x-1/2 rounded-full bg-black"
                />
                <div className="absolute inset-x-2.5 top-2.5 z-30 flex gap-1">
                  {frames.map((_, i) => (
                    <span
                      key={i}
                      className="h-0.5 flex-1 overflow-hidden rounded-full bg-white/25"
                    >
                      <span
                        className="block h-full rounded-full bg-white transition-[width] ease-linear"
                        style={{
                          width: i <= slide ? "100%" : "0%",
                          transitionDuration:
                            i === slide && !reduced.current
                              ? `${SLIDE_MS}ms`
                              : "0ms",
                        }}
                      />
                    </span>
                  ))}
                </div>
                {frames.map((src, i) => (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img
                    key={src}
                    src={src}
                    alt=""
                    decoding="async"
                    draggable={false}
                    className="absolute inset-0 h-full w-full object-cover transition-opacity duration-300"
                    style={{ opacity: i === slide ? 1 : 0 }}
                  />
                ))}
                <span className="absolute bottom-2.5 right-2.5 z-30 rounded-full bg-black/60 px-2 py-0.5 text-[10px] font-semibold text-white/80">
                  {slide + 1}/{deck.count}
                </span>
              </div>
            </div>
          </div>

          {/* teardown — mirrors the dashboard trend panel */}
          <div className="min-w-0">
            <h3 className="text-lg font-bold leading-snug tracking-tight text-white sm:text-xl">
              {deck.title}
            </h3>

            <div className="mt-3 flex flex-wrap items-center gap-1.5 text-xs">
              {deck.chips.map((chip) => (
                <span
                  key={chip}
                  className="rounded-full bg-white/[0.06] px-2.5 py-1 text-white/70"
                >
                  {chip}
                </span>
              ))}
            </div>

            <div className="mt-4 rounded-xl bg-accent/[0.08] p-3.5 ring-1 ring-accent/20">
              <p className="text-[11px] font-bold uppercase tracking-wider text-accent-text">
                Why it works
              </p>
              <p className="mt-1 text-sm leading-relaxed text-white/70">
                {deck.why}
              </p>
            </div>

            <div className="mt-4">
              <p className="text-[11px] font-bold uppercase tracking-wider text-white/35">
                Format anatomy
              </p>
              <div className="mt-2 flex flex-col gap-1.5">
                {deck.anatomy.map((b) => (
                  <div key={b.slides} className="flex items-center gap-2.5">
                    <span className="w-11 shrink-0 rounded-md bg-white/[0.06] py-0.5 text-center text-[11px] font-semibold text-white/60">
                      {b.slides}
                    </span>
                    <span className="min-w-0 text-[13px] leading-snug text-white/70">
                      {b.beat}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <a
              href="/dashboard"
              className="mt-5 inline-flex rounded-full bg-accent px-5 py-2.5 text-sm font-bold text-white shadow-lg shadow-accent/30 transition-all hover:brightness-110 active:scale-[0.98]"
            >
              Make one like this
            </a>
          </div>
        </div>
      </Reveal>
    </section>
  );
}
