import { DEMO_SLIDES } from "@/lib/demo-data";
import { AccentBar } from "./AccentBar";
import { MiniPhone } from "./MiniPhone";
import { Reveal } from "./Reveal";

// The strongest angle: slideshows vs. AI avatar ads. Type does the arguing;
// one looping real output sits beside it as the counter-example.

const POINTS = [
  {
    lead: "They don't look like ads.",
    body: "Viewers clock an AI avatar in half a second — and scroll. Photo slideshows look like the organic posts people already swipe through, because that's what they are.",
  },
  {
    lead: "Your product isn't plastered on every slide — on purpose.",
    body: "That's what an ad looks like, and ads get skipped. Your slideshow leads with content worth swiping through, and your product enters like part of the story — so viewers reach your CTA without ever feeling sold to.",
  },
  {
    lead: "Built for TikTok Photo Mode, posted through TikTok's official API.",
    body: "Native 9:16 slides with TikTok-style captions — indistinguishable from content made in the app.",
  },
];

export function WhySlideshows() {
  return (
    <section className="relative overflow-hidden py-20 sm:py-28">
      {/* this room's hue: fuchsia */}
      <div
        aria-hidden
        className="glow-blob animate-float-b -top-24 right-[12%] h-80 w-80 bg-fuchsia-500/10"
      />
      <Reveal className="mx-auto max-w-6xl px-5 sm:px-8">
        <h2 className="font-tiktok max-w-3xl text-balance text-3xl font-extrabold tracking-tight sm:text-4xl">
          Why slideshows beat AI avatar ads
        </h2>
        <AccentBar />

        <div className="mt-10 grid items-center gap-12 lg:grid-cols-[1.4fr_1fr]">
          <div>
            {POINTS.map((point, i) => (
              <Reveal
                key={point.lead}
                delay={i * 110}
                className="border-t border-white/10 py-7 first:border-t-0 first:pt-0"
              >
                <p className="text-lg leading-relaxed text-white/50">
                  <strong className="font-semibold text-accent-text">
                    {point.lead}
                  </strong>{" "}
                  {point.body}
                </p>
              </Reveal>
            ))}
          </div>

          <div className="flex justify-center">
            <div className="relative">
              {/* light pooled behind the phone — depth via lighting */}
              <div
                aria-hidden
                className="pointer-events-none absolute -inset-10 -z-10 rounded-full bg-accent/15 blur-[80px]"
              />
              <MiniPhone
                slides={DEMO_SLIDES.shop}
                className="w-52"
                captionClass="text-[13px]"
              />
            </div>
          </div>
        </div>
      </Reveal>
    </section>
  );
}
