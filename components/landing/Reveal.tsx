"use client";

import { useEffect, useRef, useState } from "react";

// One-shot scroll reveal — fades/rises a section in the first time it enters
// the viewport. Styles live in globals (.reveal / .is-visible); reduced-motion
// users get instant visibility via the CSS override.
export function Reveal({
  children,
  className = "",
  delay = 0,
}: {
  children: React.ReactNode;
  className?: string;
  delay?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Fail open: anything already on screen at mount (or any environment where
    // IntersectionObserver is missing/stalled) shows immediately.
    const rect = el.getBoundingClientRect();
    if (
      !("IntersectionObserver" in window) ||
      (rect.top < window.innerHeight && rect.bottom > 0)
    ) {
      setVisible(true);
      return;
    }
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          io.disconnect();
        }
      },
      { threshold: 0.12 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className={`reveal ${visible ? "is-visible" : ""} ${className}`}
      style={delay ? { transitionDelay: `${delay}ms` } : undefined}
    >
      {children}
    </div>
  );
}
