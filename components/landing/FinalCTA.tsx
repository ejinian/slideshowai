import { Button } from "../ui/Button";
import { Reveal } from "./Reveal";

// The closer: type on black, the one CTA, the same honest FUD line.
export function FinalCTA() {
  return (
    <section className="relative overflow-hidden py-24 sm:py-32">
      <div
        aria-hidden
        className="bg-landing-glow-b animate-glow-breathe pointer-events-none absolute inset-0 -z-10"
      />
      <Reveal className="mx-auto max-w-3xl px-5 text-center sm:px-8">
        <h2 className="font-tiktok text-balance text-4xl font-extrabold leading-[1.05] tracking-tight sm:text-5xl">
          Your first slideshow is{" "}
          <span className="text-gradient-animated">one sentence away</span>
        </h2>
        <div className="mt-9 flex justify-center">
          <Button href="/dashboard" size="lg" variant="cta">
            Create my first slideshow
          </Button>
        </div>
        <p className="mt-5 text-sm text-white/40">
          No filming · Free plan, no credit card · Cancel anytime
        </p>
      </Reveal>
    </section>
  );
}
