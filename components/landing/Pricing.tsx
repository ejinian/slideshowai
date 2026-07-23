import { PLANS } from "@/lib/billing/plans";
import { Button } from "../ui/Button";
import { AccentBar } from "./AccentBar";
import { Reveal } from "./Reveal";

// Pricing pulled straight from lib/billing/plans.ts so the page can never
// drift from what Stripe actually charges. No trial / money-back exists in the
// billing config — don't claim one.

const CARDS = [
  {
    plan: PLANS.free,
    features: ["5 slideshows a month", "Every niche and layout", "Download as images"],
    cta: "Create my first slideshow",
  },
  {
    plan: PLANS.growth,
    features: ["150 slideshows a month", "Post & schedule to TikTok", "Credits roll in when you run out"],
    cta: "Start with Growth",
  },
  {
    plan: PLANS.scale,
    features: ["400 slideshows a month", "For agencies & multi-account", "Everything in Growth"],
    cta: "Start with Scale",
  },
  {
    plan: PLANS.unlimited,
    features: ["Unlimited within fair use", "Everything in Scale"],
    cta: "Go Unlimited",
  },
];

export function Pricing() {
  return (
    <section id="pricing" className="scroll-mt-20 py-20 sm:py-28">
      <Reveal className="mx-auto max-w-6xl px-5 sm:px-8">
        <h2 className="font-tiktok max-w-3xl text-balance text-3xl font-extrabold tracking-tight sm:text-4xl">
          Start free. Upgrade when it's working.
        </h2>
        <AccentBar />

        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {CARDS.map(({ plan, features, cta }, i) => (
            <Reveal key={plan.id} delay={i * 90} className="h-full">
            <div
              className={`flex h-full flex-col rounded-2xl p-6 transition-transform duration-300 hover:-translate-y-1 ${
                plan.popular
                  ? "bg-white/[0.06] ring-1 ring-accent/60 shadow-xl shadow-accent/10"
                  : "bg-white/[0.03] ring-1 ring-white/10"
              }`}
            >
              <div className="flex items-baseline justify-between">
                <h3 className="text-lg font-semibold text-white">{plan.name}</h3>
                {plan.popular && (
                  <span className="rounded-full bg-accent px-2.5 py-0.5 text-xs font-bold text-white">
                    Most popular
                  </span>
                )}
              </div>
              <p className="mt-3 text-4xl font-extrabold tracking-tight text-white">
                ${plan.price}
                <span className="text-base font-medium text-white/40">/mo</span>
              </p>
              <p className="mt-1 text-sm text-white/40">{plan.tagline}</p>
              <ul className="mt-5 flex-1 space-y-2.5 text-[15px] text-white/60">
                {features.map((f) => (
                  <li key={f} className="border-t border-white/[0.06] pt-2.5">
                    {f}
                  </li>
                ))}
              </ul>
              <div className="mt-6">
                <Button
                  href="/dashboard"
                  size="md"
                  variant={plan.popular ? "cta" : "secondary"}
                  className="w-full"
                >
                  {cta}
                </Button>
              </div>
            </div>
            </Reveal>
          ))}
        </div>

        <p className="mt-6 text-sm text-white/40">
          Out of quota mid-month? Credit packs from $9 — 1 credit = 1 slideshow,
          and credits never expire. Cancel or switch plans anytime.
        </p>
      </Reveal>
    </section>
  );
}
