import Link from "next/link";

export function Logo({ href = "/" }: { href?: string }) {
  return (
    <Link href={href} className="flex items-center gap-2.5">
      <span className="grid h-9 w-9 place-items-center rounded-xl bg-accent shadow-sm shadow-accent/30">
        {/* Stacked-slides glyph */}
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          aria-hidden
        >
          <rect x="3" y="6" width="14" height="14" rx="3" fill="#ffffff" opacity="0.55" />
          <rect x="7" y="4" width="14" height="14" rx="3" fill="#ffffff" />
        </svg>
      </span>
      <span className="text-lg font-bold tracking-tight">
        SlideShow<span className="text-accent-text">AI</span>
      </span>
    </Link>
  );
}
