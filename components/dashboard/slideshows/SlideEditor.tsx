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
  PLATE_WIDTH_SLACK,
  SLIDE_H,
  SLIDE_W,
  type Align,
  type SlideLayout,
  type SlidePos,
  type SlideRole,
} from "@/lib/generate/layout";

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
}: {
  layout: SlideLayout;
  scale: number;
  textBg?: boolean;
}) {
  const shadow = `0 ${3 * scale}px ${6 * scale}px rgba(0,0,0,0.45)`;
  // Black outline behind the white fill — mirrors the SVG bake's paint-order:stroke.
  const strokeW = Math.max(2, layout.fontSize * 0.15) * scale;
  const anchor = layout.textAnchor;
  const translateX = anchor === "middle" ? "-50%" : anchor === "end" ? "-100%" : "0";
  const textAlign = anchor === "middle" ? "center" : anchor === "end" ? "right" : "left";

  return (
    <>
      {/* Black plate for low-contrast backgrounds — mirrors plateSvg() in the
          compositor: one rect per line, tiled at lineHeight, same padding and
          radius constants. Painted under the text; the type is unchanged. */}
      {textBg &&
        layout.lineBoxes.map((b, i) => (
          <div
            key={`plate-${i}`}
            style={{
              position: "absolute",
              left:
                (b.left -
                  layout.fontSize * PLATE_PAD_X_FRAC -
                  (b.width * (PLATE_WIDTH_SLACK - 1)) / 2) *
                scale,
              top: b.top * scale,
              width:
                (b.width * PLATE_WIDTH_SLACK +
                  layout.fontSize * PLATE_PAD_X_FRAC * 2) *
                scale,
              height: b.height * scale,
              borderRadius: layout.fontSize * PLATE_RADIUS_FRAC * scale,
              background: "rgba(0,0,0,0.82)",
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
          color: "#fff",
          WebkitTextStroke: `${strokeW}px #000`,
          paintOrder: "stroke",
          textShadow: shadow,
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
            WebkitTextStroke: `${Math.max(2, layout.bodyFontSize * 0.15) * scale}px #000`,
            paintOrder: "stroke",
            textShadow: shadow,
            whiteSpace: "nowrap",
            pointerEvents: "none",
          }}
        >
          {layout.bodyLines.map((ln, i) => (
            <div key={i} style={{ whiteSpace: "nowrap" }}>
              {ln}
            </div>
          ))}
        </div>
      )}
    </>
  );
}

/* --------------------------- small static preview -------------------------- */
function StaticSlide({
  slide,
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
}: {
  slide: EditorSlide;
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
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      draggable={Boolean(onDragStart)}
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
      title={onDragStart ? "Drag to reorder" : undefined}
      className={`relative shrink-0 overflow-hidden rounded-xl border transition-all ${
        onDragStart ? "cursor-grab active:cursor-grabbing" : ""
      } ${dragging ? "opacity-30" : ""} ${
        dropTarget
          ? "border-accent ring-2 ring-accent"
          : selected
            ? "border-accent ring-2 ring-accent/60"
            : "border-white/8 opacity-60 hover:opacity-100 hover:border-white/25"
      }`}
      style={{ width, height: width * (SLIDE_H / SLIDE_W) }}
    >
      {bg ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={bg} alt="" className="absolute inset-0 h-full w-full object-cover" />
      ) : null}
      <CaptionLayer layout={layout} scale={scale} textBg={textBg} />
    </button>
  );
}

