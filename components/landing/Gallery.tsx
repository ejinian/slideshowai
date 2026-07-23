import { DEMO_SLIDES, type NicheId } from "@/lib/demo-data";
import { AccentBar } from "./AccentBar";
import { Reveal } from "./Reveal";

// Real-output gallery: one strong slide per niche, exposed as a plain grid
// (no carousel — mobile gets the full stack, 2-up).
// TODO(proof): swap these for exports from real generation runs when we have a
// bank of them; these are the product-style example slides.

const PICKS: { niche: NicheId; index: number }[] = [
  { niche: "barber", index: 0 },
  { niche: "gym", index: 0 },
  { niche: "coffee", index: 2 },
  { niche: "food", index: 0 },
  { niche: "shop", index: 2 },
  { niche: "realty", index: 1 },
  { niche: "detailing", index: 2 },
  { niche: "diet", index: 0 },
];

export function Gallery() {
  return (
    <section className="relative overflow-hidden py-20 sm:py-28">
      {/* soft violet mid-page wash behind the gallery */}
      <div
        aria-hidden
        className="bg-landing-glow-mid pointer-events-none absolute inset-0 -z-10"
      />
      <Reveal className="mx-auto max-w-6xl px-5 sm:px-8">
        <h2 className="font-tiktok max-w-3xl text-balance text-3xl font-extrabold tracking-tight sm:text-4xl">
          Made from one sentence each
        </h2>
        <AccentBar />
        <p className="mt-4 max-w-2xl text-lg text-white/60">
          Example slideshows across ten niches — gyms, barbers, cafes,
          detailers, realtors, online shops.
        </p>

        <div className="mt-10 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
          {PICKS.map(({ niche, index }, i) => {
            const slide = DEMO_SLIDES[niche][index];
            return (
              <Reveal key={slide.image} delay={(i % 4) * 70}>
              <figure
                className="relative aspect-9/16 overflow-hidden rounded-xl ring-1 ring-white/10 transition-transform duration-300 hover:-translate-y-1.5 hover:ring-white/25"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={slide.image}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  className="absolute inset-0 h-full w-full object-cover"
                />
                <figcaption className="tiktok-caption absolute inset-x-3 top-[58%] -translate-y-1/2 text-center text-[13px] leading-tight sm:text-[15px]">
                  {slide.caption}
                </figcaption>
              </figure>
              </Reveal>
            );
          })}
        </div>
      </Reveal>
    </section>
  );
}
