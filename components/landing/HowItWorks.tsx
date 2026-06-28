import { Reveal } from "./Reveal";

const STEPS = [
  {
    emoji: "🎯",
    title: "Pick your niche",
    desc: "Choose your industry and we pull on-brand product visuals from our library.",
  },
  {
    emoji: "✨",
    title: "AI writes your captions",
    desc: "Claude generates punchy, scroll-stopping captions tuned to your business.",
  },
  {
    emoji: "⬇️",
    title: "Download & post",
    desc: "Get ready-to-post 9:16 slides. Save them and share to TikTok in a tap.",
  },
];

export function HowItWorks() {
  return (
    <section id="how-it-works" className="py-20 sm:py-24">
      <div className="mx-auto max-w-6xl px-5 sm:px-8">
        <Reveal className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
            How it works
          </h2>
          <p className="mt-4 text-lg text-muted">
            From idea to post-ready slideshow in three steps.
          </p>
        </Reveal>

        <div className="mt-12 grid gap-6 md:grid-cols-3">
          {STEPS.map((step, i) => (
            <Reveal key={step.title} className="h-full" delay={i * 120}>
              <div className="group h-full rounded-card border border-border bg-card p-7 shadow-sm transition-all duration-300 hover:-translate-y-1.5 hover:border-accent/50 hover:shadow-xl hover:shadow-accent/10">
                <div className="flex items-center gap-3">
                  <span className="grid h-12 w-12 place-items-center rounded-xl bg-accent-soft text-2xl transition-transform duration-300 group-hover:scale-110">
                    {step.emoji}
                  </span>
                  <span className="text-sm font-semibold text-accent-text">
                    Step {i + 1}
                  </span>
                </div>
                <h3 className="mt-5 text-xl font-bold">{step.title}</h3>
                <p className="mt-2 leading-relaxed text-muted">{step.desc}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
