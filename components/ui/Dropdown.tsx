"use client";

import { useEffect, useRef, useState } from "react";

export interface DropdownOption<T extends string> {
  value: T;
  label: string;
}

// House rule: never native <select>. Absolute panel, click-outside via
// mousedown on document, panel styled per the design philosophy.
export function Dropdown<T extends string>({
  value,
  options,
  onChange,
  label,
  align = "right",
}: {
  value: T;
  options: DropdownOption<T>[];
  onChange: (value: T) => void;
  /** Optional prefix shown before the selected label, e.g. "Sort:" */
  label?: string;
  align?: "left" | "right";
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const current = options.find((o) => o.value === value);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 rounded-full bg-white/[0.06] px-4 py-2 text-sm font-medium text-white/80 transition-colors hover:bg-white/[0.1] hover:text-white"
      >
        {label && <span className="text-white/40">{label}</span>}
        {current?.label}
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
          className={`text-white/40 transition-transform ${open ? "rotate-180" : ""}`}
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {open && (
        <div
          className={`animate-dropdown-in absolute top-full z-50 mt-2 min-w-44 rounded-xl border border-white/[0.08] bg-[#1a1a1c] p-1 shadow-2xl ${
            align === "right" ? "right-0" : "left-0"
          }`}
        >
          {options.map((o) => (
            <button
              key={o.value}
              type="button"
              onClick={() => {
                onChange(o.value);
                setOpen(false);
              }}
              className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                o.value === value
                  ? "bg-white/[0.06] font-semibold text-white"
                  : "text-white/60 hover:bg-white/[0.04] hover:text-white"
              }`}
            >
              {o.label}
              {o.value === value && (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="text-accent-text">
                  <path d="M20 6L9 17l-5-5" />
                </svg>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
