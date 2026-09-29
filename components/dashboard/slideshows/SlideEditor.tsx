"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  DEFAULT_POS,
  FONT_SCALE_MAX,
  FONT_SCALE_MIN,
  layoutSlide,
  PLATE_PAD_X_FRAC,
  PLATE_RADIUS_FRAC,
  CAPTION_STROKE_FRAC,
  SLIDE_H,
  SLIDE_W,
  type Align,
  type SlideLayout,
  type SlidePos,
  usesPillHeading,
  type SlideRole,
} from "@/lib/generate/layout";
import { reconcileDeckText } from "@/lib/slides/deckText";

export interface EditorSlide {
  position: number;
  role: SlideRole;
  number: number | null;
  caption: string;
  url: string; // composited PNG (authoritative export, for download)
  bgUrl: string; // text-free background ("" if unavailable)
  pos: SlidePos;
  /** Measured at generation: this background is too bright for white text. */
  textBg?: boolean;
  /** Optional paragraph under the heading (short decks only). */
  body?: string;
}

/**
 * A slide as the editor holds it. `position` changes every time a slide is
 * moved or deleted, so it cannot identify a slide across an edit — `uid` can.
 * It keys the React list, the unsaved-changes queue and the per-slide memory
 * (rejected photos, last saved caption), none of which should follow a slot.
 */
type Slide = EditorSlide & { uid: number };

// How long "Slide deleted · Undo" stays up.
const UNDO_MS = 7000;

// A replacement photo is downscaled in the browser before it goes on the wire —
// a full-res phone photo blows past the request body limit. 1920 on the long
// edge rather than the composer's 1280: this photo fills a whole 1080x1920
// slide on its own, where an upload there is one of ten the model only needs to
// recognise.
const SLIDE_PHOTO_MAX_EDGE = 1920;
const SLIDE_PHOTO_QUALITY = 0.86;

function downscaleForSlide(file: File): Promise<string | null> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onerror = () => resolve(null);
    reader.onload = () => {
      const dataUrl = (reader.result as string) || null;
      if (!dataUrl) return resolve(null);
      const img = new Image();
      // Any decode failure (HEIC, corrupt file) falls back to the original and
      // lets the server decide whether it can read it.
      img.onerror = () => resolve(dataUrl);
      img.onload = () => {
        let { width, height } = img;
        if (!width || !height) return resolve(dataUrl);
        const longest = Math.max(width, height);
        if (longest > SLIDE_PHOTO_MAX_EDGE) {
          const scale = SLIDE_PHOTO_MAX_EDGE / longest;
          width = Math.round(width * scale);
          height = Math.round(height * scale);
        }
        try {
          const canvas = document.createElement("canvas");
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext("2d");
          if (!ctx) return resolve(dataUrl);
          ctx.drawImage(img, 0, 0, width, height);
          resolve(canvas.toDataURL("image/jpeg", SLIDE_PHOTO_QUALITY));
        } catch {
          resolve(dataUrl);
        }
      };
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
  });
}

const SNAP_TARGETS = [1 / 3, 1 / 2, 2 / 3];
const SNAP_TOLERANCE = 0.018;

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

function snap(value: number): { value: number; guide: number | null } {
  for (const t of SNAP_TARGETS) {
    if (Math.abs(value - t) < SNAP_TOLERANCE) return { value: t, guide: t };
  }
  return { value, guide: null };
}

/* --------------------------------------------------------------------------
   Presentational caption layer — the HTML mirror of the SVG compositor.
   Everything is derived from layoutSlide() (1080x1920 space) and scaled by the
   rendered container width, so it is WYSIWYG against the exported PNG.
   -------------------------------------------------------------------------- */
function CaptionLayer({
  layout,
  scale,
  textBg = false,
  pill = false,
}: {
  layout: SlideLayout;
  scale: number;
  textBg?: boolean;
  /** White pill + black heading — mirrors buildSvg()'s `pill` branch. */
  pill?: boolean;
}) {
  const shadow = `0 ${3 * scale}px ${6 * scale}px rgba(0,0,0,0.45)`;
  // Black outline behind the white fill — mirrors the SVG bake's paint-order:stroke.
  const strokeW = Math.max(2, layout.fontSize * CAPTION_STROKE_FRAC) * scale;
  const anchor = layout.textAnchor;
  const translateX = anchor === "middle" ? "-50%" : anchor === "end" ? "-100%" : "0";
  const textAlign = anchor === "middle" ? "center" : anchor === "end" ? "right" : "left";

  return (
    <>
      {/* Black plate for low-contrast backgrounds — mirrors plateSvg() in the
          compositor: one rect per line, tiled at lineHeight, same padding and
          radius constants. Painted under the text; the type is unchanged. */}
      {(pill || textBg) &&
        // Heading lines only for the pill — see plateSvg() in composite.ts.
        (pill ? layout.lineBoxes.slice(0, layout.lines.length) : layout.lineBoxes).map((b, i) => (
          <div
            key={`plate-${i}`}
            style={{
              position: "absolute",
              left: (b.left - layout.fontSize * PLATE_PAD_X_FRAC) * scale,
              top: b.top * scale,
              width: (b.width + layout.fontSize * PLATE_PAD_X_FRAC * 2) * scale,
              height: b.height * scale,
              borderRadius: layout.fontSize * PLATE_RADIUS_FRAC * scale,
              background: pill ? "#fff" : "rgba(0,0,0,0.82)",
              pointerEvents: "none",
            }}
          />
        ))}
      {/* caption text — anchored exactly like SVG text-anchor */}
      <div
        style={{
          position: "absolute",
          left: layout.anchorX * scale,
          // Nudge up by half the leading so the HTML first-line baseline lines up
          // with the SVG baseline (textBox.top + 0.8*fontSize). Later lines share
          // lineHeight, so correcting the first aligns them all.
          top: (layout.textBox.top - (layout.lineHeight - layout.fontSize) / 2) * scale,
          transform: `translateX(${translateX})`,
          display: "inline-block",
          textAlign,
          fontFamily: "var(--font-caption), sans-serif",
          fontWeight: layout.fontWeight,
          fontSize: layout.fontSize * scale,
          lineHeight: `${layout.lineHeight * scale}px`,
          letterSpacing: layout.letterSpacing * scale,
          // On the pill the heading is black with no outline or shadow — see
          // textSvg() in composite.ts for why.
          color: pill ? "#000" : "#fff",
          WebkitTextStroke: pill ? undefined : `${strokeW}px #000`,
          paintOrder: pill ? undefined : "stroke",
          textShadow: pill ? undefined : shadow,
          whiteSpace: "nowrap",
          pointerEvents: "none",
        }}
      >
        {layout.lines.map((ln, i) => (
          <div key={i} style={{ whiteSpace: "nowrap" }}>
            {ln}
          </div>
        ))}
      </div>

      {/* body paragraph — mirrors bodySvg() in the compositor */}
      {layout.bodyLines.length > 0 && (
        <div
          style={{
            position: "absolute",
            left: layout.bodyAnchorX * scale,
            top:
              (layout.bodyBox.top -
                (layout.bodyLineHeight - layout.bodyFontSize) / 2) *
              scale,
            transform: `translateX(${translateX})`,
            display: "inline-block",
            textAlign,
            fontFamily: "var(--font-caption), sans-serif",
            fontWeight: layout.bodyFontWeight,
            fontSize: layout.bodyFontSize * scale,
            lineHeight: `${layout.bodyLineHeight * scale}px`,
            letterSpacing: layout.bodyLetterSpacing * scale,
            color: "#fff",
            WebkitTextStroke: `${Math.max(2, layout.bodyFontSize * CAPTION_STROKE_FRAC) * scale}px #000`,
            paintOrder: "stroke",
            textShadow: shadow,
            whiteSpace: "nowrap",
            pointerEvents: "none",
          }}
        >
          {layout.bodyLines.map((ln, i) => (
            <div key={i} style={{ whiteSpace: "nowrap" }}>
              {/* A body keeps its blank lines — the two-part "before / now i…"
                  caption is two paragraphs with a gap. An empty <div> collapses
                  to zero height in HTML, and an empty <tspan> has no glyph so
                  its `dy` is dropped (see tspans() in composite.ts). Both are
                  given a non-breaking space so the gap is real and identical in
                  each. */}
              {ln === "" ? " " : ln}
            </div>
          ))}
        </div>
      )}
    </>
  );
}

