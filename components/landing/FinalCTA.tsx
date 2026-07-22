import { Button } from "../ui/Button";
import { Reveal } from "./Reveal";

// The closer. A rotating conic-gradient rim, aurora + dot-grid depth, an
// animated gradient headline, and the product itself — mini slideshow cards
// with real TikTok-style captions — drifting inside the panel.

const CARDS = [
  {
    image: "/library/gym/gym-01.jpg",
    caption: "POV: you finally found a gym that feels like home",
    className: "left-[3%] top-[16%] w-32 -rotate-8 animate-float-a",
  },
  {
    image: "/demo/food-3.jpg",
    caption: "date night, solved",
    className: "left-[13%] bottom-[8%] w-27 rotate-5 animate-float-b",
  },
  {
    image: "/demo/coffee-3.jpg",
    caption: "the flat white that ruins every other cafe for you",
    className: "right-[12%] top-[12%] w-27 rotate-7 animate-float-b",
  },
  {
    image: "/demo/detail-4.jpg",
    caption: "we come to you → book in bio",
    className: "right-[3%] bottom-[10%] w-32 -rotate-6 animate-float-a",
  },
];

export function FinalCTA() {
  return (
    // Tight top padding: the FAQ section directly above provides the breathing
    // room, so the glow panel sits close instead of floating in a black void.
    <section className="pb-20 pt-4 sm:pb-28 sm:pt-6">
      <div className="mx-auto max-w-6xl px-5 sm:px-8">
        <Reveal>
          {/* rotating conic rim — 1px ring of moving light around the panel */}
          <div className="relative overflow-hidden rounded-3xl p-px">
            <div
              aria-hidden
              className="absolute -inset-[150%] animate-[spin_9s_linear_infinite] bg-[conic-gradient(from_0deg,transparent_0%,rgba(99,102,241,0.9)_12%,rgba(217,70,239,0.7)_22%,transparent_34%,transparent_58%,rgba(56,189,248,0.6)_70%,transparent_82%)]"
            />

            <div className="relative overflow-hidden rounded-[calc(1.5rem-1px)] bg-[#070709] px-6 py-20 text-center sm:px-12 sm:py-28">
              {/* depth stack: dot grid + aurora orbs */}
              <div aria-hidden className="bg-dot-grid absolute inset-0 opacity-60" />
              <div
                aria-hidden
                className="animate-float-a pointer-events-none absolute -top-28 left-[8%] h-96 w-96 rounded-full bg-accent/30 blur-[120px]"
              />
              <div
                aria-hidden
                className="animate-float-b pointer-events-none absolute -bottom-24 right-[6%] h-80 w-80 rounded-full bg-fuchsia-500/25 blur-[120px]"
              />
              <div
                aria-hidden
                className="animate-float-b pointer-events-none absolute -bottom-40 left-1/2 h-80 w-[36rem] -translate-x-1/2 rounded-full bg-sky-500/15 blur-[130px]"
                style={{ animationDelay: "-9s" }}
              />

              {/* the product, floating inside the CTA (desktop only) */}
              {CARDS.map((c) => (
                <figure
                  key={c.image}
                  aria-hidden
                  className={`pointer-events-none absolute hidden aspect-9/16 overflow-hidden rounded-xl opacity-90 shadow-2xl shadow-black/60 ring-1 ring-white/15 lg:block ${c.className}`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={c.image}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    className="absolute inset-0 h-full w-full object-cover"
                  />
                  <figcaption className="tiktok-caption absolute inset-x-1.5 top-[58%] -translate-y-1/2 text-center text-[9px] leading-tight">
                    {c.caption}
                  </figcaption>
                </figure>
              ))}

              {/* copy */}
              <p className="relative text-xs font-semibold uppercase tracking-[0.3em] text-accent-text">
                Free to start
              </p>
              <h2 className="relative mx-auto mt-4 max-w-3xl text-balance text-4xl font-extrabold leading-[1.05] tracking-tight text-white sm:text-6xl">
                Start generating{" "}
                <span className="text-gradient-animated">
                  slideshows that sell
                </span>
              </h2>
              <p className="relative mx-auto mt-5 max-w-lg text-pretty text-lg text-white/60">
                One sentence in. A post-ready TikTok slideshow out — hooks,
                photos, captions, done.
              </p>

              <div className="relative mt-10 flex justify-center">
                <span className="relative inline-flex">
                  {/* soft halo behind the button */}
                  <span
                    aria-hidden
                    className="absolute -inset-3 rounded-full bg-accent/40 blur-2xl"
                  />
                  <Button
                    href="/dashboard"
                    size="lg"
                    variant="onAccent"
                    className="btn-shine btn-shine-dark relative shadow-xl shadow-accent/30 transition-transform hover:scale-[1.06]"
                  >
                    Get Started
                    <span aria-hidden>→</span>
                  </Button>
                </span>
              </div>
              <p className="relative mt-6 text-sm text-white/40">
                No credit card. Your first slideshow is one sentence away.
              </p>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
