"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";

export interface TikTokSlide {
  position: number;
  caption: string | null;
  url: string;
}

const PRIVACY_OPTIONS = [
  { value: "PUBLIC_TO_EVERYONE", label: "Public" },
  { value: "SELF_ONLY", label: "Private (only you)" },
  { value: "MUTUAL_FOLLOW_FRIENDS", label: "Friends" },
  { value: "FOLLOWER_OF_CREATOR", label: "Followers" },
] as const;
type PrivacyLevel = (typeof PRIVACY_OPTIONS)[number]["value"];

type PostState = "idle" | "posting" | "polling" | "done" | "error";

export function TikTokPostButton({
  slideshowId,
  slides,
  isConnected,
  returnTo,
}: {
  slideshowId: string;
  slides: TikTokSlide[];
  isConnected: boolean;
  returnTo?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [connected, setConnected] = useState(isConnected);
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState("");
  const [caption, setCaption] = useState(
    slides.find((s) => s.caption)?.caption ?? "",
  );
  const [privacy, setPrivacy] = useState<PrivacyLevel>("PUBLIC_TO_EVERYONE");
  const [coverIndex, setCoverIndex] = useState(0);
  const [state, setState] = useState<PostState>("idle");
  const [error, setError] = useState("");
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const publishIdRef = useRef<string | null>(null);
  // Portal the modal to <body> so it escapes any ancestor `transform`/animation
  // containing block (which otherwise traps `position: fixed` inside the card).
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    return () => {
      if (pollRef.current) clearTimeout(pollRef.current);
    };
  }, []);

  // Popup-blocked fallback: the callback did a full-page redirect back to this
  // exact slideshow with a flag. Restore the user's spot — reopen the post modal
  // on success, or surface the connect error — then strip the query so a refresh
  // doesn't re-trigger it.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("tiktok_connected") === "1") {
      setConnected(true);
      openModal();
    } else if (params.get("tiktok_error")) {
      setConnectError(params.get("tiktok_error") || "Could not connect TikTok.");
    } else {
      return;
    }
    params.delete("tiktok_connected");
    params.delete("tiktok_error");
    const qs = params.toString();
    window.history.replaceState(null, "", window.location.pathname + (qs ? `?${qs}` : ""));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function openModal() {
    setState("idle");
    setError("");
    setOpen(true);
  }

  // Popup OAuth: the callback (popup=1) posts a message back and closes itself,
  // so this page — and any in-progress slideshow — never unmounts. On success we
  // flip to connected and drop straight into the post modal.
  function connectTikTok() {
    if (typeof window === "undefined") return;
    setConnectError("");
    const dest = returnTo ?? `/dashboard/slideshows/${slideshowId}`;
    const url = `/api/auth/tiktok?popup=1&return_to=${encodeURIComponent(dest)}`;

    const w = 600;
    const h = 720;
    const left = window.screenX + (window.outerWidth - w) / 2;
    const top = window.screenY + (window.outerHeight - h) / 2;
    const popup = window.open(
      url,
      "tiktok-oauth",
      `width=${w},height=${h},left=${left},top=${top}`,
    );

    // Popup blocked → fall back to a full-page redirect (loses page state, but
    // still connects). Non-popup callback redirects with ?tiktok_connected=1.
    if (!popup) {
      window.location.href = `/api/auth/tiktok?return_to=${encodeURIComponent(dest)}`;
      return;
    }

    setConnecting(true);

    function cleanup() {
      window.removeEventListener("message", onMessage);
      clearInterval(poll);
    }
    function onMessage(e: MessageEvent) {
      if (e.origin !== window.location.origin) return;
      const d = e.data as { source?: string; status?: string; message?: string };
      if (d?.source !== "tiktok-oauth") return;
      cleanup();
      setConnecting(false);
      if (d.status === "connected") {
        setConnected(true);
        openModal();
      } else {
        setConnectError(d.message || "Could not connect TikTok. Please try again.");
      }
    }
    // If the user closes the popup without finishing, stop the spinner.
    const poll = setInterval(() => {
      if (popup.closed) {
        cleanup();
        setConnecting(false);
      }
    }, 500);
    window.addEventListener("message", onMessage);
  }

  async function pollStatus() {
    if (!publishIdRef.current) return;
    try {
      const res = await fetch("/api/tiktok/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ publish_id: publishIdRef.current }),
      });
      const data = await res.json() as { status?: string; failReason?: string; error?: string };

      if (!res.ok) {
        setState("error");
        setError(data.error ?? "Status check failed.");
        return;
      }

      if (data.status === "PUBLISH_COMPLETE") {
        setState("done");
        return;
      }
      if (data.status === "FAILED") {
        setState("error");
        setError(data.failReason ?? "TikTok failed to process the post.");
        return;
      }
      // Still processing — poll again in 2 seconds
      pollRef.current = setTimeout(() => { void pollStatus(); }, 2000);
    } catch {
      setState("error");
      setError("Network error while checking post status.");
    }
  }

  async function handlePost() {
    setState("posting");
    setError("");
    try {
      const res = await fetch("/api/tiktok/post", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slideshowId,
          caption,
          privacyLevel: privacy,
          coverIndex,
        }),
      });
      const data = await res.json() as { publish_id?: string; error?: string };
      if (!res.ok || !data.publish_id) {
        setState("error");
        setError(data.error ?? "Failed to post.");
        return;
      }
      publishIdRef.current = data.publish_id;
      setState("polling");
      void pollStatus();
    } catch {
      setState("error");
      setError("Network error. Please try again.");
    }
  }

  function handleDone() {
    setOpen(false);
    setState("idle");
    router.refresh();
  }

  // --- Not connected ---
  if (!connected) {
    return (
      <div className="inline-flex flex-col items-start gap-1.5">
        <button
          type="button"
          onClick={connectTikTok}
          disabled={connecting}
          className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-4 py-2 text-sm font-semibold transition-colors hover:border-accent hover:text-accent-text disabled:opacity-60"
        >
          <TikTokIcon />
          {connecting ? "Connecting…" : "Connect TikTok"}
        </button>
        {connectError && (
          <span className="max-w-xs text-xs text-red-400">{connectError}</span>
        )}
      </div>
    );
  }

  // --- Connected ---
  return (
    <>
      <button
        type="button"
        onClick={openModal}
        className="inline-flex items-center gap-2 rounded-full bg-[#010101] px-4 py-2 text-sm font-semibold text-white shadow-lg transition-all hover:opacity-90 hover:shadow-xl"
      >
        <TikTokIcon className="text-white" />
        Post to TikTok
      </button>

      {open && mounted && createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => state !== "posting" && state !== "polling" && setOpen(false)}
          />

          {/* Modal */}
          <div className="relative z-10 w-full max-w-md rounded-2xl border border-border bg-surface p-6 shadow-2xl">
            {state === "done" ? (
              <div className="flex flex-col items-center gap-4 py-4 text-center">
                <span className="text-4xl">🎉</span>
                <p className="text-lg font-bold">Posted to TikTok!</p>
                <p className="text-sm text-muted">
                  It&apos;ll appear on your profile shortly. If the app isn&apos;t audited yet, it&apos;s visible only to you.
                </p>
                <button
                  type="button"
                  onClick={handleDone}
                  className="mt-2 rounded-full bg-accent px-6 py-2.5 text-sm font-semibold text-accent-foreground"
                >
                  Done
                </button>
              </div>
            ) : (
              <>
                <div className="mb-5 flex items-center justify-between">
                  <h2 className="text-lg font-bold">Post to TikTok</h2>
                  {state !== "posting" && state !== "polling" && (
                    <button
                      type="button"
                      onClick={() => setOpen(false)}
                      className="text-muted hover:text-foreground"
                      aria-label="Close"
                    >
                      ✕
                    </button>
                  )}
                </div>

                {/* Caption */}
                <div className="mb-4">
                  <label className="mb-1.5 block text-xs font-semibold text-muted">
                    Caption
                  </label>
                  <textarea
                    value={caption ?? ""}
                    onChange={(e) => setCaption(e.target.value)}
                    maxLength={4000}
                    rows={3}
                    placeholder="Add a caption…"
                    disabled={state === "posting" || state === "polling"}
                    className="w-full resize-none rounded-lg border border-border bg-card px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/40 disabled:opacity-60"
                  />
                  <p className="mt-1 text-right text-[11px] text-muted">
                    {(caption ?? "").length}/4000
                  </p>
                </div>

                {/* Privacy */}
                <div className="mb-4">
                  <label className="mb-1.5 block text-xs font-semibold text-muted">
                    Who can see this?
                  </label>
                  <select
                    value={privacy}
                    onChange={(e) => setPrivacy(e.target.value as PrivacyLevel)}
                    disabled={state === "posting" || state === "polling"}
                    className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/40 disabled:opacity-60"
                  >
                    {PRIVACY_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Cover slide picker */}
                {slides.length > 1 && (
                  <div className="mb-5">
                    <p className="mb-1.5 text-xs font-semibold text-muted">Cover slide</p>
                    <div className="no-scrollbar flex gap-2 overflow-x-auto pb-1">
                      {slides.map((s) => (
                        <button
                          key={s.position}
                          type="button"
                          onClick={() => setCoverIndex(s.position)}
                          disabled={state === "posting" || state === "polling"}
                          className={`relative shrink-0 overflow-hidden rounded-lg border-2 transition-all ${
                            coverIndex === s.position
                              ? "border-accent ring-2 ring-accent/40"
                              : "border-border hover:border-accent/50"
                          }`}
                          style={{ width: 52, height: 92 }}
                        >
                          {s.url && (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={s.url}
                              alt={`Slide ${s.position + 1}`}
                              className="h-full w-full object-cover"
                            />
                          )}
                          <span className="absolute bottom-0.5 left-0 right-0 text-center text-[9px] font-bold text-white drop-shadow">
                            {s.position + 1}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Error */}
                {state === "error" && error && (
                  <p className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
                    {error}
                  </p>
                )}

                {/* Status message while polling */}
                {state === "polling" && (
                  <p className="mb-4 text-center text-sm text-muted">
                    <span className="mr-2 inline-block animate-spin">⟳</span>
                    TikTok is processing your slides…
                  </p>
                )}

                {/* Actions */}
                <div className="flex justify-end gap-2">
                  {state === "error" && (
                    <button
                      type="button"
                      onClick={() => setState("idle")}
                      className="rounded-full border border-border bg-card px-4 py-2 text-sm font-semibold transition-colors hover:border-accent"
                    >
                      Try again
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => void handlePost()}
                    disabled={state === "posting" || state === "polling"}
                    className="inline-flex items-center gap-2 rounded-full bg-[#010101] px-5 py-2 text-sm font-semibold text-white shadow transition-all hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {state === "posting" ? (
                      "Posting…"
                    ) : state === "polling" ? (
                      "Processing…"
                    ) : (
                      <>
                        <TikTokIcon className="text-white" />
                        Post now
                      </>
                    )}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}

function TikTokIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      aria-hidden
    >
      <path d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-2.88 2.5 2.89 2.89 0 01-2.89-2.89 2.89 2.89 0 012.89-2.89c.28 0 .54.04.79.1V9.01a6.34 6.34 0 00-.79-.05 6.34 6.34 0 00-6.34 6.34 6.34 6.34 0 006.34 6.34 6.34 6.34 0 006.33-6.34V8.69a8.27 8.27 0 004.84 1.56V6.79a4.85 4.85 0 01-1.07-.1z" />
    </svg>
  );
}