/* --------------------------- small static preview -------------------------- */
// Shared by the three controls that sit on a thumbnail. Hidden until the thumb
// is hovered, focused or selected — a phone has no hover, so there the selected
// slide is the one that shows them.
const THUMB_CONTROL =
  "absolute grid h-6 w-6 place-items-center rounded-full bg-black/75 text-white backdrop-blur-sm transition-opacity hover:bg-black focus-visible:opacity-100";

function StaticSlide({
  slide,
  index,
  count,
  width,
  selected,
  onSelect,
  textBg,
  dragging,
  dropTarget,
  onDragStart,
  onDragEnter,
  onDragEnd,
  onDrop,
  onMove,
  onDelete,
}: {
  slide: EditorSlide;
  index: number;
  count: number;
  width: number;
  selected: boolean;
  onSelect: () => void;
  textBg: boolean;
  dragging?: boolean;
  dropTarget?: boolean;
  onDragStart?: () => void;
  onDragEnter?: () => void;
  onDragEnd?: () => void;
  onDrop?: () => void;
  /** Move this slide one place earlier (-1) or later (1). */
  onMove?: (dir: -1 | 1) => void;
  onDelete?: () => void;
}) {
  const scale = width / SLIDE_W;
  const layout = useMemo(
    () =>
      layoutSlide({
        text: slide.caption,
        role: slide.role,
        number: slide.number,
        pos: slide.pos,
        body: slide.body ?? null,
      }),
    [slide.caption, slide.role, slide.number, slide.pos, slide.body],
  );
  const bg = slide.bgUrl || slide.url;
  // A deck of one has nothing to reorder and cannot lose its only slide.
  const arrangeable = count > 1;
  const reveal = selected
    ? "opacity-100"
    : "opacity-0 group-hover/thumb:opacity-100 group-focus-within/thumb:opacity-100";
  return (
    <div
      className={`group/thumb relative shrink-0 transition-opacity ${dragging ? "opacity-30" : ""}`}
      draggable={arrangeable && Boolean(onDragStart)}
      onDragStart={(e) => {
        // Firefox refuses to start a drag without data on the transfer.
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", String(slide.position));
        onDragStart?.();
      }}
      onDragEnter={onDragEnter}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        onDrop?.();
      }}
      onDragEnd={onDragEnd}
      onKeyDown={(e) => {
        if (!arrangeable) return;
        if (e.altKey && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
          e.preventDefault();
          onMove?.(e.key === "ArrowLeft" ? -1 : 1);
        } else if (e.key === "Delete" || e.key === "Backspace") {
          e.preventDefault();
          onDelete?.();
        }
      }}
    >
      {/* A div, not a <button>: Firefox will not start a drag from a button
          (or from anything inside one), so a real button here makes the strip
          undraggable there. */}
      <div
        role="button"
        tabIndex={0}
        onClick={onSelect}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onSelect();
          }
        }}
        aria-pressed={selected}
        aria-label={`Slide ${index + 1}`}
        title={arrangeable ? "Drag to reorder" : undefined}
        className={`relative block overflow-hidden rounded-xl border outline-none transition-all focus-visible:ring-2 focus-visible:ring-accent ${
          arrangeable ? "cursor-grab active:cursor-grabbing" : "cursor-pointer"
        } ${
          dropTarget
            ? "border-accent ring-2 ring-accent"
            : selected
              ? "border-accent ring-2 ring-accent/60"
              : "border-white/8 opacity-60 group-hover/thumb:border-white/25 group-hover/thumb:opacity-100"
        }`}
        style={{ width, height: width * (SLIDE_H / SLIDE_W) }}
      >
        {bg ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={bg}
            alt=""
            draggable={false}
            className="absolute inset-0 h-full w-full object-cover"
          />
        ) : null}
        <CaptionLayer
          layout={layout}
          scale={scale}
          textBg={textBg}
          pill={usesPillHeading(slide.role, slide.number, slide.body, slide.caption)}
        />
      </div>

      {/* The order is the thing being edited, so it is always readable. */}
      <span className="pointer-events-none absolute left-1.5 top-1.5 grid h-5 min-w-5 place-items-center rounded-full bg-black/75 px-1 text-[10px] font-bold tabular-nums text-white">
        {index + 1}
      </span>

      {arrangeable && (
        <>
          <button
            type="button"
            onClick={onDelete}
            aria-label={`Delete slide ${index + 1}`}
            title="Delete slide"
            className={`${THUMB_CONTROL} right-1.5 top-1.5 hover:bg-red-500 ${reveal}`}
          >
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" aria-hidden>
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
          {index > 0 && (
            <button
              type="button"
              onClick={() => onMove?.(-1)}
              aria-label={`Move slide ${index + 1} earlier`}
              title="Move earlier"
              className={`${THUMB_CONTROL} bottom-1.5 left-1.5 ${reveal}`}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M15 18l-6-6 6-6" />
              </svg>
            </button>
          )}
          {index < count - 1 && (
            <button
              type="button"
              onClick={() => onMove?.(1)}
              aria-label={`Move slide ${index + 1} later`}
              title="Move later"
              className={`${THUMB_CONTROL} bottom-1.5 right-1.5 ${reveal}`}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M9 18l6-6-6-6" />
              </svg>
            </button>
          )}
        </>
      )}
    </div>
  );
}

