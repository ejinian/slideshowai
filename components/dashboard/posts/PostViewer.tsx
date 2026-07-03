"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

export interface ViewerSlide {
  position: number;
  url: string;
  caption: string;
}

const STATUS_META: Record<string, { label: string; cls: string }> = {
  PUBLISH_COMPLETE: { label: "Posted", cls: "bg-emerald-500/15 text-emerald-300" },
  PROCESSING_DOWNLOAD: { label: "Processing", cls: "bg-amber-500/15 text-amber-300" },
  FAILED: { label: "Failed", cls: "bg-red-500/15 text-red-300" },
};
const PRIVACY_LABEL: Record<string, string> = {
  SELF_ONLY: "Private (only you)",
  PUBLIC_TO_EVERYONE: "Public",
  MUTUAL_FOLLOW_FRIENDS: "Friends",
  FOLLOWER_OF_CREATOR: "Followers",
};

export function PostViewer({
  slides,
  caption,
  privacy,
  status,
  failReason,
  createdAt,
  coverIndex,
}: {
  slides: ViewerSlide[];
  caption: string;
  privacy: string;
  status: string;
  failReason: string | null;
  createdAt: string;
  coverIndex: number;
}) {
  const [idx, setIdx] = useState(
    Math.min(Math.max(0, coverIndex), Math.max(0, slides.length - 1)),
  );
  const count = slides.length;
  const go = useCallback(
    (d: number) => setIdx((i) => (i + d + count) % count),
    [count],
  );

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "ArrowLeft") go(-1);
      if (e.key === "ArrowRight") go(1);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go]);

  const meta = STATUS_META[status] ?? STATUS_META.PROCESSING_DOWNLOAD;
  const current = slides[idx];

  return (
    <div className="mx-auto max-w-4xl px-5 py-8 sm:px-8">
      <Link
        href="/dashboard/posts"
        className="inline-flex items-center gap-1.5 text-sm text-white/40 transition-colors hover:text-white"
      >
        <span aria-hidden>←</span> My Posts
      </Link>

      <div className="mt-6 grid gap-8 md:grid-cols-[320px_1fr]">
        {/* ── TikTok-style phone frame ─────────────────────────────── */}
        <div className="mx-auto w-full max-w-[320px]">
          <div className="relative aspect-9/16 w-full overflow-hidden rounded-3xl border border-white/10 bg-black shadow-2xl">
            {current?.url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={current.url}
                alt={`Slide ${idx + 1}`}
                className="absolute inset-0 h-full w-full object-cover"
              />
            ) : (
              <div className="absolute inset-0 grid place-items-center text-xs text-white/30">
                No image
              </div>
            )}

            {/* top: slide counter */}
            <div className="absolute left-0 right-0 top-3 flex justify-center">
              <span className="rounded-full bg-black/50 px-2.5 py-0.5 text-[11px] font-semibold text-white backdrop-blur-sm">
                {idx + 1} / {count}
              </span>
            </div>

            {/* tap zones */}
            {count > 1 && (
              <>
                <button
                  type="button"
                  aria-label="Previous"
                  onClick={() => go(-1)}
                  className="absolute inset-y-0 left-0 w-1/3 cursor-pointer"
                />
                <button
                  type="button"
                  aria-label="Next"
                  onClick={() => go(1)}
                  className="absolute inset-y-0 right-0 w-1/3 cursor-pointer"
                />
              </>
            )}

            {/* bottom: caption + progress dots (TikTok photo mode) */}
            <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-linear-to-t from-black/80 via-black/30 to-transparent p-3 pt-10">
              {caption && (
                <p className="mb-2 line-clamp-3 text-[13px] font-medium leading-snug text-white drop-shadow">
                  {caption}
                </p>
              )}
              {count > 1 && (
                <div className="flex justify-center gap-1.5">
                  {slides.map((s, i) => (
                    <span
                      key={s.position}
                      className={`h-1 rounded-full transition-all ${
                        i === idx ? "w-4 bg-white" : "w-1 bg-white/40"
                      }`}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* thumbnail strip */}
          {count > 1 && (
            <div className="no-scrollbar mt-3 flex gap-1.5 overflow-x-auto">
              {slides.map((s, i) => (
                <button
                  key={s.position}
                  type="button"
                  onClick={() => setIdx(i)}
                  className={`relative aspect-9/16 w-9 shrink-0 overflow-hidden rounded-md border-2 transition-all ${
                    i === idx ? "border-accent" : "border-transparent opacity-60 hover:opacity-100"
                  }`}
                >
                  {s.url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={s.url} alt="" className="h-full w-full object-cover" />
                  ) : null}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* ── Details ──────────────────────────────────────────────── */}
        <div>
          <div className="flex items-center gap-2">
            <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${meta.cls}`}>
              {meta.label}
            </span>
            <span className="text-xs text-white/40">
              {new Date(createdAt).toLocaleString()}
            </span>
          </div>

          <h1 className="mt-4 text-lg font-bold leading-snug text-white">
            {caption?.trim() || "Untitled post"}
          </h1>

          <dl className="mt-5 space-y-3 text-sm">
            <div className="flex justify-between border-b border-white/6 pb-3">
              <dt className="text-white/40">Visibility</dt>
              <dd className="font-medium text-white">{PRIVACY_LABEL[privacy] ?? privacy}</dd>
            </div>
            <div className="flex justify-between border-b border-white/6 pb-3">
              <dt className="text-white/40">Slides</dt>
              <dd className="font-medium text-white">{count}</dd>
            </div>
          </dl>

          {status === "FAILED" && failReason && (
            <p className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
              {failReason}
            </p>
          )}

          <div className="mt-6 flex flex-wrap gap-2">
            <a
              href="https://www.tiktok.com/"
              target="_blank"
              rel="noreferrer"
              className="rounded-full bg-white px-4 py-2 text-xs font-semibold text-black transition-opacity hover:opacity-90"
            >
              Open TikTok
            </a>
            <Link
              href="/dashboard"
              className="rounded-full border border-white/10 bg-white/4 px-4 py-2 text-xs font-medium text-white/60 transition-colors hover:border-white/20 hover:text-white"
            >
              Create another
            </Link>
          </div>

          {privacy === "SELF_ONLY" && (
            <p className="mt-4 text-xs text-white/30">
              This is a private post — visible only to you on your TikTok profile until the app is
              approved for public posting.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
