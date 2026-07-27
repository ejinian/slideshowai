import Link from "next/link";

export function Logo({ href = "/" }: { href?: string }) {
  return (
    <Link href={href} className="flex items-center gap-2.5">
      {/* Fanned deck: three 9:16 cards — the shape of an actual slide, which
          the old square-ish glyph wasn't — splayed like a swipe. No container
          tile; the mark carries the accent→fuchsia gradient itself, the same
          ramp as AccentBar. */}
      <span className="grid h-9 w-9 place-items-center">
        <svg width="30" height="30" viewBox="0 0 24 24" fill="none" aria-hidden className="overflow-visible">
          <defs>
            <linearGradient id="slidelabs-mark" x1="4" y1="2" x2="20" y2="22" gradientUnits="userSpaceOnUse">
              <stop stopColor="#818cf8" />
              <stop offset="1" stopColor="#d946ef" />
            </linearGradient>
          </defs>
          {/* Rotation alone kept the cards concentric — they read as one pill
              at 30px. Each is translated out as well so the fan is legible. */}
          <rect x="8" y="3.5" width="10" height="17" rx="2.6" fill="url(#slidelabs-mark)" opacity="0.3" transform="translate(-7.5 1.5) rotate(-18 12 12)" />
          <rect x="8" y="3.5" width="10" height="17" rx="2.6" fill="url(#slidelabs-mark)" opacity="0.55" transform="translate(-3.8 0.4) rotate(-9 12 12)" />
          <rect x="8" y="3.5" width="10" height="17" rx="2.6" fill="url(#slidelabs-mark)" />
        </svg>
      </span>
      <span className="text-lg font-bold tracking-tight">
        SlideLabs<span className="text-accent-text">AI</span>
      </span>
    </Link>
  );
}
