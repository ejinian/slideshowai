import type { DemoSlide } from "@/lib/demo-data";

interface SlidePreviewProps {
  slide: DemoSlide;
  index: number;
  total: number;
  /** True when this card is the one the autoplay spotlight is on. */
  active?: boolean;
  /** True when some other card is active (so this one should dim back). */
  dimmed?: boolean;
  /** Changes each time the spotlight lands here — restarts the progress bar. */
  cycle?: number;
  /** Duration of one spotlight beat, in ms (drives the progress bar). */
  playMs?: number;
}

export function SlidePreview({
  slide,
  index,
  total,
  active = false,
  dimmed = false,
  cycle = 0,
  playMs = 1800,
}: SlidePreviewProps) {
  return (
    <div
      className={`relative aspect-9/16 overflow-hidden rounded-card shadow-xl ring-1 transition-all duration-500 ease-out ${
        active
          ? "z-10 -translate-y-1 scale-[1.04] ring-2 ring-accent shadow-2xl shadow-accent/40"
          : dimmed
            ? "scale-[0.97] opacity-50 ring-white/10"
            : "ring-white/10"
      }`}
    >
      {/* placeholder product photo */}
      <div
        aria-hidden
        className="absolute inset-0 bg-cover bg-center"
        style={{ backgroundImage: `url(${slide.image})` }}
      />

      {/* "now playing" progress bar — fills over one spotlight beat */}
      {active && (
        <div aria-hidden className="absolute inset-x-0 top-0 z-20 h-1 bg-white/15">
          <div
            key={cycle}
            className="animate-progress h-full bg-accent"
            style={{ animationDuration: `${playMs}ms` }}
          />
        </div>
      )}

      {/* slide counter chip */}
      <div className="absolute left-3 top-3 z-20 rounded-full bg-black/60 px-2.5 py-1 text-[11px] font-semibold text-white backdrop-blur-sm">
        {index + 1} / {total}
      </div>

      {/* legibility scrim */}
      <div
        aria-hidden
        className="absolute inset-0 bg-linear-to-t from-black/85 via-black/30 to-black/20"
      />

      {/* overlay caption — centered vertically to match the hero phone */}
      <p className="absolute inset-x-4 top-1/2 -translate-y-1/2 text-balance text-center text-lg font-extrabold leading-tight text-white drop-shadow-[0_2px_8px_rgba(0,0,0,0.85)] sm:text-base md:text-lg">
        {slide.caption}
      </p>
    </div>
  );
}
