// PAS: name the felt problem, agitate it, present the way out.
const PAINS = [
  {
    lead: "Filming is a second job.",
    body: "Scripts, lighting, takes, edits — for a video that might get 200 views.",
  },
  {
    lead: "You don't want to be on camera.",
    body: "Most owners would rather close early than talk to a ring light.",
  },
  {
    lead: "Meanwhile, your competitors post daily.",
    body: "The algorithm doesn't wait for you to feel ready.",
  },
];

import { AccentBar } from "./AccentBar";
import { Reveal } from "./Reveal";

export function Problem() {
  return (
    <section className="py-20 sm:py-28">
      <Reveal className="mx-auto max-w-6xl px-5 sm:px-8">
        <h2 className="font-tiktok max-w-3xl text-balance text-3xl font-extrabold tracking-tight sm:text-4xl">
          You know you should be posting on TikTok. You're not.
        </h2>
        <AccentBar />

        <div className="mt-10 grid gap-10 md:grid-cols-3 md:gap-8">
          {PAINS.map((pain, i) => (
            <Reveal
              key={pain.lead}
              delay={i * 110}
              className="border-t border-white/10 pt-6"
            >
              <p className="text-lg leading-relaxed text-white/50">
                <strong className="font-semibold text-accent-text">
                  {pain.lead}
                </strong>{" "}
                {pain.body}
              </p>
            </Reveal>
          ))}
        </div>

        <p className="mt-12 max-w-2xl text-pretty text-lg leading-relaxed text-white/60">
          SlideShowAI removes the part you hate.{" "}
          <strong className="font-semibold text-white">
            Type one sentence about your business. Get a finished slideshow with
            your product in every slide. Post it.
          </strong>{" "}
          That's the whole workflow.
        </p>
      </Reveal>
    </section>
  );
}
