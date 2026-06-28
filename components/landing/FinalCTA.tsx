import { Button } from "../ui/Button";
import { Reveal } from "./Reveal";

export function FinalCTA() {
  return (
    <section className="py-20 sm:py-24">
      <div className="mx-auto max-w-6xl px-5 sm:px-8">
        <Reveal>
          <div className="relative overflow-hidden rounded-card px-6 py-16 text-center shadow-xl shadow-accent/25 sm:px-12">
            {/* animated gradient background */}
            <div
              aria-hidden
              className="animate-bg-pan absolute inset-0 -z-10 bg-[linear-gradient(120deg,#4f46e5,#7c3aed,#4f46e5)]"
            />
            <div
              aria-hidden
              className="animate-float-a pointer-events-none absolute -right-16 -top-16 h-64 w-64 rounded-full bg-white/15 blur-2xl"
            />
            <div
              aria-hidden
              className="animate-float-b pointer-events-none absolute -bottom-20 -left-10 h-64 w-64 rounded-full bg-white/10 blur-2xl"
            />
            <h2 className="relative text-balance text-3xl font-extrabold tracking-tight text-white sm:text-4xl">
              Start generating slideshows that sell
            </h2>
            <p className="relative mx-auto mt-4 max-w-lg text-pretty text-lg text-white/85">
              Turn your products into TikTok-ready slides in seconds — no design
              skills required.
            </p>
            <div className="relative mt-9 flex justify-center">
              <Button
                href="/dashboard"
                size="lg"
                variant="onAccent"
                className="shadow-lg shadow-black/20 transition-transform hover:scale-105"
              >
                Get Started
                <span aria-hidden>→</span>
              </Button>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