/* ----------------------------- editable stage ------------------------------ */
function EditableStage({
  slide,
  draggable,
  onDrag,
  onCommit,
  onScale,
  onSwipe,
  textBg,
}: {
  slide: EditorSlide;
  draggable: boolean;
  onDrag: (x: number, y: number) => void;
  onCommit: () => void;
  /** Two-finger pinch → caption size. Drives the SAME `fontScale` the slider
   *  does, so there is no new stored state and the bake is unchanged. */
  onScale?: (fontScale: number) => void;
  /** One-finger horizontal swipe on the slide → previous/next slide. */
  onSwipe?: (dir: -1 | 1) => void;
  textBg: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [guides, setGuides] = useState<{ x: number | null; y: number | null }>({ x: null, y: null });
  const drag = useRef<{ sx: number; sy: number; bx: number; by: number } | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    setW(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const scale = w / SLIDE_W;
  const heightPx = w * (SLIDE_H / SLIDE_W);
  const layout = useMemo(
    () =>
      layoutSlide({
        text: slide.caption,
        role: slide.role,
        number: slide.number,
        pos: slide.pos,
        body: slide.body ?? null,
      }),
    [slide.caption, slide.role, slide.number, slide.pos, slide.body],
  );

  // ── Touch gestures ─────────────────────────────────────────────────────
  // Two fingers anywhere on the slide pinch the caption's size and move it,
  // the way Instagram and TikTok behave. One finger on the caption still
  // drags it (the handle below); one finger elsewhere swipes between slides.
  //
  // Desktop is untouched by design: pinch needs two pointers, which a mouse
  // cannot produce, and the swipe listens to touch events only.
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{
    dist: number;
    scale: number;
    mx: number;
    my: number;
    bx: number;
    by: number;
  } | null>(null);
  const swipe = useRef<{ x: number; y: number; decided: boolean } | null>(null);

  const midpoint = () => {
    const pts = [...pointers.current.values()];
    return {
      x: (pts[0].x + pts[1].x) / 2,
      y: (pts[0].y + pts[1].y) / 2,
      d: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y),
    };
  };

  const onStagePointerDown = (e: React.PointerEvent) => {
    if (e.pointerType === "mouse") return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2 && draggable && w) {
      // A pinch supersedes any single-finger caption drag already in flight,
      // otherwise the first finger keeps dragging while the second scales and
      // the caption shoots off under your hand.
      drag.current = null;
      const m = midpoint();
      pinch.current = {
        dist: m.d,
        scale: slide.pos.fontScale ?? 1,
        mx: m.x,
        my: m.y,
        bx: slide.pos.x,
        by: slide.pos.y,
      };
      swipe.current = null;
      setDragging(true);
    }
  };

  const onStagePointerMove = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (!pinch.current || pointers.current.size < 2 || !w) return;
    const m = midpoint();
    // Size from the spread between the fingers…
    const next = Math.min(
      FONT_SCALE_MAX,
      Math.max(FONT_SCALE_MIN, pinch.current.scale * (m.d / (pinch.current.dist || 1))),
    );
    onScale?.(next);
    // …and position from where their midpoint travelled, through the SAME
    // snap() the one-finger drag uses, so centre/thirds still magnetise.
    const sx = snap(clamp01(pinch.current.bx + (m.x - pinch.current.mx) / w));
    const sy = snap(clamp01(pinch.current.by + (m.y - pinch.current.my) / heightPx));
    setGuides({ x: sx.guide, y: sy.guide });
    onDrag(sx.value, sy.value);
  };

  const onStagePointerUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pinch.current && pointers.current.size < 2) {
      pinch.current = null;
      setDragging(false);
      setGuides({ x: null, y: null });
      onCommit();
    }
  };

  // Horizontal swipe → change slide. `touch-action: pan-y` on the stage lets
  // the browser keep vertical page scrolling while handing us the horizontal
  // axis, so this never fights the page and needs no preventDefault.
  const SWIPE_PX = 45;
  const onStageTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length !== 1 || drag.current || pinch.current) {
      swipe.current = null;
      return;
    }
    swipe.current = { x: e.touches[0].clientX, y: e.touches[0].clientY, decided: false };
  };
  const onStageTouchMove = (e: React.TouchEvent) => {
    const st = swipe.current;
    if (!st || st.decided || e.touches.length !== 1 || drag.current || pinch.current) return;
    const dx = e.touches[0].clientX - st.x;
    const dy = e.touches[0].clientY - st.y;
    // Require the gesture to be decisively horizontal, so a slightly-diagonal
    // scroll down the page never yanks the user onto another slide.
    if (Math.abs(dx) > SWIPE_PX && Math.abs(dx) > Math.abs(dy) * 1.5) {
      st.decided = true;
      onSwipe?.(dx < 0 ? 1 : -1);
    }
  };
  const onStageTouchEnd = () => {
    swipe.current = null;
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (!draggable || !w) return;
    // Second finger down mid-drag: the stage handler takes over as a pinch.
    if (pointers.current.size >= 2) return;
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { sx: e.clientX, sy: e.clientY, bx: slide.pos.x, by: slide.pos.y };
    setDragging(true);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current || !w || pinch.current) return;
    const dx = (e.clientX - drag.current.sx) / w;
    const dy = (e.clientY - drag.current.sy) / heightPx;
    const sx = snap(clamp01(drag.current.bx + dx));
    const sy = snap(clamp01(drag.current.by + dy));
    setGuides({ x: sx.guide, y: sy.guide });
    onDrag(sx.value, sy.value);
  };
  const endDrag = () => {
    if (!drag.current) return;
    drag.current = null;
    setDragging(false);
    setGuides({ x: null, y: null });
    onCommit();
  };

  // Drag hit area = the block bbox (with a little padding for easy grabbing).
  const pad = 10 * scale;
  const hit = {
    left: layout.block.left * scale - pad,
    top: layout.block.top * scale - pad,
    width: layout.block.width * scale + pad * 2,
    height: layout.block.height * scale + pad * 2,
  };

  return (
    <div
      ref={ref}
      onPointerDown={onStagePointerDown}
      onPointerMove={onStagePointerMove}
      onPointerUp={onStagePointerUp}
      onPointerCancel={onStagePointerUp}
      onTouchStart={onStageTouchStart}
      onTouchMove={onStageTouchMove}
      onTouchEnd={onStageTouchEnd}
      className="relative w-full overflow-hidden rounded-xl border border-border bg-card"
      style={{
        aspectRatio: `${SLIDE_W} / ${SLIDE_H}`,
        // Vertical stays the browser's (page scrolls normally); horizontal and
        // pinch become ours.
        touchAction: "pan-y",
      }}
    >
      {slide.bgUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={slide.bgUrl} alt="" className="absolute inset-0 h-full w-full object-cover" />
      ) : slide.url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={slide.url} alt="" className="absolute inset-0 h-full w-full object-cover opacity-100" />
      ) : null}

      {w > 0 && (
        <CaptionLayer
          layout={layout}
          scale={scale}
          textBg={textBg}
          pill={usesPillHeading(slide.role, slide.number, slide.body, slide.caption)}
        />
      )}

      {/* snap guides */}
      {guides.x != null && (
        <div className="absolute top-0 bottom-0 w-px bg-accent/80" style={{ left: guides.x * w }} />
      )}
      {guides.y != null && (
        <div className="absolute left-0 right-0 h-px bg-accent/80" style={{ top: guides.y * heightPx }} />
      )}

      {/* drag handle */}
      {draggable && w > 0 && (
        <div
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          className="absolute touch-none rounded-md ring-1 ring-white/20 transition-shadow hover:ring-accent/60"
          style={{
            left: hit.left,
            top: hit.top,
            width: hit.width,
            height: hit.height,
            cursor: dragging ? "grabbing" : "grab",
          }}
          aria-label="Drag caption"
        />
      )}
    </div>
  );
}

