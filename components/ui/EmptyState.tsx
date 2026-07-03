// Designed empty state used by every Grow list/grid: stacked-slides glyph,
// title, one-line explanation, optional CTA.
export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl bg-white/[0.02] px-6 py-16 text-center">
      <div className="relative" aria-hidden>
        <div className="absolute -left-3 top-2 h-20 w-14 -rotate-8 rounded-lg bg-white/[0.04] ring-1 ring-white/[0.06]" />
        <div className="absolute -right-3 top-2 h-20 w-14 rotate-8 rounded-lg bg-white/[0.04] ring-1 ring-white/[0.06]" />
        <div className="relative grid h-24 w-16 place-items-center rounded-lg bg-white/[0.06] ring-1 ring-white/[0.1]">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="text-white/30">
            <rect x="3" y="5" width="18" height="14" rx="2" />
            <circle cx="8.5" cy="10" r="1.5" />
            <path d="M21 16l-5-5-8 8" />
          </svg>
        </div>
      </div>
      <h3 className="mt-6 text-base font-bold text-white">{title}</h3>
      <p className="mt-1.5 max-w-xs text-sm text-white/40">{description}</p>
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}
