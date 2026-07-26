"use client";

import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

/* ── Navigation progress bar ────────────────────────────────────────────────
   A thin accent bar that pins to the very top of the viewport the moment an
   internal link is clicked and completes when the new route commits. Dashboard
   pages are force-dynamic (Supabase round-trips), so a click can sit for a
   second or two with zero feedback — this is that feedback.

   Written by hand rather than pulled in as a package: the popular ones
   (nextjs-toploader / nprogress) monkey-patch history.pushState, which is
   exactly the surface the App Router owns. This only listens for clicks and
   reads usePathname(), so there's nothing to break on a Next upgrade.

   Deliberately NOT wired to router.push() calls — those all live behind
   buttons that already show their own spinner.
   ───────────────────────────────────────────────────────────────────────── */

const TRICKLE_MS = 220; // how often the fake progress advances
const FADE_MS = 260; // hold at 100% before fading out
const BAIL_MS = 8_000; // a click that never navigates must not stick

export function TopLoader() {
  const pathname = usePathname();
  const [progress, setProgress] = useState(0);
  const [visible, setVisible] = useState(false);

  const trickle = useRef<ReturnType<typeof setInterval> | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const clearTimers = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  };

  const finish = useCallback(() => {
    if (!trickle.current) return; // never started — nothing to finish
    clearInterval(trickle.current);
    trickle.current = null;
    clearTimers();
    setProgress(100);
    timers.current.push(
      setTimeout(() => setVisible(false), FADE_MS),
      // Reset only once the bar has faded, so the width snap-back is unseen
      // (the width transition is disabled while invisible).
      setTimeout(() => setProgress(0), FADE_MS + 300),
    );
  }, []);

  const start = useCallback(() => {
    if (trickle.current) return; // a navigation is already in flight
    clearTimers();
    setVisible(true);
    setProgress(10);
    // Ease toward 90% and stall there; the real completion snaps it to 100.
    trickle.current = setInterval(() => {
      setProgress((p) => (p >= 90 ? p : p + Math.max(0.4, (90 - p) * 0.1)));
    }, TRICKLE_MS);
    timers.current.push(setTimeout(finish, BAIL_MS));
  }, [finish]);

  // The new route committed.
  useEffect(() => {
    finish();
  }, [pathname, finish]);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      // Let modified clicks (new tab/window) behave natively. Note we do NOT
      // bail on e.defaultPrevented: <Link> calls preventDefault() on every
      // navigation it handles, so that check would skip the exact clicks this
      // bar exists for. Links that cancel navigation to do something else
      // (open a modal) opt out with data-no-loader instead.
      if (e.button !== 0) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;

      const target = e.target;
      if (!(target instanceof Element)) return;
      const anchor = target.closest("a");
      if (!anchor || anchor.hasAttribute("download")) return;
      if (anchor.hasAttribute("data-no-loader")) return;
      if (anchor.target && anchor.target !== "_self") return;

      let url: URL;
      try {
        url = new URL(anchor.href, window.location.href);
      } catch {
        return;
      }
      // External links, mailto:/tel:, and API hrefs (the .zip download is a
      // plain <a> to /api/...) never change the pathname → never finish.
      if (url.origin !== window.location.origin) return;
      if (url.pathname.startsWith("/api/")) return;
      // Same-page hash / query-only links don't re-render the route.
      if (url.pathname === window.location.pathname) return;

      start();
    }

    document.addEventListener("click", onClick);
    return () => {
      document.removeEventListener("click", onClick);
      if (trickle.current) clearInterval(trickle.current);
      clearTimers();
    };
  }, [start]);

  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-x-0 top-0 z-[100] h-0.5"
    >
      <div
        className="h-full bg-accent shadow-[0_0_10px_rgba(99,102,241,0.7),0_0_5px_rgba(99,102,241,0.5)]"
        style={{
          width: `${progress}%`,
          opacity: visible ? 1 : 0,
          // Only animate width while the bar is on screen — that way the
          // reset to 0% after the fade is instant and invisible.
          transition: visible
            ? "width 200ms ease-out"
            : `opacity ${FADE_MS}ms ease-out`,
        }}
      />
    </div>
  );
}