/* ------------------------------- orchestrator ------------------------------ */
const PRESETS: { label: string; y: number }[] = [
  { label: "Top", y: 0.16 },
  { label: "Middle", y: 0.5 },
  { label: "Bottom", y: 0.82 },
];
const ALIGNS: Align[] = ["left", "center", "right"];
// Move / delete for the slide being edited (the header row).
const SLIDE_ACTION =
  "grid h-9 w-9 place-items-center rounded-lg text-white/50 transition-colors hover:bg-white/[0.06] hover:text-white disabled:pointer-events-none disabled:opacity-25";

// Keep the block visually put when align changes by re-deriving x from the
// current block center (x's meaning depends on align).
function reanchorX(slide: EditorSlide, nextAlign: Align): number {
  const L = layoutSlide({ text: slide.caption, role: slide.role, number: slide.number, pos: slide.pos });
  const centerFrac = (L.block.left + L.block.width / 2) / SLIDE_W;
  const halfFrac = L.block.width / 2 / SLIDE_W;
  if (nextAlign === "left") return clamp01(centerFrac - halfFrac);
  if (nextAlign === "right") return clamp01(centerFrac + halfFrac);
  return clamp01(centerFrac);
}

export function SlideEditor({
  id,
  initialSlides,
  onReposition,
  onSlidesChange,
}: {
  id: string;
  initialSlides: EditorSlide[];
  // Fired after a successful save so parents can refresh their baked previews
  // (filmstrip/thumbnails) — those are now composited on demand from the DB text.
  onReposition?: () => void;
  // Fired with the latest slides after a successful save so parents holding
  // their own copy (Generator result state → TikTok modal, downloads) stay in
  // sync with caption edits.
  onSlidesChange?: (slides: EditorSlide[]) => void;
}) {
  const [slides, setSlides] = useState<Slide[]>(() =>
    initialSlides.map((sl, i) => ({ ...sl, uid: i })),
  );
  const [selectedRaw, setSelected] = useState(0);
  // Clamped on read: a delete (or a delete rolled back) changes the length
  // under the index, and an out-of-range index would blank the whole editor.
  const selected = Math.min(selectedRaw, Math.max(0, slides.length - 1));
  const [applyAll, setApplyAll] = useState(false);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState("");
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** uids with edits not yet sent. */
  const pending = useRef<Set<number>>(new Set());
  // Floating "saved" toast — `n` bumps each save so the pill remounts and its
  // animation replays even on rapid consecutive saves. Portalled to <body>.
  const [toast, setToast] = useState<{ n: number } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  useEffect(() => () => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
  }, []);
  // Latest slides for the debounced save to read (avoids stale closures).
  const slidesRef = useRef(slides);
  useEffect(() => {
    slidesRef.current = slides;
  });
  // Every write to the server goes through ONE queue, in the order the edits
  // were made. A payload names slides by position, and positions shift when a
  // slide is moved or deleted — so a caption save that overtook the reorder
  // before it would land on the wrong slide. Payloads are built when the edit
  // happens, against the deck as it stood then; the queue keeps them in step.
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const enqueue = useCallback(<T,>(job: () => Promise<T>): Promise<T> => {
    const run = queue.current.then(job, job);
    queue.current = run.catch(() => {});
    return run;
  }, []);

  // Structural edits read the deck back in the same tick they change it, so
  // the ref moves with the state instead of waiting for the next render.
  const commit = useCallback((next: Slide[]) => {
    slidesRef.current = next;
    setSlides(next);
  }, []);

  const current = slides[selected];
  const missingBg = slides.some((s) => !s.bgUrl);
  const plateFor = useCallback((s: EditorSlide) => s.textBg === true, []);
  // Last successfully-saved caption per slide (by uid) — an emptied textarea
  // reverts to this on blur (a slide can never be committed textless).
  const savedCaptions = useRef<Map<number, string>>(
    new Map(initialSlides.map((s, i) => [i, s.caption])),
  );

  const announceSaved = useCallback(() => {
    setSaveState("saved");
    // Pulse the floating toast.
    setToast((t) => ({ n: (t?.n ?? 0) + 1 }));
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 1800);
  }, []);

  const persist = useCallback(
    (uids: number[]) => {
      const snapshot = slidesRef.current;
      const batch = uids
        .map((u) => snapshot.find((s) => s.uid === u))
        .filter((s): s is Slide => Boolean(s));
      if (batch.length === 0) return;
      const updates = batch.map((s) => ({
        position: s.position,
        x: s.pos.x,
        y: s.pos.y,
        align: s.pos.align,
        maxWidth: s.pos.maxWidth ?? null,
        fontScale: s.pos.fontScale ?? 1,
        caption: s.caption,
        body: s.body ?? "",
        textBg: s.textBg === true,
      }));
      setSaveState("saving");
      setError("");
      void enqueue(async () => {
        try {
          const res = await fetch(`/api/slideshows/${id}/reposition`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ updates }),
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data?.error || "Save failed.");
          // Saved. The composite is re-baked on demand, so just tell the
          // parent to refresh its baked previews (filmstrip/thumbnails).
          batch.forEach((sl) => {
            if (sl.caption.trim()) savedCaptions.current.set(sl.uid, sl.caption);
          });
          onSlidesChange?.(slidesRef.current);
          onReposition?.();
          announceSaved();
        } catch (e) {
          setSaveState("error");
          setError(e instanceof Error ? e.message : "Save failed.");
        }
      });
    },
    [id, enqueue, announceSaved, onReposition, onSlidesChange],
  );

  const scheduleSave = useCallback(
    (uids: number[]) => {
      uids.forEach((u) => pending.current.add(u));
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        saveTimer.current = null;
        const batch = [...pending.current];
        pending.current.clear();
        persist(batch);
      }, 450);
    },
    [persist],
  );

  /** Send edits still waiting on the debounce — before anything that changes
   *  which position a slide sits at, or that reads the deck back server-side. */
  const flushPending = useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = null;
    const batch = [...pending.current];
    pending.current.clear();
    persist(batch);
  }, [persist]);

  // ── Swap this slide's photo ────────────────────────────────────────────
  // Captions are live DB data composited at render time, so replacing the
  // background can never disturb the text or lose an edit — the server just
  // overwrites the text-free `-bg.jpg` and the next render picks it up.
  const [photoBusy, setPhotoBusy] = useState<"ai" | "upload" | null>(null);
  const [photoError, setPhotoError] = useState("");
  // Source URLs the user has rejected, per slide (by uid). Without this the
  // vision judge is deterministic enough to hand back the same photo forever.
  const rejected = useRef<Map<number, string[]>>(new Map());
  const photoFileRef = useRef<HTMLInputElement>(null);

  // The signed URL points at the object we just overwrote, so the browser would
  // serve the old bytes from cache. A fresh param forces a refetch. Not `v`:
  // the render endpoint reads `?v=` as "immutable, cache for a year" (that is
  // the hub thumbnails' contract), and these URLs outlive later caption edits.
  const bustUrl = (u: string) => {
    if (!u) return u;
    const clean = u.replace(/([?&])r=\d+(&|$)/, (_m, lead: string, more: string) =>
      more ? lead : "",
    );
    return `${clean}${clean.includes("?") ? "&" : "?"}r=${Date.now()}`;
  };

  const swapPhoto = useCallback(
    async (mode: "ai" | "upload", image?: string) => {
      const slide = slidesRef.current[selected];
      if (!slide || photoBusy) return;
      setPhotoBusy(mode);
      setPhotoError("");
      try {
        // The server finds this slide by position and reads its caption, so
        // every edit made so far has to have landed first.
        flushPending();
        await queue.current;
        const res = await fetch(`/api/slideshows/${id}/image`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            position: slide.position,
            mode,
            image,
            exclude: rejected.current.get(slide.uid) ?? [],
          }),
        });
        const data = (await res.json()) as {
          error?: string;
          sourceUrl?: string | null;
          bgUrl?: string | null;
          textBg?: boolean;
        };
        if (!res.ok) {
          setPhotoError(data.error ?? "Couldn't change that photo.");
          return;
        }
        if (data.sourceUrl) {
          const seen = rejected.current.get(slide.uid) ?? [];
          rejected.current.set(slide.uid, [...seen, data.sourceUrl]);
        }
        const next = slidesRef.current.map((s) =>
          s.uid === slide.uid
            ? {
                ...s,
                // The background lives at a NEW path now and the old object is
                // deleted, so the previous signed URL is dead — use the fresh
                // one the server just signed.
                bgUrl: data.bgUrl ?? bustUrl(s.bgUrl),
                url: bustUrl(s.url),
                // Re-measured server-side against the new photo.
                textBg: data.textBg ?? s.textBg,
              }
            : s,
        );
        commit(next);
        onSlidesChange?.(next);
        // The hub thumbnail and any parent filmstrip bake from the server.
        onReposition?.();
      } catch {
        setPhotoError("Couldn't change that photo.");
      } finally {
        setPhotoBusy(null);
      }
    },
    [id, selected, photoBusy, flushPending, commit, onSlidesChange, onReposition],
  );

  // Rendered TWICE — under the image on phones, in the controls column on
  // desktop — so it is defined once here. Only one is ever visible, and the
  // file input is mounted inside it, so the hidden-input ref stays unambiguous.
  const photoActions = (
    <div>
      {/* Equal halves rather than shrink-to-fit: on a phone these were two
          stacked full-width slabs, which read as form fields rather than as
          the two things you can do to the picture above. h-11 keeps them a
          comfortable thumb target. */}
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => void swapPhoto("ai")}
          disabled={photoBusy !== null}
          className="inline-flex h-11 items-center justify-center gap-1.5 rounded-xl border border-border bg-card px-3 text-sm font-medium transition-colors hover:border-accent/40 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          {photoBusy === "ai" ? (
            <svg className="animate-spin shrink-0" width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
              <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.5" opacity="0.25" />
              <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
            </svg>
          ) : (
            <svg className="shrink-0" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M21 2v6h-6M3 12a9 9 0 0 1 15-6.7L21 8M3 22v-6h6M21 12a9 9 0 0 1-15 6.7L3 16" />
            </svg>
          )}
          <span className="truncate">
            {photoBusy === "ai" ? "Finding one…" : "New photo"}
          </span>
        </button>
        <button
          type="button"
          onClick={() => photoFileRef.current?.click()}
          disabled={photoBusy !== null}
          className="inline-flex h-11 items-center justify-center gap-1.5 rounded-xl border border-border bg-card px-3 text-sm font-medium transition-colors hover:border-accent/40 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          {photoBusy === "upload" ? (
            <svg className="animate-spin shrink-0" width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
              <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.5" opacity="0.25" />
              <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
            </svg>
          ) : (
            <svg className="shrink-0" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M12 19V5M5 12l7-7 7 7" />
            </svg>
          )}
          <span className="truncate">
            {photoBusy === "upload" ? "Uploading…" : "Upload photo"}
          </span>
        </button>
      </div>
      {photoError ? (
        <p className="mt-1.5 text-xs text-red-300">{photoError}</p>
      ) : null}
      <input
        ref={photoFileRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (!file) return;
          // Downscaled in the browser first: a full-res phone photo blows past
          // the request body limit, and the server fits it to 1080x1920 anyway.
          void downscaleForSlide(file).then((dataUrl) => {
            if (dataUrl) void swapPhoto("upload", dataUrl);
            else setPhotoError("Couldn't read that image.");
          });
        }}
      />
    </div>
  );

  // ── Reorder, delete, undo ──────────────────────────────────────────────
  // Deck-level, so they save immediately rather than joining the debounced
  // per-slide batch. Optimistic: the filmstrip changes at once and reverts on
  // error.
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);
  // "Slide deleted · Undo". `row` is the record the server handed back for the
  // deleted slide — what restore-slide needs to put it back.
  const [undo, setUndo] = useState<{ n: number } | null>(null);
  const undoRef = useRef<{
    slide: Slide;
    index: number;
    row: Record<string, unknown> | null;
  } | null>(null);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // A photo swap is tied to a position for as long as it runs (seconds), so the
  // deck holds its shape until it lands.
  const locked = photoBusy !== null;

  // `position` is the slide's ordinal AND the key the render endpoint bakes
  // from (/render/<position>), so a changed deck is renumbered and its URLs
  // rebuilt — and its numbering and hook count kept true (reconcileDeckText).
  const settle = useCallback(
    (before: Slide[], arranged: Slide[]): Slide[] => {
      const stamp = Date.now();
      return reconcileDeckText(before, arranged).map((sl, i) => ({
        ...sl,
        position: i,
        url: sl.url.startsWith("data:")
          ? sl.url
          : `/api/slideshows/${id}/render/${i}?r=${stamp}`,
      }));
    },
    [id],
  );

  const post = useCallback(
    (route: string, body: unknown, keepalive = false) =>
      fetch(`/api/slideshows/${id}/${route}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        keepalive,
      }),
    [id],
  );

  /**
   * Show `next` now, then tell the server. `known` is every slide as it stood
   * before the edit (including one being put back), so the captions that
   * settle() rewrote can be sent along, keyed by their new position. `send`
   * resolving to null means there turned out to be nothing to do.
   */
  const applyStructure = useCallback(
    (
      before: Slide[],
      next: Slide[],
      known: Slide[],
      send: (texts: { position: number; caption: string; number: number | null }[]) => Promise<Response | null>,
      failure: string,
      onDone?: (data: Record<string, unknown>) => void,
      onFail?: () => void,
    ) => {
      const was = new Map(known.map((sl) => [sl.uid, sl]));
      const rewritten = next.filter((sl) => {
        const prev = was.get(sl.uid);
        return prev != null && (prev.caption !== sl.caption || prev.number !== sl.number);
      });
      const texts = rewritten.map((sl) => ({
        position: sl.position,
        caption: sl.caption,
        number: sl.number,
      }));
      commit(next);
      setSaveState("saving");
      setError("");
      void enqueue(async () => {
        try {
          const res = await send(texts);
          if (!res) return;
          const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
          if (!res.ok) throw new Error((data.error as string) || failure);
          rewritten.forEach((sl) => savedCaptions.current.set(sl.uid, sl.caption));
          onDone?.(data);
          onSlidesChange?.(slidesRef.current);
          onReposition?.();
          announceSaved();
        } catch (e) {
          commit(before);
          onFail?.();
          setSaveState("error");
          setError(e instanceof Error ? e.message : failure);
        }
      });
    },
    [commit, enqueue, announceSaved, onReposition, onSlidesChange],
  );

  const move = useCallback(
    (from: number, to: number) => {
      const before = slidesRef.current;
      if (locked || from === to) return;
      if (from < 0 || to < 0 || from >= before.length || to >= before.length) return;
      flushPending();
      const arranged = [...before];
      const [taken] = arranged.splice(from, 1);
      arranged.splice(to, 0, taken);
      // The API wants the ORIGINAL positions in their new order.
      const order = arranged.map((sl) => sl.position);
      setSelected(to);
      applyStructure(
        before,
        settle(before, arranged),
        before,
        (texts) => post("reorder", { order, texts }),
        "Reorder failed.",
      );
    },
    [locked, flushPending, settle, applyStructure, post],
  );

  /** The Undo window closed: the deleted slide's background can go. Queued, so
   *  it runs after the delete it belongs to has answered with the path. */
  const closeUndo = useCallback(() => {
    if (undoTimer.current) clearTimeout(undoTimer.current);
    undoTimer.current = null;
    const entry = undoRef.current;
    undoRef.current = null;
    setUndo(null);
    if (!entry) return;
    void enqueue(async () => {
      const path = entry.row?.storage_path;
      if (typeof path !== "string") return;
      await post("delete-slide", { purge: path }, true).catch(() => {});
    });
  }, [enqueue, post]);

  const remove = useCallback(
    (index: number) => {
      const before = slidesRef.current;
      const target = before[index];
      // A deck can't lose its only slide.
      if (locked || !target || before.length <= 1) return;
      flushPending();
      // One Undo at a time: an earlier delete becomes final.
      closeUndo();
      const next = settle(
        before,
        before.filter((_, i) => i !== index),
      );
      setSelected((cur) => {
        const at = Math.min(cur, before.length - 1);
        return index < at ? at - 1 : Math.min(at, next.length - 1);
      });
      const entry = { slide: target, index, row: null as Record<string, unknown> | null };
      undoRef.current = entry;
      setUndo((u) => ({ n: (u?.n ?? 0) + 1 }));
      undoTimer.current = setTimeout(closeUndo, UNDO_MS);
      applyStructure(
        before,
        next,
        before,
        (texts) => post("delete-slide", { position: target.position, texts }),
        "Couldn't delete that slide.",
        (data) => {
          entry.row = (data.removed as Record<string, unknown> | undefined) ?? null;
        },
        () => {
          // Nothing was deleted, so there is nothing to undo.
          if (undoRef.current !== entry) return;
          if (undoTimer.current) clearTimeout(undoTimer.current);
          undoRef.current = null;
          setUndo(null);
        },
      );
    },
    [locked, flushPending, closeUndo, settle, applyStructure, post],
  );

  const undoDelete = useCallback(() => {
    const entry = undoRef.current;
    if (locked || !entry) return;
    if (undoTimer.current) clearTimeout(undoTimer.current);
    undoTimer.current = null;
    undoRef.current = null;
    setUndo(null);
    flushPending();
    const before = slidesRef.current;
    const at = Math.min(entry.index, before.length);
    const next = settle(before, [...before.slice(0, at), entry.slide, ...before.slice(at)]);
    setSelected(at);
    applyStructure(
      before,
      next,
      [...before, entry.slide],
      // No row means the delete itself failed and was already rolled back.
      async (texts) =>
        entry.row ? post("restore-slide", { slide: entry.row, position: at, texts }) : null,
      "Couldn't restore that slide.",
    );
  }, [locked, flushPending, settle, applyStructure, post]);

  // Leaving with the Undo still up makes the delete final.
  useEffect(
    () => () => {
      if (undoTimer.current) clearTimeout(undoTimer.current);
      const path = undoRef.current?.row?.storage_path;
      if (typeof path === "string") {
        void fetch(`/api/slideshows/${id}/delete-slide`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ purge: path }),
          keepalive: true,
        }).catch(() => {});
      }
    },
    [id],
  );

  // Keep the selected thumbnail in view — moving a slide with the arrows would
  // otherwise walk it off the edge of the strip on a phone. Horizontal only:
  // scrollIntoView would also yank the PAGE back up to the filmstrip.
  const stripRef = useRef<HTMLDivElement>(null);
  const orderKey = slides.map((sl) => sl.uid).join(",");
  useEffect(() => {
    const strip = stripRef.current;
    const thumb = strip?.children[selected] as HTMLElement | undefined;
    if (!strip || !thumb) return;
    const left = thumb.offsetLeft;
    const right = left + thumb.offsetWidth;
    if (left < strip.scrollLeft) {
      strip.scrollTo({ left: left - 12, behavior: "smooth" });
    } else if (right > strip.scrollLeft + strip.clientWidth) {
      strip.scrollTo({ left: right - strip.clientWidth + 12, behavior: "smooth" });
    }
  }, [selected, orderKey]);

  // Apply a position change to the selected slide (and all, if toggled).
  const applyPos = useCallback(
    (patch: Partial<SlidePos>, opts?: { commit?: boolean }) => {
      setSlides((prev) => {
        const cur = prev[selected];
        const nextPos: SlidePos = { ...cur.pos, ...patch };
        return prev.map((s, i) => {
          if (applyAll) return { ...s, pos: { ...s.pos, ...patch } };
          return i === selected ? { ...s, pos: nextPos } : s;
        });
      });
      if (opts?.commit) {
        const cur = slidesRef.current;
        scheduleSave(applyAll ? cur.map((s) => s.uid) : [cur[selected].uid]);
      }
    },
    [selected, applyAll, scheduleSave],
  );

  // Live drag (no save until release).
  const onDrag = useCallback(
    (x: number, y: number) => applyPos({ x, y }),
    [applyPos],
  );
  const onCommit = useCallback(() => {
    const cur = slidesRef.current;
    scheduleSave(applyAll ? cur.map((s) => s.uid) : [cur[selected].uid]);
  }, [applyAll, selected, scheduleSave]);

  function setAlign(a: Align) {
    applyPos({ align: a, x: reanchorX(current, a) }, { commit: true });
  }
  function setPreset(y: number) {
    applyPos({ y }, { commit: true });
  }
  function setWidth(maxWidth: number | undefined) {
    applyPos({ maxWidth }, { commit: true });
  }
  function setBody(body: string) {
    setSlides((prev) =>
      prev.map((sl, i) => (i === selected ? { ...sl, body } : sl)),
    );
    scheduleSave([slidesRef.current[selected].uid]);
  }
  function setTextBg(textBg: boolean) {
    setSlides((prev) =>
      prev.map((sl, i) => (i === selected ? { ...sl, textBg } : sl)),
    );
    scheduleSave([slidesRef.current[selected].uid]);
  }
  function setFontScale(fontScale: number) {
    applyPos({ fontScale }, { commit: true });
  }
  /** Live pinch resize — no save until the fingers lift (onCommit does that),
   *  so a pinch is one write instead of one per frame. */
  const onScale = useCallback(
    (fontScale: number) => applyPos({ fontScale }),
    [applyPos],
  );
  /** Swipe between slides. Wraps, same as the on-screen arrows. */
  const onSwipe = useCallback(
    (dir: -1 | 1) =>
      setSelected((cur) => (cur + dir + slidesRef.current.length) % slidesRef.current.length),
    [],
  );
  // Everything layoutSlide derives from — position, alignment, width, size —
  // back to what generation produced. The caption text is deliberately NOT
  // reset: the original wording isn't stored anywhere, so there is nothing
  // truthful to restore it to.
  function resetToDefaults() {
    applyPos(
      {
        x: DEFAULT_POS.x,
        y: DEFAULT_POS.y,
        align: DEFAULT_POS.align,
        maxWidth: undefined,
        fontScale: 1,
      },
      { commit: true },
    );
  }

  // Caption text editing — live WYSIWYG (the overlay re-lays-out on every
  // keystroke), debounced save; an emptied field reverts on blur.
  function setCaption(text: string) {
    // `number: null` mirrors what the save does server-side. layoutSlide only
    // auto-prefixes "2. " when `number` is set, so clearing it here is what
    // makes the overlay obey a deleted number on the very next keystroke —
    // without it the preview keeps re-adding the digit the user just removed
    // and the box disagrees with the slide until a reload.
    setSlides((prev) =>
      prev.map((s, i) =>
        i === selected ? { ...s, caption: text, number: null } : s,
      ),
    );
    if (text.trim()) scheduleSave([slidesRef.current[selected].uid]);
  }
  function onCaptionBlur() {
    const cur = slidesRef.current[selected];
    if (!cur.caption.trim()) {
      const saved = savedCaptions.current.get(cur.uid) ?? "";
      setSlides((prev) =>
        prev.map((s, i) => (i === selected ? { ...s, caption: saved } : s)),
      );
    }
  }

  useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, []);

  if (!current) return null;

  return (
    <div className="pt-2">
      {/* Floating auto-save toast (levitates above everything, then fades away). */}
      {/* Delete is one click, so it is undoable rather than confirmed. */}
      {mounted && undo &&
        createPortal(
          <div className="pointer-events-none fixed inset-x-0 bottom-6 z-[100] flex justify-center px-4">
            <div
              key={undo.n}
              role="status"
              className="animate-fade-up pointer-events-auto flex items-center gap-3 rounded-full border border-white/[0.08] bg-[#1a1a1c]/95 py-1.5 pl-4 pr-1.5 shadow-2xl shadow-black/40 backdrop-blur-md"
            >
              <span className="text-xs font-medium text-white/80">Slide deleted</span>
              <button
                type="button"
                onClick={undoDelete}
                className="rounded-full bg-white/[0.08] px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-white/[0.16]"
              >
                Undo
              </button>
            </div>
          </div>,
          document.body,
        )}
      {mounted && toast && !undo &&
        createPortal(
          <div className="pointer-events-none fixed bottom-6 left-1/2 z-[100] -translate-x-1/2">
            <div
              key={toast.n}
              className="animate-save-toast flex items-center gap-1.5 rounded-full border border-white/[0.08] bg-[#1a1a1c]/85 px-3 py-1.5 shadow-2xl shadow-black/40 backdrop-blur-md"
            >
              <svg
                width="13"
                height="13"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="3"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="text-accent"
                aria-hidden
              >
                <path d="M20 6L9 17l-5-5" />
              </svg>
              <span className="text-xs font-medium text-white/80">Saved</span>
            </div>
          </div>,
          document.body,
        )}
      {missingBg && (
        <p className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
          Some slides were generated before position editing existed, so the
          editable background isn&apos;t stored. Regenerate the slideshow to drag
          captions with a live background.
        </p>
      )}

      {/* Navigation filmstrip — click through the whole slideshow, and the
          place its order is edited: drag a slide, or use the controls on it. */}
      <div
        ref={stripRef}
        className="no-scrollbar relative -mx-1 flex gap-3 overflow-x-auto px-1 pb-1 pt-1"
      >
        {slides.map((s, i) => (
          <StaticSlide
            key={s.uid}
            slide={s}
            index={i}
            count={locked ? 1 : slides.length}
            width={84}
            selected={i === selected}
            onSelect={() => setSelected(i)}
            textBg={plateFor(s)}
            dragging={dragFrom === i}
            dropTarget={dragOver === i && dragFrom !== null && dragFrom !== i}
            onDragStart={() => setDragFrom(i)}
            onDragEnter={() => setDragOver(i)}
            onDragEnd={() => {
              setDragFrom(null);
              setDragOver(null);
            }}
            onDrop={() => {
              if (dragFrom !== null) move(dragFrom, i);
              setDragFrom(null);
              setDragOver(null);
            }}
            onMove={(dir) => move(i, i + dir)}
            onDelete={() => remove(i)}
          />
        ))}
      </div>

      <div className="mt-6 grid gap-8 lg:grid-cols-[minmax(0,320px)_1fr]">
        {/* Stage */}
        <div>
          <div className="relative">
            <EditableStage
              slide={current}
              draggable={Boolean(current.bgUrl)}
              onDrag={onDrag}
              onCommit={onCommit}
              onScale={onScale}
              onSwipe={onSwipe}
              textBg={plateFor(current)}
            />

            {/* Slide counter */}
            <div className="pointer-events-none absolute left-3 top-3 rounded-full bg-black/55 px-2.5 py-1 text-xs font-semibold text-white backdrop-blur-sm">
              {selected + 1} / {slides.length}
            </div>

            {/* Prev / next navigation */}
            {slides.length > 1 && (
              <>
                <button
                  type="button"
                  onClick={() => setSelected((s) => (s - 1 + slides.length) % slides.length)}
                  aria-label="Previous slide"
                  className="absolute left-2 top-1/2 z-20 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-full bg-black/55 text-white backdrop-blur-sm transition-colors hover:bg-black/80"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="M15 18l-6-6 6-6" />
                  </svg>
                </button>
                <button
                  type="button"
                  onClick={() => setSelected((s) => (s + 1) % slides.length)}
                  aria-label="Next slide"
                  className="absolute right-2 top-1/2 z-20 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-full bg-black/55 text-white backdrop-blur-sm transition-colors hover:bg-black/80"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="M9 18l6-6-6-6" />
                  </svg>
                </button>
              </>
            )}
          </div>
          {/* Phones: right under the image, before anything else. The user
              is looking at the photo — the way to change it should be within
              a thumb's reach of it, not below the caption fields. */}
          <div className="mt-3 lg:hidden">{photoActions}</div>
          <p className="mt-3 text-center text-xs text-muted">
            Drag the caption to reposition · snaps to thirds &amp; center
          </p>
        </div>

        {/* Controls */}
        <div className="space-y-5">
          <div>
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold">
                Slide {selected + 1}
                <span className="ml-2 font-normal capitalize text-muted">{current.role}</span>
              </h3>
              {/* The same three actions the thumbnail carries, always on
                  screen for the slide being edited. */}
              {slides.length > 1 && (
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    onClick={() => move(selected, selected - 1)}
                    disabled={locked || selected === 0}
                    aria-label="Move slide earlier"
                    title="Move earlier"
                    className={SLIDE_ACTION}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                      <path d="M19 12H5M12 19l-7-7 7-7" />
                    </svg>
                  </button>
                  <button
                    type="button"
                    onClick={() => move(selected, selected + 1)}
                    disabled={locked || selected === slides.length - 1}
                    aria-label="Move slide later"
                    title="Move later"
                    className={SLIDE_ACTION}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                      <path d="M5 12h14M12 5l7 7-7 7" />
                    </svg>
                  </button>
                  <button
                    type="button"
                    onClick={() => remove(selected)}
                    disabled={locked}
                    aria-label="Delete slide"
                    title="Delete slide"
                    className={`${SLIDE_ACTION} hover:bg-red-500/15 hover:text-red-300`}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                      <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M10 11v6M14 11v6" />
                    </svg>
                  </button>
                </div>
              )}
            </div>
            {saveState === "error" ? (
              <p className="mt-1.5 text-xs font-medium text-red-300">
                {error || "Save failed"}
              </p>
            ) : null}
          </div>

          {/* Photo controls live under the IMAGE on phones (see the stage
              above) — down here they were a screen-scroll away from the thing
              they change. Desktop keeps them in this column, where the preview
              is already alongside. */}
          <div className="hidden lg:block">
            <p className="mb-1.5 text-xs font-medium text-muted">Photo</p>
            {photoActions}
          </div>

          {/* Caption text */}
          <div>
            <p className="mb-1.5 text-xs font-medium text-muted">Caption</p>
            <textarea
              value={current.caption}
              onChange={(e) => setCaption(e.target.value)}
              onBlur={onCaptionBlur}
              rows={3}
              maxLength={300}
              aria-label="Slide caption"
              className="w-full resize-none rounded-lg border border-border bg-card px-3 py-2.5 text-sm leading-snug focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/40"
            />
          </div>

          {/* Body paragraph — where the substance of a value slide lives. Only
              short decks generate one, but it is editable on any slide. */}
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <p className="text-xs font-medium text-muted">Body</p>
              <span className="text-xs text-muted">optional</span>
            </div>
            <textarea
              value={current.body ?? ""}
              onChange={(e) => setBody(e.target.value)}
              rows={4}
              maxLength={600}
              placeholder="The detail under the heading — the numbers, the method, the caveat."
              aria-label="Slide body paragraph"
              className="w-full resize-none rounded-lg border border-border bg-card px-3 py-2.5 text-sm leading-snug focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/40"
            />
          </div>

          {/* Caption plate — PER SLIDE. Seeded from the contrast measurement
              taken at generation, then owned by the user. A deck-level
              auto/always/never was the wrong shape: legibility is a property of
              one photo, not of the deck. */}
          <label className="flex cursor-pointer items-center gap-2.5 rounded-lg border border-border bg-card px-3 py-2.5">
            <input
              type="checkbox"
              checked={current.textBg === true}
              onChange={(e) => setTextBg(e.target.checked)}
              className="h-4 w-4 accent-accent"
            />
            <span className="text-sm">
              Black background behind text
            </span>
          </label>

          {/* Presets */}
          <div>
            <p className="mb-1.5 text-xs font-medium text-muted">Quick position</p>
            <div className="flex gap-2">
              {PRESETS.map((p) => (
                <button
                  key={p.label}
                  type="button"
                  onClick={() => setPreset(p.y)}
                  className="flex-1 rounded-lg border border-border bg-card px-3 py-2 text-sm font-medium transition-colors hover:border-accent hover:text-accent-text"
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          {/* Align */}
          <div>
            <p className="mb-1.5 text-xs font-medium text-muted">Alignment</p>
            <div className="flex gap-2">
              {ALIGNS.map((a) => (
                <button
                  key={a}
                  type="button"
                  onClick={() => setAlign(a)}
                  aria-pressed={current.pos.align === a}
                  className={`flex-1 rounded-lg border px-3 py-2 text-sm font-medium capitalize transition-colors ${
                    current.pos.align === a
                      ? "border-accent bg-accent/10 text-accent-text"
                      : "border-border bg-card hover:border-accent/50"
                  }`}
                >
                  {a}
                </button>
              ))}
            </div>
          </div>

          {/* Width */}
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <p className="text-xs font-medium text-muted">Text width</p>
              <span className="text-xs text-muted">
                {Math.round((current.pos.maxWidth ?? 0) * 100) || "Auto"}
                {current.pos.maxWidth ? "%" : ""}
              </span>
            </div>
            <input
              type="range"
              min={30}
              max={96}
              value={Math.round((current.pos.maxWidth ?? 0.84) * 100)}
              onChange={(e) => setWidth(Number(e.target.value) / 100)}
              className="w-full accent-accent"
            />
          </div>

          {/* Text size — multiplies the role's base size before wrapping, so a
              bigger size re-wraps into more lines rather than overflowing. */}
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <p className="text-xs font-medium text-muted">Text size</p>
              <span className="text-xs text-muted">
                {Math.round((current.pos.fontScale ?? 1) * 100)}%
              </span>
            </div>
            <input
              type="range"
              min={Math.round(FONT_SCALE_MIN * 100)}
              max={Math.round(FONT_SCALE_MAX * 100)}
              step={5}
              value={Math.round((current.pos.fontScale ?? 1) * 100)}
              onChange={(e) => setFontScale(Number(e.target.value) / 100)}
              aria-label="Caption text size"
              className="w-full accent-accent"
            />
          </div>

          {/* Apply to all */}
          <label className="flex cursor-pointer items-center gap-2.5 rounded-lg border border-border bg-card px-3 py-2.5">
            <input
              type="checkbox"
              checked={applyAll}
              onChange={(e) => setApplyAll(e.target.checked)}
              className="h-4 w-4 accent-accent"
            />
            <span className="text-sm">
              Apply position to <strong>all slides</strong>
            </span>
          </label>

          {/* Reset — everything layoutSlide derives from, back to as-generated. */}
          <div className="pt-1">
            <button
              type="button"
              onClick={resetToDefaults}
              className="w-full rounded-lg border border-border bg-card px-3 py-2.5 text-sm font-medium text-muted transition-colors hover:border-accent hover:text-accent-text"
            >
              Reset to defaults
            </button>
            <p className="mt-1.5 text-xs text-muted">
              Puts position, alignment, width and size back to how this slide was
              generated. Your caption text is left alone.
            </p>
          </div>

          {/* Per-slide download */}
          <a
            href={current.url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-4 py-2 text-sm font-semibold transition-colors hover:border-accent hover:text-accent-text"
          >
            Open exported PNG ↗
          </a>
        </div>
      </div>
    </div>
  );
}
