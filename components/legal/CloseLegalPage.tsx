"use client";

import { useRouter } from "next/navigation";

/**
 * Top-left close for the standalone legal pages (/privacy, /terms).
 *
 * These are reached two different ways and the control has to work for both:
 * from a footer link inside the app, where "close" means go back where you
 * were; and from a bare URL — TikTok's reviewers open the policy links
 * directly — where there is nothing to go back TO. `router.back()` on a fresh
 * tab either does nothing or throws the visitor off the site entirely, so it
 * falls through to the landing page instead.
 *
 * Top-LEFT rather than the usual right: it mirrors the close on the Post modal,
 * which follows TikTok's own convention.
 */
export function CloseLegalPage() {
  const router = useRouter();

  return (
    <button
      type="button"
      aria-label="Close"
      onClick={() => {
        // length > 1 means this tab has somewhere of its own to go back to.
        if (typeof window !== "undefined" && window.history.length > 1) {
          router.back();
        } else {
          router.push("/");
        }
      }}
      className="fixed left-4 top-4 z-50 rounded-full border border-white/10 bg-black/40 p-2.5 text-white/50 backdrop-blur transition-colors hover:border-white/25 hover:text-white sm:left-6 sm:top-6"
    >
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <path d="M18 6 6 18M6 6l12 12" />
      </svg>
    </button>
  );
}
