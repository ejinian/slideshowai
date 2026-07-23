"use client";

import { useEffect, useState } from "react";

// The hero headline's rotating tail — each phrase in its own gradient,
// swapping on a rise-fade. Reduced-motion users get the first phrase, static.

const PHRASES = [
  { text: "you love", gradient: "from-pink-400 to-rose-500" },
  { text: "you adore", gradient: "from-indigo-400 to-violet-500" },
  { text: "that inspires", gradient: "from-sky-400 to-cyan-300" },
  { text: "that sells", gradient: "from-amber-400 to-orange-500" },
];

const SWAP_MS = 2600;

export function RotatingWord() {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const id = setInterval(
      () => setIndex((i) => (i + 1) % PHRASES.length),
      SWAP_MS,
    );
    return () => clearInterval(id);
  }, []);

  const phrase = PHRASES[index];
  return (
    <span
      key={phrase.text}
      className={`animate-word-swap block bg-linear-to-r ${phrase.gradient} bg-clip-text pb-[0.08em] text-transparent`}
    >
      {phrase.text}
    </span>
  );
}
