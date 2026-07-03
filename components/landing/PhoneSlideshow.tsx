"use client";

import { useEffect, useRef, useState } from "react";

/** A single TikTok Photo Mode slide shown inside the phone. */
interface PhoneSlide {
  image: string;
  caption: string;
}

// Real product photos from the library, captioned in a TikTok Photo Mode voice.
// This is the same illustrative content the rest of the demo uses — just framed
// inside a phone so the hero shows exactly what the app spits out.
const SLIDES: PhoneSlide[] = [
  { image: "/library/gym/gym-01.jpg", caption: "POV: you finally found a gym that feels like home" },
  { image: "/library/gym/gym-16.jpg", caption: "24/7 access. No contracts. No judgment." },
  { image: "/library/gym/gym-10.jpg", caption: "Coaching that actually moves the needle" },
  { image: "/library/gym/gym-07.jpg", caption: "Day 1 vs day 90 — same person, new energy" },
  { image: "/library/gym/gym-17.jpg", caption: "Your first week is on us → link in bio" },
];

const SLIDE_MS = 2800;

export function PhoneSlideshow() {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const reduced = useRef(false);
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    reduced.current =
      typeof window !== "undefined" &&
      !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  }, []);

  // Subtle 3D tilt that follows the cursor — mouse only, honors reduced motion.
  function onTiltMove(e: React.PointerEvent<HTMLDivElement>) {
    if (reduced.current || e.pointerType !== "mouse") return;
    const el = bodyRef.current;
    if (!el) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const px = (e.clientX - rect.left) / rect.width - 0.5;
    const py = (e.clientY - rect.top) / rect.height - 0.5;
    el.style.transform = `perspective(900px) rotateY(${(px * 9).toFixed(2)}deg) rotateX(${(-py * 9).toFixed(2)}deg)`;
  }

  function onTiltLeave() {
    const el = bodyRef.current;
    if (el) el.style.transform = "perspective(900px) rotateY(0deg) rotateX(0deg)";
  }

  // Auto-advance through the feed so it reads as a live, scrolling slideshow.
  useEffect(() => {
    if (paused || reduced.current) return;
    const id = setInterval(() => {
      setIndex((i) => (i + 1) % SLIDES.length);
    }, SLIDE_MS);
    return () => clearInterval(id);
  }, [paused]);

  return (
    <div
      className="relative mx-auto w-[270px] sm:w-[300px]"
      onPointerMove={onTiltMove}
      onPointerLeave={onTiltLeave}
    >
      {/* soft glow pooled behind the device */}
      <div
        aria-hidden
        className="pointer-events-none absolute -inset-10 -z-10 rounded-full bg-accent/25 blur-[90px]"
      />

      {/* phone body */}
      <div
        ref={bodyRef}
        className="relative aspect-9/19 rounded-[2.75rem] border border-white/10 bg-neutral-950 p-2.5 shadow-2xl shadow-black/60 ring-1 ring-black/40 transition-transform duration-300 ease-out will-change-transform"
      >
        {/* side buttons */}
        <div aria-hidden className="absolute -left-0.5 top-28 h-14 w-0.5 rounded-full bg-white/15" />
        <div aria-hidden className="absolute -left-0.5 top-44 h-9 w-0.5 rounded-full bg-white/15" />
        <div aria-hidden className="absolute -right-0.5 top-36 h-20 w-0.5 rounded-full bg-white/15" />

        {/* screen */}
        <div
          className="relative h-full w-full overflow-hidden rounded-[2.1rem] bg-black"
          onMouseEnter={() => setPaused(true)}
          onMouseLeave={() => setPaused(false)}
        >
          {/* notch / dynamic island */}
          <div
            aria-hidden
            className="absolute left-1/2 top-2 z-30 h-6 w-24 -translate-x-1/2 rounded-full bg-black"
          />

          {/* segmented progress bar (TikTok-story style) */}
          <div className="absolute inset-x-3 top-3 z-30 flex gap-1">
            {SLIDES.map((_, i) => (
              <span
                key={i}
                className="h-0.5 flex-1 overflow-hidden rounded-full bg-white/25"
              >
                <span
                  className="block h-full rounded-full bg-white transition-[width] ease-linear"
                  style={{
                    width: i < index ? "100%" : i === index ? "100%" : "0%",
                    transitionDuration:
                      i === index && !paused && !reduced.current
                        ? `${SLIDE_MS}ms`
                        : "0ms",
                  }}
                />
              </span>
            ))}
          </div>

          {/* sliding feed of images — swipes horizontally, left to right */}
          <div
            className="flex h-full w-full transition-transform duration-700 ease-out"
            style={{ transform: `translateX(-${index * 100}%)` }}
          >
            {SLIDES.map((slide, i) => (
              <div key={slide.image} className="relative h-full w-full shrink-0">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={slide.image}
                  alt=""
                  className="absolute inset-0 h-full w-full object-cover"
                  draggable={false}
                  loading={i === 0 ? "eager" : "lazy"}
                />
                {/* legibility scrim */}
                <div
                  aria-hidden
                  className="absolute inset-x-0 bottom-0 h-3/5 bg-linear-to-t from-black/85 via-black/40 to-transparent"
                />
                {/* caption — sits around the vertical middle of the image */}
                <p className="absolute inset-x-5 top-1/2 -translate-y-1/2 text-balance text-center text-[19px] font-extrabold leading-tight text-white drop-shadow-[0_2px_8px_rgba(0,0,0,0.85)]">
                  {slide.caption}
                </p>
              </div>
            ))}
          </div>

          {/* AI-generated badge */}
          <div className="absolute left-3 top-7 z-30 inline-flex items-center gap-1.5 rounded-full bg-black/50 px-2.5 py-1 text-[10px] font-semibold text-white backdrop-blur-sm">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent-text opacity-75" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-accent-text" />
            </span>
            AI generated
          </div>

          {/* right-side action rail — pure decoration to sell the TikTok look */}
          <div className="absolute bottom-20 right-2.5 z-30 flex flex-col items-center gap-4 text-white">
            <RailIcon label="like">
              <path d="M12 21s-7.5-4.6-10-9.2C.6 9 1.6 5.5 4.8 4.8 6.9 4.3 8.9 5.3 10 7c1.1-1.7 3.1-2.7 5.2-2.2C18.4 5.5 19.4 9 18 11.8 15.5 16.4 12 21 12 21z" />
            </RailIcon>
            <RailIcon label="comment">
              <path d="M21 11.5a8.5 8.5 0 0 1-12.3 7.6L3 21l1.9-5.7A8.5 8.5 0 1 1 21 11.5z" />
            </RailIcon>
            <RailIcon label="share">
              <path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7M16 6l-4-4-4 4M12 2v13" />
            </RailIcon>
          </div>

          {/* account row, bottom-left */}
          <div className="absolute bottom-5 left-3 z-30 flex items-center gap-2">
            <span className="h-7 w-7 rounded-full bg-linear-to-br from-accent to-fuchsia-500 ring-2 ring-white/80" />
            <span className="text-xs font-semibold text-white drop-shadow">@yourbrand</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function RailIcon({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <span className="flex flex-col items-center gap-1">
      <span className="flex h-9 w-9 items-center justify-center rounded-full bg-black/35 backdrop-blur-sm">
        <svg
          viewBox="0 0 24 24"
          aria-label={label}
          className="h-5 w-5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          {children}
        </svg>
      </span>
    </span>
  );
}
