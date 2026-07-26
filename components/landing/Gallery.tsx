"use client";

import { useEffect, useRef, useState } from "react";
import { AccentBar } from "./AccentBar";
import { Reveal } from "./Reveal";

// One phone, five real slideshows. Pick a deck with the pills up top; the
// phone plays that deck all the way through (TikTok-style progress bars,
// pauses on hover) while the rail on the right breaks down why it works.
//
// The teardown copy is structural analysis of the hook/format — no invented
// metrics. Don't add view counts here until we have real ones.

type Deck = {
  label: string;
  dir: string;
  count: number;
  title: string;
  why: { lead: string; body: string }[];
};

const DECKS: Deck[] = [
  {
    label: "Self improvement",
    dir: "morning-habits",
    count: 6,
    title: "4 morning habits that totally transformed my day",
    why: [
      {
        lead: "A number promises an ending.",
        body: "“4 habits” tells viewers exactly how long this takes — so they start swiping instead of scrolling past.",
      },
      {
        lead: "Personal, not instructional.",
        body: "“Transformed my day” reads like someone sharing, not a brand teaching. That's what keeps it out of ad territory.",
      },
      {
        lead: "One idea per slide.",
        body: "Each swipe pays off immediately, which is what drives completion — the signal TikTok rewards most.",
      },
    ],
  },
  {
    label: "Finance",
    dir: "money-habits",
    count: 6,
    title: "4 money habits silently draining your wallet",
    why: [
      {
        lead: "It accuses gently.",
        body: "“Silently draining” implies the viewer is already losing money without knowing — impossible to scroll past unresolved.",
      },
      {
        lead: "Curiosity gap on every slide.",
        body: "Each habit is a small reveal, so the deck keeps its tension the whole way down.",
      },
      {
        lead: "Zero jargon.",
        body: "Plain-language money advice travels far outside a finance audience, which widens the test pool TikTok shows it to.",
      },
    ],
  },
  {
    label: "Car buying",
    dir: "car-salesmen",
    count: 6,
    title: "4 tricks car salesmen pray you never learn",
    why: [
      {
        lead: "Forbidden knowledge.",
        body: "“Pray you never learn” frames the post as insider information someone doesn't want shared — the strongest hook shape there is.",
      },
      {
        lead: "A clear villain.",
        body: "Putting the viewer on the smart side of a lopsided deal makes it a share, not just a watch.",
      },
      {
        lead: "Immediately useful.",
        body: "Every slide is something you can use at a dealership this weekend, so it earns saves as well as views.",
      },
    ],
  },
  {
    label: "Gym",
    dir: "quit-gym",
    count: 6,
    title: "4 hidden reasons people quit the gym every january",
    why: [
      {
        lead: "“Hidden” beats “common.”",
        body: "It promises something the viewer hasn't already read a hundred times — the difference between a swipe and a scroll.",
      },
      {
        lead: "Timely without expiring.",
        body: "January anchors it to a moment people feel, but the advice still lands in June.",
      },
      {
        lead: "It names the fear.",
        body: "Everyone who has quit before recognises themselves in slide one, and self-recognition is what drives comments.",
      },
    ],
  },
  {
    label: "Creator growth",
    dir: "tiktok-growth",
    count: 5,
    title: "3 tricks that took my tiktok from 200 to 50k views",
    why: [
      {
        lead: "A concrete before and after.",
        body: "Specific numbers read as a real result rather than a claim — the reason this format keeps working.",
      },
      {
        lead: "Only three promises.",
        body: "A short deck sets a low commitment, which lifts the completion rate that decides how far a post travels.",
      },
      {
        lead: "Proof by demonstration.",
        body: "It's a slideshow about slideshows working — the format argues for itself while you read it.",
      },
    ],
  },
];

const SLIDE_MS = 2800;

export function Gallery() {
  const [deckIndex, setDeckIndex] = useState(0);
  const [slide, setSlide] = useState(0);
  const [paused, setPaused] = useState(false);
  const reduced = useRef(false);

  useEffect(() => {
    reduced.current =
      !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  }, []);

  // Play the selected deck all the way through, then loop.
  useEffect(() => {
    if (paused || reduced.current) return;
    const id = setInterval(
      () => setSlide((s) => (s + 1) % DECKS[deckIndex].count),
      SLIDE_MS,
    );
    return () => clearInterval(id);
  }, [deckIndex, paused]);

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
      <Reveal className="mx-auto max-w-6xl px-5 sm:px-8">
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

        <div className="mt-12 grid items-center gap-12 lg:grid-cols-[auto_1fr] lg:gap-16">
          {/* the phone */}
          <div className="mx-auto w-[260px] sm:w-[290px]">
            <div className="relative aspect-9/19 rounded-[2.75rem] border border-white/10 bg-neutral-950 p-2.5 shadow-2xl shadow-black/60 ring-1 ring-black/40">
              <div aria-hidden className="absolute -left-0.5 top-28 h-14 w-0.5 rounded-full bg-white/15" />
              <div aria-hidden className="absolute -left-0.5 top-44 h-9 w-0.5 rounded-full bg-white/15" />
              <div aria-hidden className="absolute -right-0.5 top-36 h-20 w-0.5 rounded-full bg-white/15" />

              <div
                className="relative h-full w-full overflow-hidden rounded-[2.1rem] bg-black"
                onMouseEnter={() => setPaused(true)}
                onMouseLeave={() => setPaused(false)}
              >
                <div
                  aria-hidden
                  className="absolute left-1/2 top-2 z-30 h-6 w-24 -translate-x-1/2 rounded-full bg-black"
                />

                {/* TikTok-story progress bars */}
                <div className="absolute inset-x-3 top-3 z-30 flex gap-1">
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
                            i === slide && !paused && !reduced.current
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

                {/* slide counter */}
                <span className="absolute bottom-3 right-3 z-30 rounded-full bg-black/60 px-2 py-0.5 text-[10px] font-semibold text-white/80">
                  {slide + 1}/{deck.count}
                </span>
              </div>
            </div>
          </div>

          {/* why it works */}
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-white/35">
              Why it works
            </p>
            <h3 className="font-tiktok mt-3 text-balance text-2xl font-extrabold leading-tight tracking-tight text-white sm:text-3xl">
              {deck.title}
            </h3>
            <div className="mt-7 space-y-6">
              {deck.why.map((point) => (
                <div key={point.lead} className="border-t border-white/10 pt-5">
                  <p className="text-[15px] leading-relaxed text-white/50">
                    <strong className="font-semibold text-accent-text">
                      {point.lead}
                    </strong>{" "}
                    {point.body}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </Reveal>
    </section>
  );
}
