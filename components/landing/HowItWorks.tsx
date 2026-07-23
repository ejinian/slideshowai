import { DEMO_SLIDES } from "@/lib/demo-data";
import { AccentBar } from "./AccentBar";
import { HeroComposer } from "./HeroComposer";
import { Reveal } from "./Reveal";

// Three steps, each with a real product visual — no icon grid.

function StepSlides() {
  const tiles = DEMO_SLIDES.coffee.slice(0, 3);
  return (
    <div className="grid grid-cols-3 gap-2">
      {tiles.map((slide) => (
        <figure
          key={slide.image}
          className="relative aspect-9/16 overflow-hidden rounded-xl ring-1 ring-white/10"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={slide.image}
            alt=""
            loading="lazy"
            decoding="async"
            className="absolute inset-0 h-full w-full object-cover"
          />
          <figcaption className="tiktok-caption absolute inset-x-1.5 top-[58%] -translate-y-1/2 text-center text-[9px] leading-tight">
            {slide.caption}
          </figcaption>
        </figure>
      ))}
    </div>
  );
}

function StepActions() {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="rounded-full bg-accent px-4 py-2 text-sm font-semibold text-white">
        Post to TikTok
      </span>
      <span className="rounded-full bg-white/[0.07] px-4 py-2 text-sm font-semibold text-white/80">
        Schedule
      </span>
      <span className="rounded-full bg-white/[0.07] px-4 py-2 text-sm font-semibold text-white/80">
        Download
      </span>
    </div>
  );
}

const STEPS = [
  {
    title: "Describe the post",
    desc: "One line about your business — or drop in your own photos and let AI plan the whole thing.",
    visual: <HeroComposer />,
  },
  {
    title: "AI builds slides around your product",
    desc: "Hook, captions, and photos laid out in TikTok's native caption style. Everything stays editable.",
    visual: <StepSlides />,
  },
  {
    title: "Post while it's hot",
    desc: "Publish straight to TikTok, queue it on a schedule, or download the slides.",
    visual: <StepActions />,
  },
];

export function HowItWorks() {
  return (
    <section id="how-it-works" className="scroll-mt-20 py-20 sm:py-28">
      <Reveal className="mx-auto max-w-6xl px-5 sm:px-8">
        <h2 className="font-tiktok max-w-3xl text-balance text-3xl font-extrabold tracking-tight sm:text-4xl">
          From one sentence to a posted slideshow in three steps
        </h2>
        <AccentBar />

        <div className="mt-10 grid gap-12 md:grid-cols-3 md:gap-8">
          {STEPS.map((step, i) => (
            <Reveal
              key={step.title}
              delay={i * 110}
              className="flex flex-col border-t border-white/10 pt-6"
            >
              <h3 className="text-lg font-semibold text-white">
                <span className="text-accent-text">{i + 1}.</span> {step.title}
              </h3>
              <p className="mt-2 text-[15px] leading-relaxed text-white/50">
                {step.desc}
              </p>
              <div className="mt-6 [&_.animate-rise]:animate-none [&_a]:mt-0">
                {step.visual}
              </div>
            </Reveal>
          ))}
        </div>
      </Reveal>
    </section>
  );
}
