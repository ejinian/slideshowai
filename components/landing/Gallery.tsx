import { DEMO_SLIDES, type NicheId } from "@/lib/demo-data";
import { AccentBar } from "./AccentBar";
import { Reveal } from "./Reveal";

// Lovable-style community showcase: filter pills up top, a grid of cards —
// thumbnail + title bar — every one a click into the generator.
// TODO(proof): swap these for exports from real generation runs when we have
// a bank of them; these are the product-style example slides.

const PICKS: { niche: NicheId; label: string; index: number }[] = [
  { niche: "barber", label: "Barbershop", index: 0 },
  { niche: "gym", label: "Gym", index: 0 },
  { niche: "coffee", label: "Cafe", index: 2 },
  { niche: "food", label: "Restaurant", index: 0 },
  { niche: "shop", label: "Online shop", index: 2 },
  { niche: "realty", label: "Real estate", index: 1 },
  { niche: "detailing", label: "Detailing", index: 2 },
  { niche: "diet", label: "Nutrition", index: 0 },
];

const FILTERS = ["Popular", "Gym", "Barber", "Cafe", "Food", "Shops", "Services"];

export function Gallery() {
  return (
    <section className="relative overflow-hidden py-20 sm:py-28">
      <div
        aria-hidden
        className="bg-landing-glow-mid pointer-events-none absolute inset-0 -z-10"
      />
      <Reveal className="mx-auto max-w-6xl px-5 sm:px-8">
        <h2 className="font-tiktok max-w-3xl text-balance text-3xl font-extrabold tracking-tight sm:text-4xl">
          Made with SlideLabsAI
        </h2>
        <AccentBar />

        {/* filter pills — decorative for now, Lovable-style */}
        <div className="no-scrollbar mt-8 flex items-center gap-2 overflow-x-auto">
          {FILTERS.map((f, i) => (
            <span
              key={f}
              className={`shrink-0 rounded-full px-4 py-1.5 text-sm font-medium ${
                i === 0
                  ? "bg-white text-black"
                  : "border border-white/10 text-white/60"
              }`}
            >
              {f}
            </span>
          ))}
        </div>

        <div className="mt-8 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
          {PICKS.map(({ niche, label, index }, i) => {
            const slide = DEMO_SLIDES[niche][index];
            return (
              <Reveal key={slide.image} delay={(i % 4) * 70}>
                <a
                  href="/dashboard"
                  className="group block overflow-hidden rounded-xl border border-white/8 bg-[#101014] transition-all duration-300 hover:-translate-y-1.5 hover:border-white/20"
                >
                  <figure className="relative aspect-9/16 overflow-hidden">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={slide.image}
                      alt=""
                      loading="lazy"
                      decoding="async"
                      className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
                    />
                    <figcaption className="tiktok-caption absolute inset-x-3 top-[58%] -translate-y-1/2 text-center text-[13px] leading-tight sm:text-[15px]">
                      {slide.caption}
                    </figcaption>
                  </figure>
                  <div className="flex items-center justify-between px-3 py-2.5">
                    <span className="text-sm font-medium text-white/80">
                      {label}
                    </span>
                    <span className="text-xs text-white/40 transition-colors group-hover:text-white">
                      Remix →
                    </span>
                  </div>
                </a>
              </Reveal>
            );
          })}
        </div>
      </Reveal>
    </section>
  );
}
