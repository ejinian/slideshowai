import { Button } from "../ui/Button";

export function Hero() {
  return (
    <section id="top" className="relative overflow-hidden">
      {/* Animated background: dot grid + floating gradient orbs */}
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
        <div
          className="bg-dot-grid absolute inset-0 opacity-70"
          style={{
            WebkitMaskImage:
              "radial-gradient(ellipse 60% 50% at 50% 0%, #000 55%, transparent 100%)",
            maskImage:
              "radial-gradient(ellipse 60% 50% at 50% 0%, #000 55%, transparent 100%)",
          }}
        />
        <div className="animate-float-a absolute -top-32 left-[15%] h-105 w-105 rounded-full bg-accent/30 blur-[120px]" />
        <div className="animate-float-b absolute -top-24 right-[15%] h-90 w-90 rounded-full bg-fuchsia-500/20 blur-[120px]" />
        <div
          className="animate-float-a absolute top-44 left-1/2 h-75 w-75 -translate-x-1/2 rounded-full bg-sky-500/15 blur-[120px]"
          style={{ animationDelay: "-7s" }}
        />
      </div>

      <div className="mx-auto max-w-3xl px-5 pb-20 pt-24 text-center sm:px-8 sm:pb-28 sm:pt-32">
        <span
          className="animate-rise inline-flex items-center gap-2 rounded-full border border-border bg-card/70 px-4 py-1.5 text-xs font-medium text-muted shadow-sm backdrop-blur"
        >
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent-text opacity-75" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-accent-text" />
          </span>
          AI-powered · TikTok Photo Mode
        </span>

        <h1
          className="animate-rise mt-6 text-balance text-4xl font-extrabold leading-[1.08] tracking-tight sm:text-5xl md:text-6xl"
          style={{ animationDelay: "80ms" }}
        >
          Ready-to-post TikTok slideshows that{" "}
          <span className="text-gradient-animated">sell your products</span>
        </h1>

        <p
          className="animate-rise mx-auto mt-6 max-w-xl text-pretty text-lg leading-relaxed text-muted"
          style={{ animationDelay: "160ms" }}
        >
          SlideShowAI turns your business into scroll-stopping TikTok Photo Mode
          slideshows. Pick your niche, let AI write the captions, and download
          post-ready 9:16 slides in seconds.
        </p>

        <div
          className="animate-rise mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row"
          style={{ animationDelay: "240ms" }}
        >
          <Button
            href="/dashboard"
            size="lg"
            className="group shadow-lg shadow-accent/30 transition-shadow hover:shadow-xl hover:shadow-accent/50"
          >
            Get Started
            <span aria-hidden className="transition-transform duration-200 group-hover:translate-x-1">
              →
            </span>
          </Button>
          <a
            href="#demo"
            className="rounded-full border border-border bg-card/60 px-6 py-3.5 text-base font-semibold text-foreground backdrop-blur transition-colors hover:border-accent hover:text-accent-text"
          >
            See it in action
          </a>
        </div>

        <p
          className="animate-rise mt-6 text-sm text-muted"
          style={{ animationDelay: "320ms" }}
        >
          No design skills. No editing. Just generate and post.
        </p>
      </div>
    </section>
  );
}
