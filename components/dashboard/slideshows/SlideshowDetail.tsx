"use client";

import {
  deleteSlideshow,
  renameSlideshow,
} from "@/app/dashboard/slideshows/actions";
import { SlideEditor, type EditorSlide } from "./SlideEditor";
import type { SlideRole } from "@/lib/generate/layout";

interface DetailSlide {
  position: number;
  role: string | null;
  number: number | null;
  caption: string | null;
  url: string;
  bgUrl: string;
  posX: number;
  posY: number;
  align: "left" | "center" | "right";
  maxWidth: number | null;
}

const ROLES: SlideRole[] = ["title", "reason", "plug", "cta"];

export function SlideshowDetail({
  id,
  title,
  slides,
  zipHref,
}: {
  id: string;
  title: string;
  slides: DetailSlide[];
  zipHref: string;
}) {
  const editorSlides: EditorSlide[] = slides.map((s) => ({
    position: s.position,
    role: ROLES.includes(s.role as SlideRole) ? (s.role as SlideRole) : "reason",
    number: s.number,
    caption: s.caption ?? "",
    url: s.url,
    bgUrl: s.bgUrl,
    pos: {
      x: s.posX,
      y: s.posY,
      align: s.align,
      maxWidth: s.maxWidth ?? undefined,
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

        <div className="flex items-center gap-2">
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
      <SlideEditor id={id} initialSlides={editorSlides} />
    </div>
  );
}
