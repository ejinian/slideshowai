import { Reveal } from "./Reveal";

const BENEFITS = [
  {
    emoji: "📐",
    title: "Post-ready 9:16",
    desc: "Perfectly sized vertical slides for TikTok Photo Mode — no cropping, no resizing.",
  },
  {
    emoji: "🪝",
    title: "Captions that convert",
    desc: "AI-written hooks designed to stop the scroll and drive action to your business.",
  },
  {
    emoji: "🎨",
    title: "On-brand in seconds",
    desc: "Pick a niche and get a cohesive set of slides that match how you sell.",
  },
  {
    emoji: "⚡",
    title: "No design skills needed",
    desc: "Skip the designer and the editing apps. Generate, download, and post.",
  },
];

export function Benefits() {
  return (
    <section id="benefits" className="bg-surface py-20 sm:py-24">
      <div className="mx-auto max-w-6xl px-5 sm:px-8">
        <Reveal className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
            Built for businesses that want to post more
          </h2>
          <p className="mt-4 text-lg text-muted">
            Everything you need to show up on TikTok consistently — without the
            busywork.
          </p>
        </Reveal>

        <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {BENEFITS.map((benefit, i) => (
            <Reveal key={benefit.title} className="h-full" delay={i * 90}>
              <div className="group h-full rounded-[var(--radius-card)] border border-border bg-card p-7 shadow-sm transition-all duration-300 hover:-translate-y-1.5 hover:border-accent/50 hover:shadow-xl hover:shadow-accent/10">
                <span className="grid h-12 w-12 place-items-center rounded-xl bg-accent-soft text-2xl transition-transform duration-300 group-hover:scale-110">
                  {benefit.emoji}
                </span>
                <h3 className="mt-5 text-lg font-bold">{benefit.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted">
                  {benefit.desc}
                </p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
