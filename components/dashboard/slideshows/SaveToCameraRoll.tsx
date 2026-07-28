"use client";

import { useState, useSyncExternalStore } from "react";

// "Add to camera roll", phones only.
//
// The web can't write to Photos directly — no API does that. What it CAN do is
// hand the rendered JPEGs to the OS share sheet via Web Share level 2, where
// "Save N Images" puts them straight in the camera roll (iOS 15+ Safari,
// Android Chrome). That's one tap more than a true save and it's the closest
// thing that exists.
//
// Not offered where it wouldn't work: desktop browsers mostly can't share
// files, and a plain download there lands in Downloads, not Photos — the .zip
// button already covers that case.

// Detected once: constructing a probe File on every render is wasteful, and the
// answer can't change within a page load.
let cachedSupport: boolean | null = null;
function supportsFileShare(): boolean {
  if (cachedSupport !== null) return cachedSupport;
  try {
    const probe = new File(["x"], "probe.jpg", { type: "image/jpeg" });
    cachedSupport = !!navigator.canShare?.({ files: [probe] });
  } catch {
    cachedSupport = false;
  }
  return cachedSupport;
}

export function SaveToCameraRoll({
  urls,
  title,
  className = "",
}: {
  /** Rendered slide URLs, in order. */
  urls: string[];
  title: string;
  className?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // `false` on the server so the markup matches until hydration decides.
  const supported = useSyncExternalStore(
    () => () => {},
    supportsFileShare,
    () => false,
  );

  if (!supported || urls.length === 0) return null;

  async function save() {
    setBusy(true);
    setErr(null);
    try {
      const files = await Promise.all(
        urls.map(async (url, i) => {
          const res = await fetch(url);
          if (!res.ok) throw new Error(`slide ${i + 1}`);
          const blob = await res.blob();
          return new File([blob], `slide-${String(i + 1).padStart(2, "0")}.jpg`, {
            type: blob.type || "image/jpeg",
          });
        }),
      );
      // Re-check with the real files: the probe only proves the browser shares
      // *some* files, not this many at this size.
      if (!navigator.canShare?.({ files })) {
        setErr("This browser can't save images directly — use Download .zip.");
        setBusy(false);
        return;
      }
      await navigator.share({ files, title });
    } catch (e) {
      // Dismissing the share sheet throws AbortError — not a failure.
      if (!(e instanceof DOMException && e.name === "AbortError")) {
        setErr("Couldn't prepare the images — try again.");
      }
    }
    setBusy(false);
  }

  return (
    <>
      <button
        type="button"
        onClick={() => void save()}
        disabled={busy}
        className={`flex items-center gap-1.5 rounded-full border border-white/10 bg-white/4 px-4 py-2 text-xs font-medium text-white/70 transition-colors hover:border-white/20 hover:text-white disabled:opacity-50 sm:hidden ${className}`}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />
        </svg>
        {busy ? "Preparing…" : "Add to camera roll"}
      </button>
      {err && <p className="w-full text-xs text-amber-300/80 sm:hidden">{err}</p>}
    </>
  );
}
