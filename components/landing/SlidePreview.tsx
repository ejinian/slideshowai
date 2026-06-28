import type { DemoSlide } from "@/lib/demo-data";

interface SlidePreviewProps {
  slide: DemoSlide;
  index: number;
  total: number;
}

export function SlidePreview({ slide, index, total }: SlidePreviewProps) {
  return (
    <div className="relative aspect-9/16 overflow-hidden rounded-card shadow-xl ring-1 ring-white/10">
      {/* placeholder product photo */}
      <div
        aria-hidden
        className="absolute inset-0 bg-cover bg-center"
        style={{ backgroundImage: `url(${slide.image})` }}
      />

      {/* slide counter chip */}
      <div className="absolute left-3 top-3 rounded-full bg-black/60 px-2.5 py-1 text-[11px] font-semibold text-white backdrop-blur-sm">
        {index + 1} / {total}
      </div>

      {/* legibility scrim */}
      <div
        aria-hidden
        className="absolute inset-x-0 bottom-0 h-3/5 bg-linear-to-t from-black/90 via-black/55 to-transparent"
      />

      {/* overlay caption */}
      <p className="absolute inset-x-0 bottom-0 text-balance p-4 text-lg font-extrabold leading-tight text-white drop-shadow-md sm:text-base md:text-lg">
        {slide.caption}
      </p>
    </div>
  );
}
