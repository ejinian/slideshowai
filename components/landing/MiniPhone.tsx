"use client";

import { useEffect, useState } from "react";
import type { DemoSlide } from "@/lib/demo-data";

// A slim phone frame looping through a finished slideshow — the hero's proof
// units. Crossfade only, no chrome theatrics; honors prefers-reduced-motion.

const SLIDE_MS = 2600;

export function MiniPhone({
  slides,
  startAt = 0,
  className = "",
  captionClass = "text-[11px]",
}: {
  slides: DemoSlide[];
  /** Stagger sibling phones so they don't switch in lockstep. */
  startAt?: number;
  className?: string;
  captionClass?: string;
}) {
  const [index, setIndex] = useState(startAt % slides.length);

  useEffect(() => {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const id = setInterval(
      () => setIndex((i) => (i + 1) % slides.length),
      SLIDE_MS,
    );
    return () => clearInterval(id);
  }, [slides.length]);

  return (
    <div
      className={`relative aspect-9/19 overflow-hidden rounded-[2rem] border border-white/10 bg-black p-1.5 shadow-2xl shadow-black/60 ${className}`}
    >
      <div className="relative h-full w-full overflow-hidden rounded-[1.6rem] bg-black">
        {slides.map((slide, i) => (
          <div
            key={slide.image}
            className="absolute inset-0 transition-opacity duration-500"
            style={{ opacity: i === index ? 1 : 0 }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={slide.image}
              alt=""
              loading="lazy"
              decoding="async"
              draggable={false}
              className="absolute inset-0 h-full w-full object-cover"
            />
            <p
              className={`tiktok-caption absolute inset-x-2 top-[58%] -translate-y-1/2 text-center leading-tight ${captionClass}`}
            >
              {slide.caption}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
