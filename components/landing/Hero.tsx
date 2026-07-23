import { Button } from "../ui/Button";
import { DEMO_SLIDES } from "@/lib/demo-data";
import { MiniPhone } from "./MiniPhone";
import { PhoneSlideshow } from "./PhoneSlideshow";

// Above the fold: benefit headline → what-it-is subhead → one CTA → FUD line,
// with real slideshows looping in phone frames as the proof (the demo IS the
// social proof — we're early-stage, so no invented counts or logos).
//
// TODO(proof): when we have public posts with real view counts, add one
// screenshot strip under the FUD line. Do not invent numbers.

export function Hero() {
  return (
    <section id="top" className="relative overflow-x-clip">
      {/* faint static wash — cyan left, red right (the TikTok pair) */}
      <div
        aria-hidden
        className="bg-landing-glow animate-glow-breathe pointer-events-none absolute inset-x-0 -top-16 -z-10 h-[40rem]"
      />

      <div className="mx-auto grid max-w-6xl grid-cols-1 items-center gap-12 px-5 pb-16 pt-14 sm:px-8 sm:pb-20 sm:pt-20 lg:grid-cols-[1.1fr_0.9fr] lg:gap-8">
        {/* copy column */}
        <div className="text-center lg:text-left">
          <h1 className="animate-rise font-tiktok text-balance text-4xl font-extrabold leading-[1.05] tracking-tight sm:text-5xl md:text-6xl">
            <span className="text-gradient-animated">Go viral</span> on TikTok
            without filming a single video
          </h1>

          <p
            className="animate-rise mx-auto mt-5 max-w-xl text-pretty text-lg leading-relaxed text-white/60 lg:mx-0"
            style={{ animationDelay: "90ms" }}
          >
            SlideShowAI turns your photos into TikTok Photo Mode slideshows —{" "}
            <strong className="font-semibold text-white">
              your actual product in every slide
            </strong>
            . No avatars, no filming, no editing.
          </p>

          <div
            className="animate-rise mt-8 flex justify-center lg:justify-start"
            style={{ animationDelay: "180ms" }}
          >
            <Button href="/dashboard" size="lg" variant="cta">
              Create my first slideshow
            </Button>
          </div>

          <p
            className="animate-rise mt-4 text-sm text-white/40"
            style={{ animationDelay: "240ms" }}
          >
            No filming · Free plan, no credit card · Cancel anytime
          </p>
        </div>

        {/* proof column — three real slideshows looping */}
        <div
          className="animate-rise flex items-center justify-center gap-4 lg:justify-end"
          style={{ animationDelay: "140ms" }}
        >
          <MiniPhone
            slides={DEMO_SLIDES.barber}
            startAt={1}
            className="animate-float-a hidden w-36 -rotate-6 opacity-90 sm:block"
            captionClass="text-[10px]"
          />
          <PhoneSlideshow />
          <MiniPhone
            slides={DEMO_SLIDES.coffee}
            startAt={2}
            className="animate-float-b hidden w-36 rotate-6 opacity-90 sm:block"
            captionClass="text-[10px]"
          />
        </div>
      </div>
    </section>
  );
}
