import { Logo } from "@/components/landing/Logo";

// The one screen a user sees between "signed in" and "on the dashboard".
//
// WHY: signing in used to paint the whole landing page first — hero, pricing,
// footer — and only then jump to the dashboard, because the redirect ran on the
// client after render. Two page changes for one action reads as a bug even when
// it takes under a second.
//
// Deliberately a server component with no state: it must be renderable in the
// very first HTML response, before any JS runs, or the landing page shows
// through in the hydration gap and the flash is back.
//
// Pure black to match the dashboard's own background, so arriving there is a
// continuation rather than a third distinct screen.
export function AuthTransition({ label = "Signing you in" }: { label?: string }) {
  return (
    <div
      // aria-live so screen readers announce the wait rather than a blank page.
      role="status"
      aria-live="polite"
      className="fixed inset-0 z-[100] grid min-h-dvh place-items-center bg-black"
    >
      <div className="flex flex-col items-center gap-5">
        {/* Not a link during the transition — clicking it would strand them. */}
        <div className="pointer-events-none">
          <Logo />
        </div>
        <div className="flex items-center gap-2.5 text-[13px] text-white/40">
          <svg className="animate-spin" width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
            <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.5" opacity="0.25" />
            <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
          </svg>
          {label}
        </div>
      </div>
    </div>
  );
}
