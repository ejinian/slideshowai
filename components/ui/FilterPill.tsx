"use client";

// Pill-style toggle filter shared by the Grow pages (Inspiration, Trends).
export function FilterPill({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`rounded-full px-4 py-2 text-sm font-semibold transition-all active:scale-95 ${
        active
          ? "bg-accent text-white shadow-md shadow-accent/30"
          : "bg-white/[0.06] text-white/60 hover:bg-white/[0.1] hover:text-white"
      }`}
    >
      {label}
    </button>
  );
}
