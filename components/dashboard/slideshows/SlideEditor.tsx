"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ACCENT,
  layoutSlide,
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
function CaptionLayer({ layout, scale }: { layout: SlideLayout; scale: number }) {
  const shadow = `0 ${3 * scale}px ${7 * scale}px rgba(0,0,0,0.6)`;
  const anchor = layout.textAnchor;
  const translateX = anchor === "middle" ? "-50%" : anchor === "end" ? "-100%" : "0";
  const textAlign = anchor === "middle" ? "center" : anchor === "end" ? "right" : "left";

  return (
    <>
      {/* localized scrim — follows the text */}
      <div
        style={{
          position: "absolute",
          left: layout.scrim.cx * scale,
          top: layout.scrim.cy * scale,
          width: layout.scrim.rx * 2 * scale,
          height: layout.scrim.ry * 2 * scale,
          transform: "translate(-50%,-50%)",
          background:
            "radial-gradient(ellipse 50% 50% at center, rgba(0,0,0,0.72) 0%, rgba(0,0,0,0.5) 60%, rgba(0,0,0,0) 100%)",
          pointerEvents: "none",
        }}
      />

      {/* CTA pill (behind text) */}
      {layout.pill && (
        <div
          style={{
            position: "absolute",
            left: layout.pill.left * scale,
            top: layout.pill.top * scale,
            width: layout.pill.width * scale,
            height: layout.pill.height * scale,
            background: ACCENT,
            borderRadius: (layout.pill.height * scale) / 2,
            boxShadow: shadow,
            pointerEvents: "none",
          }}
        />
      )}

      {/* title accent rule */}
      {layout.rule && (
        <div
          style={{
            position: "absolute",
            left: layout.rule.left * scale,
            top: layout.rule.top * scale,
            width: layout.rule.width * scale,
            height: layout.rule.height * scale,
            background: ACCENT,
            borderRadius: (layout.rule.height * scale) / 2,
            pointerEvents: "none",
          }}
        />
      )}

      {/* number badge */}
      {layout.badge && (
        <div
          style={{
            position: "absolute",
            left: layout.badge.box.left * scale,
            top: layout.badge.box.top * scale,
            width: layout.badge.box.width * scale,
            height: layout.badge.box.height * scale,
            background: ACCENT,
            borderRadius: 28 * scale,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            boxShadow: shadow,
            pointerEvents: "none",
          }}
        >
          <span
            style={{
              color: "#fff",
              fontFamily: "var(--font-caption), sans-serif",
              fontWeight: 800,
              fontSize: layout.badge.fontSize * scale,
              lineHeight: 1,
            }}
          >
            {layout.badge.label}
          </span>
        </div>
      )}

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
    </>
  );
}

/* --------------------------- small static preview -------------------------- */
function StaticSlide({
  slide,
  width,
  selected,
  onSelect,
}: {
  slide: EditorSlide;
  width: number;
  selected: boolean;
  onSelect: () => void;
}) {
  const scale = width / SLIDE_W;
  const layout = useMemo(
    () => layoutSlide({ text: slide.caption, role: slide.role, number: slide.number, pos: slide.pos }),
    [slide.caption, slide.role, slide.number, slide.pos],
  );
  const bg = slide.bgUrl || slide.url;
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={`relative shrink-0 overflow-hidden rounded-lg border ${
        selected ? "border-accent ring-2 ring-accent/50" : "border-border hover:border-accent/50"
      }`}
      style={{ width, height: width * (SLIDE_H / SLIDE_W) }}
    >
      {bg ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={bg} alt="" className="absolute inset-0 h-full w-full object-cover" />
      ) : null}
      <CaptionLayer layout={layout} scale={scale} />
      <span className="absolute left-1 top-1 rounded bg-black/60 px-1.5 text-[10px] font-semibold text-white">
        {slide.position + 1}
      </span>
    </button>
  );
}

/* ----------------------------- editable stage ------------------------------ */
function EditableStage({
  slide,
  draggable,
  onDrag,
  onCommit,
}: {
  slide: EditorSlide;
  draggable: boolean;
  onDrag: (x: number, y: number) => void;
  onCommit: () => void;
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
    () => layoutSlide({ text: slide.caption, role: slide.role, number: slide.number, pos: slide.pos }),
    [slide.caption, slide.role, slide.number, slide.pos],
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

      {w > 0 && <CaptionLayer layout={layout} scale={scale} />}

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
}: {
  id: string;
  initialSlides: EditorSlide[];
  // Fired after a successful save so parents can refresh their baked previews
  // (filmstrip/thumbnails) — those are now composited on demand from the DB text.
  onReposition?: () => void;
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
        }));
      try {
        const res = await fetch(`/api/slideshows/${id}/reposition`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ updates }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || "Save failed.");
        // Positions saved. The composite is re-baked on demand, so just tell the
        // parent to refresh its baked previews (filmstrip/thumbnails).
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
    [id, onReposition],
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

  useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, []);

  if (!current) return null;

  return (
    <div className="mt-6">
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

      <div className="grid gap-6 lg:grid-cols-[minmax(0,360px)_1fr]">
        {/* Stage */}
        <div>
          <EditableStage
            slide={current}
            draggable={Boolean(current.bgUrl)}
            onDrag={onDrag}
            onCommit={onCommit}
          />
          <p className="mt-2 text-center text-xs text-muted">
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
            <button
              type="button"
              onClick={() => setWidth(undefined)}
              className="mt-1 text-xs text-muted underline-offset-2 hover:text-accent-text hover:underline"
            >
              Reset to auto
            </button>
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

      {/* Filmstrip */}
      <div className="no-scrollbar mt-6 flex gap-3 overflow-x-auto pb-2">
        {slides.map((s, i) => (
          <StaticSlide
            key={s.position}
            slide={s}
            width={96}
            selected={i === selected}
            onSelect={() => setSelected(i)}
          />
        ))}
      </div>
    </div>
  );
}
