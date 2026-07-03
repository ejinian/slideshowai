// Small uppercase kicker above section headings — gives each section a
// consistent rhythm and makes the page scannable at a glance.
export function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <span className="mb-4 inline-flex items-center gap-3 text-xs font-semibold uppercase tracking-[0.24em] text-accent-text">
      <span aria-hidden className="h-px w-6 bg-accent-text/50" />
      {children}
      <span aria-hidden className="h-px w-6 bg-accent-text/50" />
    </span>
  );
}
