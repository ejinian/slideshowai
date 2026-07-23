import { LandingComposer } from "./LandingComposer";
import { RotatingWord } from "./RotatingWord";

// Lovable-style hero: a tall centered room with nothing in it but the
// headline, one subline, and the product's real composer typing to itself
// over the warm sunrise glow. The composer IS the CTA.

export function Hero() {
  return (
    <section id="top" className="relative overflow-hidden">
      {/* the scene: cool corners, warm bloom rising behind the composer */}
      <div
        aria-hidden
        className="bg-lovable-hero animate-glow-breathe pointer-events-none absolute inset-x-0 -top-16 bottom-0 -z-10"
      />
      <div
        aria-hidden
        className="bg-noise pointer-events-none absolute inset-x-0 -top-16 bottom-0 -z-10 opacity-[0.05]"
      />

      <div className="mx-auto flex min-h-[calc(100svh-8rem)] max-w-4xl flex-col items-center justify-center px-5 pb-24 pt-16 text-center sm:px-8">
        <h1 className="animate-rise font-tiktok text-balance text-5xl font-extrabold leading-[1.03] tracking-tight sm:text-6xl md:text-7xl">
          <span className="block">Build a slideshow</span>
          <RotatingWord />
        </h1>

        <p
          className="animate-rise mt-5 max-w-xl text-pretty text-lg leading-relaxed text-white/65 sm:text-xl"
          style={{ animationDelay: "90ms" }}
        >
          Create post-ready TikTok slideshows by chatting with AI.
        </p>

        <div
          className="animate-rise mt-10 w-full"
          style={{ animationDelay: "180ms" }}
        >
          <LandingComposer />
        </div>
      </div>
    </section>
  );
}
