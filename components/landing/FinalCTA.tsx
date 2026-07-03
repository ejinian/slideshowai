import { Button } from "../ui/Button";
import { Reveal } from "./Reveal";

export function FinalCTA() {
  return (
    <section className="py-20 sm:py-28">
      <div className="mx-auto max-w-6xl px-5 sm:px-8">
        <Reveal>
          <div className="relative overflow-hidden rounded-3xl bg-[#08080b] px-6 py-16 text-center ring-1 ring-white/10 sm:px-12 sm:py-24">
            {/* glow orbs pooled inside the panel */}
            <div
              aria-hidden
              className="animate-float-a pointer-events-none absolute -top-28 left-[10%] h-80 w-80 rounded-full bg-accent/35 blur-[110px]"
            />
            <div
              aria-hidden
              className="animate-float-b pointer-events-none absolute -top-20 right-[8%] h-72 w-72 rounded-full bg-fuchsia-500/25 blur-[110px]"
            />
            <div
              aria-hidden
              className="animate-float-a pointer-events-none absolute -bottom-32 left-1/2 h-72 w-96 -translate-x-1/2 rounded-full bg-sky-500/15 blur-[110px]"
              style={{ animationDelay: "-8s" }}
            />
            {/* rim light along the top edge */}
            <div
              aria-hidden
              className="absolute inset-x-12 top-0 h-px bg-linear-to-r from-transparent via-white/40 to-transparent"
            />

            <h2 className="relative text-balance text-3xl font-extrabold tracking-tight text-white sm:text-5xl">
              Start generating slideshows that sell
            </h2>
            <p className="relative mx-auto mt-4 max-w-lg text-pretty text-lg text-white/70">
              Turn your products into TikTok-ready slides in seconds — no design
              skills required.
            </p>
            <div className="relative mt-9 flex justify-center">
              <Button
                href="/dashboard"
                size="lg"
                variant="onAccent"
                className="btn-shine btn-shine-dark shadow-lg shadow-black/40 transition-transform hover:scale-105"
              >
                Get Started
                <span aria-hidden>→</span>
              </Button>
            </div>
            <p className="relative mt-5 text-sm text-white/45">
              Your first slideshow is one sentence away.
            </p>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
