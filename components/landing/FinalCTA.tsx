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
      <Reveal className="mx-auto max-w-4xl px-5 sm:px-8">
        <div className="card-depth relative overflow-hidden rounded-3xl px-6 py-16 text-center sm:px-12 sm:py-20">
          <div aria-hidden className="bg-noise pointer-events-none absolute inset-0 opacity-[0.05]" />
          <h2 className="font-tiktok relative text-balance text-4xl font-extrabold leading-[1.05] tracking-tight sm:text-5xl">
            Your first slideshow is{" "}
            <span className="text-gradient-animated">one sentence away</span>
          </h2>
          <div className="relative mt-9 flex justify-center">
            <Button href="/dashboard" size="lg" variant="cta">
              Create my first slideshow
            </Button>
          </div>
          <div className="relative mt-6 flex flex-wrap items-center justify-center gap-2">
            {["No filming", "Free plan — no credit card", "Cancel anytime"].map(
              (item) => (
                <span
                  key={item}
                  className="rounded-full border border-white/15 bg-white/[0.03] px-3 py-1 text-xs font-medium text-white/60"
                >
                  {item}
                </span>
              ),
            )}
          </div>
        </div>
      </Reveal>
    </section>
  );
}
