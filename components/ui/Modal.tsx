"use client";

import { useEffect } from "react";

// House-style dialog: dark panel on a blurred black overlay, closes on ESC,
// overlay click, or the X. Sized via the `width` class so detail sheets and
// small confirm dialogs share one primitive.
export function Modal({
  open,
  onClose,
  title,
  width = "max-w-lg",
  children,
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  width?: string;
  children: React.ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-100 flex items-end justify-center sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <button
        type="button"
        aria-hidden
        tabIndex={-1}
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-black/70 backdrop-blur-sm"
      />
      <div
        className={`animate-dropdown-in relative z-10 max-h-[92dvh] w-full overflow-y-auto rounded-t-2xl bg-[#141416] p-5 shadow-2xl shadow-black/60 ring-1 ring-white/[0.08] sm:m-4 sm:rounded-2xl sm:p-6 ${width}`}
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          {title ? (
            <h2 className="text-lg font-bold tracking-tight text-white">{title}</h2>
          ) : (
            <span />
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-white/40 transition-colors hover:bg-white/[0.06] hover:text-white"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
