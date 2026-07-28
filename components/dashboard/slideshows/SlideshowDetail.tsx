"use client";

import { useRouter } from "next/navigation";
import {
  deleteSlideshow,
  renameSlideshow,
} from "@/app/dashboard/slideshows/actions";
import { SlideEditor, type EditorSlide } from "./SlideEditor";
import { TikTokPostButton } from "./TikTokPostButton";
import { SaveToCameraRoll } from "./SaveToCameraRoll";
import type { SlideRole } from "@/lib/generate/layout";

interface DetailSlide {
  position: number;
  role: string | null;
  number: number | null;
  caption: string | null;
  body: string | null;
  url: string;
  bgUrl: string;
  posX: number;
  posY: number;
  align: "left" | "center" | "right";
  maxWidth: number | null;
  textBg?: boolean;
  fontScale?: number;
}

const ROLES: SlideRole[] = ["title", "reason", "plug", "cta"];

export function SlideshowDetail({
  id,
  title,
  slides,
  zipHref,
  isTikTokConnected,
}: {
  id: string;
  title: string;
  slides: DetailSlide[];
  zipHref: string;
  isTikTokConnected: boolean;
}) {
  const router = useRouter();
  const editorSlides: EditorSlide[] = slides.map((s) => ({
    position: s.position,
    role: ROLES.includes(s.role as SlideRole) ? (s.role as SlideRole) : "reason",
    number: s.number,
    caption: s.caption ?? "",
    body: s.body ?? "",
    textBg: s.textBg === true,
    url: s.url,
    bgUrl: s.bgUrl,
    pos: {
      x: s.posX,
      y: s.posY,
      align: s.align,
      maxWidth: s.maxWidth ?? undefined,
      fontScale: s.fontScale ?? 1,
    },
  }));

  return (
    <div className="mt-4">
      {/* Header: rename + actions */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <form action={renameSlideshow} className="flex items-center gap-2">
          <input type="hidden" name="id" value={id} />
          <input
            name="title"
            defaultValue={title}
            aria-label="Slideshow title"
            className="w-64 max-w-full rounded-lg border border-border bg-background px-3 py-2 text-lg font-bold tracking-tight focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/40"
          />
          <button
            type="submit"
            className="rounded-full border border-border bg-card px-3 py-2 text-sm font-semibold transition-colors hover:border-accent hover:text-accent-text"
          >
            Rename
          </button>
        </form>

        <div className="flex flex-wrap items-center gap-2">
          <TikTokPostButton
            slideshowId={id}
            slides={slides.map((s) => ({
              position: s.position,
              caption: s.caption,
              url: s.url,
            }))}
            isConnected={isTikTokConnected}
          />
          <SaveToCameraRoll urls={slides.map((s) => s.url)} title={title} />
          <a
            href={zipHref}
            className="rounded-full bg-accent px-4 py-2 text-sm font-semibold text-accent-foreground shadow-lg shadow-accent/25 transition-colors hover:bg-accent-strong"
          >
            Download all (.zip)
          </a>
          <form
            action={deleteSlideshow}
            onSubmit={(e) => {
              if (!confirm("Delete this slideshow? This can't be undone.")) {
                e.preventDefault();
              }
            }}
          >
            <input type="hidden" name="id" value={id} />
            <button
              type="submit"
              className="rounded-full border border-red-500/40 bg-red-500/10 px-4 py-2 text-sm font-semibold text-red-300 transition-colors hover:bg-red-500/20"
            >
              Delete
            </button>
          </form>
        </div>
      </div>

      {/* Drag editor */}
      {/* router.refresh() after every save: re-renders the server props (post
          modal captions) AND purges the client router cache, so "← Back to
          Slideshows" re-fetches the hub with fresh thumbnails instead of the
          back/forward-cached payload. */}
      <SlideEditor
        id={id}
        initialSlides={editorSlides}
        onReposition={() => router.refresh()}
      />
    </div>
  );
}
