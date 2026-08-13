"use client";

import { useCallback, useState } from "react";

// Hub-card thumbnail. Each of these is baked server-side on demand, so they
// arrive at different times — a raw <img> made the grid pop in chopped. This
// fades each one over the card's #111 placeholder as it lands, and lazy-loads
// everything below the first row so the visible cards get the bandwidth first.
export default function FadeThumb({
  src,
  alt,
  eager = false,
}: {
  src: string;
  alt: string;
  eager?: boolean;
}) {
  const [loaded, setLoaded] = useState(false);
  // onLoad misses images that completed before hydration (e.g. served from the
  // browser cache) — the ref callback catches those.
  const ref = useCallback((img: HTMLImageElement | null) => {
    if (img?.complete) setLoaded(true);
  }, []);
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      ref={ref}
      src={src}
      alt={alt}
      loading={eager ? "eager" : "lazy"}
      decoding="async"
      onLoad={() => setLoaded(true)}
      className={`h-full w-full object-cover transition-[opacity,transform] duration-500 group-hover:scale-105 ${
        loaded ? "opacity-100" : "opacity-0"
      }`}
    />
  );
}