/* ----------------------------- editable stage ------------------------------ */
function EditableStage({
  slide,
  draggable,
  onDrag,
  onCommit,
  textBg,
}: {
  slide: EditorSlide;
  draggable: boolean;
  onDrag: (x: number, y: number) => void;
  onCommit: () => void;
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

  const onPointerDown = (e: React.PointerEvent) => {
    if (!draggable || !w) return;
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { sx: e.clientX, sy: e.clientY, bx: slide.pos.x, by: slide.pos.y };
    setDragging(true);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current || !w) return;
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
      className="relative w-full overflow-hidden rounded-xl border border-border bg-card"
      style={{ aspectRatio: `${SLIDE_W} / ${SLIDE_H}` }}
    >
      {slide.bgUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={slide.bgUrl} alt="" className="absolute inset-0 h-full w-full object-cover" />
      ) : slide.url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={slide.url} alt="" className="absolute inset-0 h-full w-full object-cover opacity-100" />
      ) : null}

      {w > 0 && <CaptionLayer layout={layout} scale={scale} textBg={textBg} />}

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
  const [slides, setSlides] = useState<EditorSlide[]>(initialSlides);
  const [selected, setSelected] = useState(0);
  const [applyAll, setApplyAll] = useState(false);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState("");
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
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

  const current = slides[selected];
  const missingBg = slides.some((s) => !s.bgUrl);
  const plateFor = useCallback((s: EditorSlide) => s.textBg === true, []);
  // Last successfully-saved caption per position — an emptied textarea reverts
  // to this on blur (a slide can never be committed textless).
  const savedCaptions = useRef<Map<number, string>>(
    new Map(initialSlides.map((s) => [s.position, s.caption])),
  );

  const persist = useCallback(
    async (positions: number[]) => {
      setSaveState("saving");
      setError("");
      const snapshot = slidesRef.current;
      const updates = positions
        .map((p) => snapshot.find((s) => s.position === p))
        .filter((s): s is EditorSlide => Boolean(s))
        .map((s) => ({
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
        updates.forEach((u) => {
          if (u.caption.trim()) savedCaptions.current.set(u.position, u.caption);
        });
        onSlidesChange?.(slidesRef.current);
        onReposition?.();
        setSaveState("saved");
        // Pulse the floating toast.
        setToast((t) => ({ n: (t?.n ?? 0) + 1 }));
        if (toastTimer.current) clearTimeout(toastTimer.current);
        toastTimer.current = setTimeout(() => setToast(null), 1800);
      } catch (e) {
        setSaveState("error");
        setError(e instanceof Error ? e.message : "Save failed.");
      }
    },
    [id, onReposition, onSlidesChange],
  );

  // Deck-level, so it saves immediately rather than joining the debounced
  // per-slide batch. Optimistic: the preview flips at once and reverts on error.
  // Drag-to-reorder. `position` is the slide's ordinal AND the key the render
  // endpoint bakes from (/render/<position>), so a reorder has to renumber the
  // local slides and rebuild their URLs, not just move array entries around.
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);

  const reorder = useCallback(
    async (from: number, to: number) => {
      if (from === to) return;
      const before = slidesRef.current;
      const moved = [...before];
      const [taken] = moved.splice(from, 1);
      moved.splice(to, 0, taken);
      // The API wants the ORIGINAL positions in their new order.
      const order = moved.map((sl) => sl.position);

      const renumbered = moved.map((sl, i) => ({
        ...sl,
        position: i,
        url: sl.url.startsWith("data:")
          ? sl.url
          : `/api/slideshows/${id}/render/${i}`,
      }));
      setSlides(renumbered);
      setSelected(to);
      // savedCaptions is keyed by position, so it has to move with them.
      savedCaptions.current = new Map(
        renumbered.map((sl) => [sl.position, sl.caption]),
      );
      setSaveState("saving");
      setError("");
      try {
        const res = await fetch(`/api/slideshows/${id}/reorder`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ order }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || "Reorder failed.");
        onSlidesChange?.(renumbered);
        onReposition?.();
        setSaveState("saved");
        setToast((t) => ({ n: (t?.n ?? 0) + 1 }));
        if (toastTimer.current) clearTimeout(toastTimer.current);
        toastTimer.current = setTimeout(() => setToast(null), 1800);
      } catch (e) {
        setSlides(before);
        savedCaptions.current = new Map(
          before.map((sl) => [sl.position, sl.caption]),
        );
        setSaveState("error");
        setError(e instanceof Error ? e.message : "Reorder failed.");
      }
    },
    [id, onReposition, onSlidesChange],
  );

  const scheduleSave = useCallback(
    (positions: number[]) => {
      positions.forEach((p) => pending.current.add(p));
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        const batch = [...pending.current];
        pending.current.clear();
        void persist(batch);
      }, 450);
    },
    [persist],
  );

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
        const positions = applyAll ? cur.map((s) => s.position) : [cur[selected].position];
        scheduleSave(positions);
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
    const positions = applyAll ? cur.map((s) => s.position) : [cur[selected].position];
    scheduleSave(positions);
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
    scheduleSave([slidesRef.current[selected].position]);
  }
  function setTextBg(textBg: boolean) {
    setSlides((prev) =>
      prev.map((sl, i) => (i === selected ? { ...sl, textBg } : sl)),
    );
    scheduleSave([slidesRef.current[selected].position]);
  }
  function setFontScale(fontScale: number) {
    applyPos({ fontScale }, { commit: true });
  }
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
    setSlides((prev) =>
      prev.map((s, i) => (i === selected ? { ...s, caption: text } : s)),
    );
    if (text.trim()) scheduleSave([slidesRef.current[selected].position]);
  }
  function onCaptionBlur() {
    const cur = slidesRef.current[selected];
    if (!cur.caption.trim()) {
      const saved = savedCaptions.current.get(cur.position) ?? "";
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
      {mounted && toast &&
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

      {/* Navigation filmstrip — click through the whole slideshow */}
      <div className="no-scrollbar -mx-1 flex gap-3 overflow-x-auto px-1 pb-1">
        {slides.map((s, i) => (
          <StaticSlide
            key={s.position}
            slide={s}
            width={84}
            selected={i === selected}
            onSelect={() => setSelected(i)}
            textBg={plateFor(s)}
            dragging={dragFrom === i}
            dropTarget={dragOver === i && dragFrom !== null && dragFrom !== i}
            onDragStart={slides.length > 1 ? () => setDragFrom(i) : undefined}
            onDragEnter={() => setDragOver(i)}
            onDragEnd={() => {
              setDragFrom(null);
              setDragOver(null);
            }}
            onDrop={() => {
              if (dragFrom !== null) void reorder(dragFrom, i);
              setDragFrom(null);
              setDragOver(null);
            }}
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
          <p className="mt-3 text-center text-xs text-muted">
            Drag the caption to reposition · snaps to thirds &amp; center
          </p>
        </div>

        {/* Controls */}
        <div className="space-y-5">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">
              Slide {current.position + 1}
              <span className="ml-2 font-normal capitalize text-muted">{current.role}</span>
            </h3>
            {saveState === "error" ? (
              <span className="text-xs font-medium text-red-300">
                {error || "Save failed"}
              </span>
            ) : null}
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
            {(current.role === "reason" || current.role === "plug") &&
              current.number != null &&
              !/^\s*\d+\s*[.):]/.test(current.caption) && (
                <p className="mt-1 text-xs text-muted">
                  The “{current.number}.” number is added automatically.
                </p>
              )}
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
