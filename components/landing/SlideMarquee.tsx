import { DEMO_SLIDES, type DemoSlide } from "@/lib/demo-data";

// A full-bleed, auto-scrolling wall of generated slides directly under the
// hero. Pure CSS animation (no JS), pauses on hover, and collapses to a single
// row on mobile. Two copies of each track make the -50% translate loop
// seamless.

const ALL_SLIDES = Object.values(DEMO_SLIDES).flat();
const ROW_A = ALL_SLIDES.filter((_, i) => i % 2 === 0);
const ROW_B = ALL_SLIDES.filter((_, i) => i % 2 === 1);

function Tile({ slide }: { slide: DemoSlide }) {
  return (
    <figure className="relative aspect-9/16 w-28 shrink-0 overflow-hidden rounded-xl ring-1 ring-white/10 sm:w-32">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={slide.image}
        alt=""
        loading="lazy"
        decoding="async"
        draggable={false}
        className="absolute inset-0 h-full w-full object-cover"
      />
      <div aria-hidden className="absolute inset-0 bg-black/30" />
      <figcaption className="absolute inset-x-2 top-1/2 line-clamp-3 -translate-y-1/2 text-center text-[10px] font-extrabold leading-tight text-white drop-shadow-[0_2px_6px_rgba(0,0,0,0.9)]">
        {slide.caption}
      </figcaption>
    </figure>
  );
}

function Row({
  slides,
  direction,
  className = "",
}: {
  slides: DemoSlide[];
  direction: "left" | "right";
  className?: string;
}) {
  return (
    <div
      className={`flex w-max gap-4 ${
        direction === "left" ? "animate-marquee-left" : "animate-marquee-right"
      } ${className}`}
    >
      {[0, 1].map((copy) => (
        <div key={copy} aria-hidden={copy === 1} className="flex gap-4">
          {slides.map((slide) => (
            <Tile key={`${copy}-${slide.image}`} slide={slide} />
          ))}
        </div>
      ))}
    </div>
  );
}

export function SlideMarquee() {
  return (
    <section aria-label="Example slides" className="relative py-14 sm:py-16">
      <p className="px-5 text-center text-xs font-semibold uppercase tracking-[0.28em] text-muted">
        Fresh from the generator
      </p>
      <div
        className="marquee-pause mt-8 space-y-4 overflow-hidden"
        style={{
          WebkitMaskImage:
            "linear-gradient(to right, transparent, #000 12%, #000 88%, transparent)",
          maskImage:
            "linear-gradient(to right, transparent, #000 12%, #000 88%, transparent)",
        }}
      >
        <Row slides={ROW_A} direction="left" />
        <Row slides={ROW_B} direction="right" className="hidden md:flex" />
      </div>
    </section>
  );
}
