"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import {
  GENERATOR_NICHES,
  GOALS,
  LAYOUTS,
  PINNED_TEMPLATES,
  SLIDE_COUNTS,
} from "@/lib/generator-options";
import { SlideEditor, type EditorSlide } from "@/components/dashboard/slideshows/SlideEditor";
import { TikTokPostButton } from "@/components/dashboard/slideshows/TikTokPostButton";
import { SaveToCameraRoll } from "@/components/dashboard/slideshows/SaveToCameraRoll";
import type { SlideRole } from "@/lib/generate/layout";
import {
  takeCollectionPick,
  type CollectionPick,
} from "@/lib/collections-selection";
import { Modal } from "@/components/ui/Modal";

type BgOption = "collection" | "single";

/** Row in the composer's "From a collection" picker (from /api/collections). */
interface ComposerCollection {
  id: string;
  name: string;
  imageCount: number;
  covers: string[];
}

interface ResultSlide {
  position: number;
  caption: string;
  role: string;
  number: number | null;
  url: string;
  bgUrl: string;
  posX: number;
  posY: number;
  align: "left" | "center" | "right";
  maxWidth: number | null;
  textBg?: boolean;
  fontScale?: number;
  body?: string | null;
}
interface ResultSlideshow {
  id: string | null;
  title: string;
  persisted: boolean;
  slides: ResultSlide[];
}

const ROLES: SlideRole[] = ["title", "reason", "plug", "cta"];
const DRAFT_KEY = "slidelabsai_draft";
const AUTO_KEY = "slidelabsai_autoGenerate";
const MAX_UPLOADS = 10;

// Narrator lines shown while a deck builds — one per real pipeline stage. The
// last line holds until the response lands (see the stage driver in Generator).
const GEN_STAGES = [
  "Reading your idea",
  "Studying what's trending",
  "Writing your hooks",
  "Finding the perfect shots",
  "Placing your captions",
  "Polishing your deck",
  "Almost there",
];

// Append a cache-buster to on-demand render-endpoint URLs so an <img> refetches
// after an edit. Leaves test-mode `data:` URLs untouched.
function bustUrl(url: string, v: number): string {
  if (url.startsWith("data:")) return url;
  return `${url}${url.includes("?") ? "&" : "?"}v=${v}`;
}

function toEditorSlides(slides: ResultSlide[]): EditorSlide[] {
  return slides.map((s) => ({
    position: s.position,
    role: ROLES.includes(s.role as SlideRole) ? (s.role as SlideRole) : "reason",
    number: s.number,
    caption: s.caption,
    body: s.body ?? "",
    url: s.url,
    bgUrl: s.bgUrl,
    pos: {
      x: s.posX,
      y: s.posY,
      align: s.align,
      maxWidth: s.maxWidth ?? undefined,
      fontScale: s.fontScale ?? 1,
    },
    textBg: s.textBg === true,
  }));
}

// GOALS lives in lib/generator-options.ts (shared with the /api/suggest planner).

/* ── AI-decide suggestion shape (from /api/suggest) ────────────────────────── */
interface AiSuggestion {
  niche: string;
  slides: number;
  layout: string;
  goal: string;
  angle: string;
  prompt: string;
  rationale: string;
}
const MAX_SUGGESTIONS = 3; // matches /api/suggest MAX_ROUNDS

// Uploads are downscaled in the browser before they ever hit the wire: 10
// full-res phone photos blow past Vercel's ~4.5MB body limit, and they now feed
// TWO endpoints (/api/suggest and /api/generate). 1280px long edge is far more
// detail than either the vision model or a 1080x1920 slide needs.
const UPLOAD_MAX_EDGE = 1280;
const UPLOAD_QUALITY = 0.82;

function downscaleImage(file: File): Promise<string | null> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onerror = () => resolve(null);
    reader.onload = () => {
      const dataUrl = (reader.result as string) || null;
      if (!dataUrl) return resolve(null);
      const img = new Image();
      // Any decode failure (HEIC, corrupt file) falls back to the original.
      img.onerror = () => resolve(dataUrl);
      img.onload = () => {
        let { width, height } = img;
        if (!width || !height) return resolve(dataUrl);
        const longest = Math.max(width, height);
        if (longest > UPLOAD_MAX_EDGE) {
          const scale = UPLOAD_MAX_EDGE / longest;
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
          resolve(canvas.toDataURL("image/jpeg", UPLOAD_QUALITY));
        } catch {
          resolve(dataUrl);
        }
      };
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
  });
}

/* ── Custom dropdown select ────────────────────────────────────────────────── */

function DropdownSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  // Panel is portalled to <body> (the settings row scrolls horizontally and
  // would clip an absolutely-positioned child), so it's placed off the
  // trigger's viewport rect and repositioned on scroll/resize.
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;
    function place() {
      const r = containerRef.current?.getBoundingClientRect();
      if (!r) return;
      // Flip above the trigger when there's no room below (e.g. the Source
      // pill in the footer).
      const estH = options.length * 42 + 10;
      const top =
        r.bottom + 6 + estH > window.innerHeight && r.top - estH - 6 > 0
          ? r.top - estH - 6
          : r.bottom + 6;
      setPos({ top, left: r.left });
    }
    place();
    function onDown(e: MouseEvent) {
      const t = e.target as Node;
      if (containerRef.current?.contains(t) || panelRef.current?.contains(t)) return;
      setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open]);

  const selectedLabel = options.find((o) => o.value === value)?.label ?? value;

  return (
    <div ref={containerRef} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 whitespace-nowrap rounded-full border border-white/10 px-3 py-2 transition-colors hover:border-white/25"
      >
        <span className="select-none text-[13px] text-white/40">{label}</span>
        <span className="text-[13px] font-semibold text-white">{selectedLabel}</span>
        <svg
          className={`text-white/30 transition-transform duration-150 ${open ? "rotate-180" : ""}`}
          width="10" height="10" viewBox="0 0 24 24"
          fill="none" stroke="currentColor" strokeWidth="2.5"
          strokeLinecap="round" strokeLinejoin="round" aria-hidden
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {open && mounted && pos && createPortal(
        <div
          ref={panelRef}
          style={{ position: "fixed", top: pos.top, left: pos.left }}
          className="animate-dropdown-in z-[90] min-w-45 overflow-hidden rounded-xl border border-white/8 bg-[#1a1a1c] shadow-2xl shadow-black/60"
        >
          {options.map((o) => (
            <button
              key={o.value}
              type="button"
              onClick={() => { onChange(o.value); setOpen(false); }}
              className={`flex w-full items-center justify-between px-4 py-2.5 text-sm transition-colors hover:bg-white/6 ${
                value === o.value ? "text-white" : "text-white/50"
              }`}
            >
              <span className={value === o.value ? "font-medium" : ""}>{o.label}</span>
              {value === o.value && (
                <svg
                  width="13" height="13" viewBox="0 0 24 24"
                  fill="none" stroke="currentColor" strokeWidth="2.5"
                  strokeLinecap="round" strokeLinejoin="round"
                  className="text-accent" aria-hidden
                >
                  <path d="M20 6L9 17l-5-5" />
                </svg>
              )}
            </button>
          ))}
        </div>,
        document.body,
      )}
    </div>
  );
}

/* ── Phone settings sheet pieces ───────────────────────────────────────────── */

function SheetGroup({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-5 last:mb-0">
      <h3 className="mb-1.5 px-4 text-[12px] font-medium text-white/35">{title}</h3>
      <div className="overflow-hidden rounded-2xl bg-[#1e1e21]">{children}</div>
    </section>
  );
}

// One full-width row with a trailing check — long option labels stay on one
// line instead of wrapping into a chip pile.
function SheetRow({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className="flex w-full items-center justify-between gap-3 px-4 py-3.5 text-left text-[15px] text-white transition-colors active:bg-white/6 [&:not(:last-child)]:border-b [&:not(:last-child)]:border-white/6"
    >
      <span className="min-w-0 truncate">{children}</span>
      {active && (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="shrink-0 text-accent-text">
          <path d="M20 6L9 17l-5-5" />
        </svg>
      )}
    </button>
  );
}

/* ── Auth gate overlay ─────────────────────────────────────────────────────── */

function AuthGate({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-[#0d0d0d] p-8 text-center shadow-2xl">
        <div className="text-2xl font-bold tracking-tight text-white">Almost there</div>
        <p className="mt-2 text-sm text-white/40">
          Create a free account to generate your slideshow. Your idea has been saved.
        </p>
        <div className="mt-7 flex flex-col gap-2">
          <Link
            href="/signup?return_to=/dashboard"
            className="block w-full rounded-full bg-white py-2.5 text-sm font-semibold text-black transition-opacity hover:opacity-90"
          >
            Create free account
          </Link>
          <Link
            href="/login?return_to=/dashboard"
            className="block w-full rounded-full border border-white/10 bg-white/5 py-2.5 text-sm font-medium text-white/70 transition-colors hover:bg-white/10"
          >
            Sign in
          </Link>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="mt-5 text-xs text-white/25 transition-colors hover:text-white/60"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

/* ── Main component ────────────────────────────────────────────────────────── */

export function Generator({
  isConnected = false,
  isLoggedIn = false,
}: {
  isConnected?: boolean;
  isLoggedIn?: boolean;
}) {
  // Niche is no longer a user choice — the server derives it from the prompt
  // (lib/generate/nicheDetect.ts). "Let AI decide" still picks one explicitly
  // and passes it through the generate override.
  const [layout, setLayout] = useState(LAYOUTS[0].value);
  const [slides, setSlides] = useState("6");
  const [prompt, setPrompt] = useState("");
  // "single" = Upload (the user's own photos, via the + attach); "collection" =
  // stock photos the app finds. Upload is the default.
  const [bg, setBg] = useState<BgOption>("single");
  // Composer redesign: post goal + optional user photos (used for the first
  // slides; the library fills the rest).
  const [goal, setGoal] = useState("Grow followers");
  const [userImages, setUserImages] = useState<string[]>([]);
  // Inline feedback when an upload is rejected for hitting the 10-photo cap.
  const [uploadNote, setUploadNote] = useState("");
  const userFileRef = useRef<HTMLInputElement>(null);
  const anyFileRef = useRef<HTMLInputElement>(null);
  // Little "+" attach menu (Photos / Files / Collection) in the composer.
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const addMenuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!addMenuOpen) return;
    function onDown(e: MouseEvent) {
      if (addMenuRef.current && !addMenuRef.current.contains(e.target as Node)) {
        setAddMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [addMenuOpen]);

  // "From a collection" picker — a portalled Modal, NOT a panel anchored in
  // the attach strip: with nothing staged that strip is display:none on
  // phones (the footer button stands in for it), which would hide an anchored
  // panel with it. The list is fetched fresh on every open — collections
  // change on another page, so a cached list would show stale counts.
  const [collPickerOpen, setCollPickerOpen] = useState(false);
  const [collList, setCollList] = useState<ComposerCollection[] | null>(null);
  const [collError, setCollError] = useState("");
  const [collLoadingId, setCollLoadingId] = useState<string | null>(null);

  const [genStatus, setGenStatus] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [result, setResult] = useState<ResultSlideshow[] | null>(null);
  const [errorMsg, setErrorMsg] = useState("");
  // Bumped after a caption reposition so the on-demand baked filmstrip previews
  // refetch (appended as a cache-buster to the render-endpoint URLs).
  const [editBump, setEditBump] = useState(0);
  const [showAuthGate, setShowAuthGate] = useState(false);
  const [restoredFromDraft, setRestoredFromDraft] = useState(false);
  // Photos selected from one of the user's collections (see lib/collections-
  // selection). Sent as ids, not base64 — the bytes are already in Storage.
  const [pick, setPick] = useState<CollectionPick | null>(null);
  // "Remix this trend" hand-off: the trend's format recipe rides along with
  // /api/generate so the deck mirrors the trend's mechanic slide-by-slide.
  // Cleared when the prompt is emptied or an assist hook replaces it.
  const [remixFormat, setRemixFormat] = useState<Record<string, unknown> | null>(null);
  // "Let AI decide" — the frictionless mode. Config pills are hidden; the user
  // just drops in photos (+ an optional direction) and /api/suggest proposes ONE
  // concrete plan (niche/angle/slides/layout/goal). They approve it (→ the
  // unchanged /api/generate) or nudge it, capped at MAX_SUGGESTIONS per build.
  const [aiMode, setAiMode] = useState(false);
  // Supercharge — the judge-LLM pass over the finished draft. A stronger model
  // reviews captions + the chosen images and fixes what's weak. Mutually
  // exclusive with aiMode (the toggles clear each other); unlike aiMode it keeps
  // the config pills. superStage reflects the live pipeline step streamed back
  // from /api/generate while it runs.
  const [supercharge, setSupercharge] = useState(false);
  const [superStage, setSuperStage] = useState<{ stage: string; label: string } | null>(null);
  const SUPER_STAGE_LABELS: Record<string, string> = {
    generating: "Thinking",
    illustrating: "Sourcing images",
    judging: "Judging",
    revising: "Revising",
    finalizing: "Finalizing",
  };
  // Phone-only settings sheet, behind the one-line summary.
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Tooltip over the generate arrow when it's blocked on missing photos.
  const [photoHint, setPhotoHint] = useState(false);
  const [suggestLoading, setSuggestLoading] = useState(false);
  const [suggestError, setSuggestError] = useState("");
  // The planner pitches several directions at once; `suggestion` is whichever
  // one the user has highlighted (defaults to the first / best).
  const [aiOptions, setAiOptions] = useState<AiSuggestion[]>([]);
  const [pickedIndex, setPickedIndex] = useState(0);
  const suggestion = aiOptions[pickedIndex] ?? null;
  // Count of suggestions made this build (0-based round sent to the server).
  const [suggestRound, setSuggestRound] = useState(0);
  const [refineText, setRefineText] = useState("");
  const [isFocused, setIsFocused] = useState(false);
  const [animText, setAnimText] = useState("");
  const animRef = useRef<{
    phase: "typing" | "pausing" | "deleting";
    idx: number;
    charIdx: number;
    timer: ReturnType<typeof setTimeout> | null;
  }>({ phase: "typing", idx: 0, charIdx: 0, timer: null });

  const promptRef = useRef<HTMLTextAreaElement>(null);

  const [suggestions, setSuggestions] = useState<string[]>([]);
  // A varied cross-niche pool of hooks — niche is no longer selected, so the
  // "Try:" chips just rotate through proven templates.
  useEffect(() => {
    setSuggestions(
      [...PINNED_TEMPLATES].sort(() => Math.random() - 0.5).slice(0, 3),
    );
  }, []);

  // The Try pill shows ONE suggestion at a time (three full hooks in a row
  // was a wall of words) and cycles through the pool; clicking opens the
  // full list to pick from. Rotation pauses while the list is open so the
  // text doesn't move under a decision.
  const [tryIdx, setTryIdx] = useState(0);
  const [tryOpen, setTryOpen] = useState(false);
  const tryRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (suggestions.length < 2 || tryOpen) return;
    const t = setInterval(
      () => setTryIdx((i) => (i + 1) % suggestions.length),
      3500,
    );
    return () => clearInterval(t);
  }, [suggestions, tryOpen]);
  useEffect(() => {
    if (!tryOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!tryRef.current?.contains(e.target as Node)) setTryOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [tryOpen]);

  // Auto-grow the hook textarea to its content (it has no fixed row count and
  // `overflow-hidden`, so it must be measured after every change).
  useEffect(() => {
    const el = promptRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [prompt]);

  // Animated placeholder — types/deletes cycling through suggestions
  useEffect(() => {
    const s = animRef.current;
    if (s.timer) clearTimeout(s.timer);
    if (!suggestions.length) return;
    s.idx = 0;
    s.charIdx = 0;
    s.phase = "typing";
    setAnimText("");
    const pool = suggestions;
    function tick() {
      const st = animRef.current;
      const target = pool[st.idx % pool.length];
      if (st.phase === "typing") {
        st.charIdx = Math.min(st.charIdx + 1, target.length);
        setAnimText(target.slice(0, st.charIdx));
        st.timer = st.charIdx >= target.length
          ? setTimeout(() => { st.phase = "pausing"; tick(); }, 2200)
          : setTimeout(tick, 46);
      } else if (st.phase === "pausing") {
        st.phase = "deleting";
        st.timer = setTimeout(tick, 30);
      } else {
        st.charIdx = Math.max(st.charIdx - 1, 0);
        setAnimText(target.slice(0, st.charIdx));
        if (st.charIdx <= 0) {
          st.idx++;
          st.phase = "typing";
          st.timer = setTimeout(tick, 320);
        } else {
          st.timer = setTimeout(tick, 24);
        }
      }
    }
    s.timer = setTimeout(tick, 700);
    return () => {
      const st = animRef.current;
      if (st.timer) { clearTimeout(st.timer); st.timer = null; }
    };
  }, [suggestions]);

  useEffect(() => {
    if (!isLoggedIn) return;
    try {
      const saved = localStorage.getItem(DRAFT_KEY);
      if (!saved) return;
      const state = JSON.parse(saved) as Record<string, unknown>;
      if (typeof state.prompt === "string" && state.prompt) setPrompt(state.prompt);
      if (typeof state.slides === "string" && state.slides) setSlides(state.slides);
      if (typeof state.layout === "string" && state.layout) setLayout(state.layout);
      if (typeof state.bg === "string" && state.bg) setBg(state.bg as BgOption);
      if (typeof state.goal === "string" && state.goal) setGoal(state.goal);
      if (state.format && typeof state.format === "object") {
        setRemixFormat(state.format as Record<string, unknown>);
      }
      localStorage.removeItem(DRAFT_KEY);
      localStorage.removeItem(AUTO_KEY);
      setRestoredFromDraft(true);
    } catch {}
  }, [isLoggedIn]);

  // Photos chosen over on /dashboard/collections. Consumed in the same effect
  // style as the draft above (one-shot, cleared on read) so arriving here from
  // "Use in a slideshow" lands with the picks already staged.
  useEffect(() => {
    if (!isLoggedIn) return;
    let cancelled = false;
    // Applied in a microtask rather than straight in the effect body: a
    // synchronous setState there cascades an extra render (React Compiler
    // rejects it), and reading sessionStorage during render would desync
    // hydration since the server has none.
    void Promise.resolve().then(() => {
      if (cancelled) return;
      const picked = takeCollectionPick();
      if (!picked) return;
      setPick(picked);
      // A collection pick IS "my photos" — keep the source in agreement so the
      // arrow isn't stuck in the blocked "no photos staged" state.
      setBg("single");
    });
    return () => {
      cancelled = true;
    };
  }, [isLoggedIn]);

  // Clears any live AI suggestion + resets the per-build round counter. Called
  // when the inputs behind a suggestion change enough that it's stale.
  function resetSuggestion(resetRound = true) {
    setAiOptions([]);
    setPickedIndex(0);
    setSuggestError("");
    setRefineText("");
    if (resetRound) setSuggestRound(0);
  }

  // "Let AI decide": ask /api/suggest for a plan. `nudge` (from the refine box)
  // rides along as a change request; the prior plan is sent as `previous` so the
  // model adjusts rather than starts over. Capped at MAX_SUGGESTIONS server-side.
  async function handleSuggest(nudge?: string) {
    if (!isLoggedIn) {
      setShowAuthGate(true);
      return;
    }
    if (suggestLoading) return;
    const source: "upload" | "stock" = bg === "single" ? "upload" : "stock";
    // Mirror the button's disable rules (defensive — never fire a hopeless call).
    if (source === "upload" && userImages.length === 0) return;
    if (source === "stock" && !prompt.trim() && !nudge?.trim()) return;

    setSuggestLoading(true);
    setSuggestError("");
    try {
      const trimmedNudge = nudge?.trim();
      const promptForCall = trimmedNudge
        ? `${prompt.trim()}${prompt.trim() ? "\n\n" : ""}Change requested: ${trimmedNudge}`
        : prompt;
      const res = await fetch("/api/suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: promptForCall,
          images: source === "upload" ? userImages : undefined,
          source,
          round: suggestRound,
          previous: suggestion
            ? {
                niche: suggestion.niche,
                angle: suggestion.angle,
                slides: suggestion.slides,
                goal: suggestion.goal,
                prompt: suggestion.prompt,
              }
            : undefined,
        }),
      });
      // Read text first — a 413/proxy error returns plain text (the old
      // `Unexpected token 'R'` trap).
      const raw = await res.text();
      let data: {
        options?: AiSuggestion[];
        suggestion?: AiSuggestion;
        error?: string;
      };
      try {
        data = JSON.parse(raw) as typeof data;
      } catch {
        throw new Error(
          res.status === 413
            ? "Those photos are too large — try fewer or smaller images."
            : "Something went wrong — try again.",
        );
      }
      // Prefer the multi-option payload; fall back to a lone `suggestion`.
      const options =
        data.options?.length ? data.options : data.suggestion ? [data.suggestion] : [];
      if (!res.ok || options.length === 0) {
        throw new Error(data.error || "Couldn't come up with a direction — try again.");
      }
      setAiOptions(options);
      setPickedIndex(0);
      setSuggestRound((r) => r + 1);
      setRefineText("");
    } catch (e) {
      setSuggestError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setSuggestLoading(false);
    }
  }

  // Approve the AI plan → generate with its exact config (passed as an override
  // so there's no set-state-then-generate race).
  function approveSuggestion() {
    if (!suggestion) return;
    void handleGenerate(
      {
        niche: suggestion.niche,
        slides: String(suggestion.slides),
        layout: suggestion.layout,
        goal: suggestion.goal,
        prompt: suggestion.prompt,
      },
      // Provenance for the local diagnostics dump: what the USER typed vs what
      // the planner decided, so a bad deck can be blamed on the right step.
      {
        userPrompt: prompt.trim(),
        angle: suggestion.angle,
        rationale: suggestion.rationale,
        suggestions: suggestRound,
        niche: suggestion.niche,
        slides: suggestion.slides,
        layout: suggestion.layout,
        goal: suggestion.goal,
      },
    );
  }

  // `override` carries the AI-decide plan straight through (the config pills are
  // hidden in that mode, so state would be stale). Everything else — the payload
  // shape and /api/generate itself — is unchanged.
  async function handleGenerate(
    override?: {
      // Only "Let AI decide" sets a niche (its planner picked one). Manual mode
      // omits it and the server derives the niche from the prompt.
      niche?: string;
      slides: string;
      layout: string;
      goal: string;
      prompt: string;
    },
    // Diagnostics-only provenance for "Let AI decide" runs (local dumps).
    aiPlan?: Record<string, unknown>,
  ) {
    const eff = {
      slides: override?.slides ?? slides,
      layout: override?.layout ?? layout,
      goal: override?.goal ?? goal,
      prompt: override?.prompt ?? prompt,
    };
    // Explicit niche slug (AI-decide only). Undefined → server auto-detects.
    const nicheSlug = override?.niche;
    const nicheLabel = nicheSlug
      ? (GENERATOR_NICHES.find((n) => n.value === nicheSlug)?.label ?? nicheSlug)
          .replace(/^[^\p{L}]+/u, "")
          .trim()
      : undefined;

    if (!isLoggedIn) {
      try {
        localStorage.setItem(
          DRAFT_KEY,
          JSON.stringify({ ...eff, bg, format: remixFormat ?? undefined }),
        );
        localStorage.setItem(AUTO_KEY, "true");
      } catch {}
      setShowAuthGate(true);
      return;
    }

    setGenStatus("loading");
    setErrorMsg("");
    setResult(null);
    setSuperStage(null);
    setRestoredFromDraft(false);
    // Restart the loading narrator here rather than in its effect — a
    // synchronous setState in an effect body cascades an extra render.
    setStageIdx(0);

    try {
      const payload = JSON.stringify({
        // Both undefined in manual mode → /api/generate derives the niche from
        // the prompt (lib/generate/nicheDetect.ts).
        niche: nicheLabel,
        layout: eff.layout,
        slideCount: Number(eff.slides),
        slideshowCount: 1,
        prompt: eff.goal
          ? `${eff.prompt}\n\nGoal of this post: ${eff.goal}.`.trim()
          : eff.prompt,
        backgroundMode: bg,
        // AI-decide passes its chosen niche slug (doubles as the image
        // collection id); manual omits it so the server infers it.
        collection: nicheSlug,
        userImages: userImages.length ? userImages : undefined,
        // Ids, not bytes. The server reads these from the collections bucket,
        // which is what keeps a big pick from hitting the request-body limit.
        collectionImageIds: pick
          ? pick.imageIds.slice(0, MAX_UPLOADS)
          : undefined,
        // "Remix this trend" carries the trend's format recipe through.
        format: remixFormat ?? undefined,
        // Diagnostics only — never reaches the model (see /api/generate).
        aiPlan,
        // Supercharge: run the judge pass + stream stage events back.
        supercharge,
      });

      const mb = payload.length / 1024 / 1024;
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: payload,
      });

      const ctype = res.headers.get("content-type") ?? "";

      // Supercharge streams NDJSON: {type:"stage"} events as the pipeline runs,
      // then a final {type:"result"} or {type:"error"} line. A billing block
      // still returns plain JSON even in Supercharge mode, so branch on the
      // content-type — not on `supercharge` alone — and let the JSON path below
      // handle those.
      if (supercharge && ctype.includes("ndjson") && res.body) {
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let sbuf = "";
        let gotResult = false;
        try {
          for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            sbuf += decoder.decode(value, { stream: true });
            let nl: number;
            while ((nl = sbuf.indexOf("\n")) >= 0) {
              const line = sbuf.slice(0, nl).trim();
              sbuf = sbuf.slice(nl + 1);
              if (!line) continue;
              let evt: {
                type?: string;
                stage?: string;
                label?: string;
                slideshows?: ResultSlideshow[];
                error?: string;
              };
              try {
                evt = JSON.parse(line);
              } catch {
                continue;
              }
              if (evt.type === "stage") {
                setSuperStage({
                  stage: evt.stage ?? "",
                  label:
                    evt.label ||
                    SUPER_STAGE_LABELS[evt.stage ?? ""] ||
                    "Working",
                });
              } else if (evt.type === "result") {
                setResult(evt.slideshows ?? []);
                setGenStatus("done");
                gotResult = true;
              } else if (evt.type === "error") {
                throw new Error(evt.error || "Generation failed.");
              }
            }
          }
          if (!gotResult) {
            throw new Error("The generation stream ended early. Please try again.");
          }
        } finally {
          setSuperStage(null);
        }
        return;
      }

      // Read as text first: a 413/proxy error returns plain text, and calling
      // res.json() on it is what produced `Unexpected token 'R'`.
      const raw = await res.text();

      let data: { slideshows?: ResultSlideshow[]; error?: string };
      try {
        data = JSON.parse(raw) as { slideshows?: ResultSlideshow[]; error?: string };
      } catch {
        throw new Error(
          res.status === 413
            ? `Those photos are too large to upload (${mb.toFixed(1)}MB). Try fewer or smaller images.`
            : `Server returned ${res.status} (${ctype || "unknown type"}): ${raw.slice(0, 120)}`,
        );
      }
      if (!res.ok) throw new Error(data?.error || "Generation failed.");
      setResult(data.slideshows ?? []);
      setGenStatus("done");
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "Generation failed.");
      setGenStatus("error");
    }
  }

  async function downloadImage(url: string, name: string) {
    const res = await fetch(url);
    const blob = await res.blob();
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = objectUrl;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(objectUrl);
  }

  // Uploads: read picked/dropped files as data URLs, hard-capped at MAX_UPLOADS.
  // Extras are rejected with visible feedback instead of being silently dropped.
  function addUserFiles(fileList: FileList | null) {
    if (!fileList) return;
    const images = Array.from(fileList).filter((f) =>
      f.type.startsWith("image/"),
    );
    if (images.length === 0) return;

    const room = MAX_UPLOADS - userImages.length;
    if (room <= 0) {
      setUploadNote(`${MAX_UPLOADS} photos max — remove one to add another.`);
      return;
    }
    const accepted = images.slice(0, room);
    setUploadNote(
      images.length > room
        ? `Added ${room} — ${MAX_UPLOADS} photos max.`
        : "",
    );

    // Read ALL files before appending. Reading them individually and appending
    // from each onload made the final order a race (the same photos landed at
    // different indices every run), so the user's chosen order was never kept.
    void Promise.all(accepted.map(downscaleImage)).then((results) => {
      const srcs = results.filter((s): s is string => Boolean(s));
      if (srcs.length) {
        setUserImages((cur) => [...cur, ...srcs].slice(0, MAX_UPLOADS));
        // Last action wins: the server prefers a collection pick over inline
        // uploads, so keeping a stale pick staged would silently ignore the
        // photos the user just added.
        setPick(null);
        // A new photo set makes any existing AI plan stale (keep the round
        // count — the 3-suggestion cap is per build, not per photo set).
        resetSuggestion(false);
      }
    });
  }

  // ── "From a collection" (the + menu) ─────────────────────────────────
  function openCollectionPicker() {
    setAddMenuOpen(false);
    setCollPickerOpen(true);
    setCollError("");
    setCollList(null);
    void fetch("/api/collections")
      .then(async (res) => {
        const data = (await res.json()) as {
          collections?: ComposerCollection[];
          error?: string;
        };
        if (!res.ok) throw new Error(data.error || "Could not load collections.");
        setCollList(data.collections ?? []);
      })
      .catch((e: unknown) => {
        setCollError(
          e instanceof Error ? e.message : "Could not load collections.",
        );
        setCollList([]);
      });
  }

  async function chooseCollection(c: ComposerCollection) {
    if (c.imageCount === 0 || collLoadingId) return;
    setCollLoadingId(c.id);
    setCollError("");
    try {
      const res = await fetch(`/api/collections/${c.id}`);
      const data = (await res.json()) as {
        collection?: { name?: string };
        images?: { id: string; url: string }[];
        error?: string;
      };
      const imgs = data.images ?? [];
      if (!res.ok || imgs.length === 0) {
        throw new Error(data.error || "That collection has no photos.");
      }
      // Stage the whole collection, in its saved order. The banner above the
      // composer shows the thumbs, warns past MAX_UPLOADS, and has Clear; the
      // Collections page stays the place for cherry-picking specific photos.
      setPick({
        collectionId: c.id,
        collectionName: data.collection?.name ?? c.name,
        imageIds: imgs.map((i) => i.id),
        thumbs: imgs.map((i) => i.url),
      });
      setBg("single");
      // Mirror of the rule in addUserFiles — the pick replaces inline uploads
      // server-side, so leaving them staged would show photos that won't run.
      setUserImages([]);
      setUploadNote("");
      resetSuggestion(false);
      setCollPickerOpen(false);
    } catch (e) {
      setCollError(
        e instanceof Error ? e.message : "Could not load that collection.",
      );
    } finally {
      setCollLoadingId(null);
    }
  }

  const isLoading = genStatus === "loading";
  // Both the real generation and the AI-plan step drive the button's breathing
  // state; only real generation shows the big skeleton filmstrip below.
  const working = isLoading || suggestLoading;

  // ── Generation stage narrator ────────────────────────────────────────
  // /api/generate isn't streamed, so we time-drive a narrator through the real
  // pipeline stages (weighted to their rough cost) and hold on the last line
  // until the response lands. The work genuinely takes this long — this just
  // makes the multi-second build legible instead of a silent grey wheel.
  const [stageIdx, setStageIdx] = useState(0);
  useEffect(() => {
    if (!isLoading) return;
    // NOTE: the reset to stage 0 happens in handleGenerate, not here — setting
    // state synchronously in an effect body triggers a cascading render.
    // ms spent on each stage; the final "Almost there" stage has no timer so it
    // holds until the fetch resolves (however long that takes).
    const steps = [900, 2600, 3200, 5200, 3200, 2600];
    const timers: ReturnType<typeof setTimeout>[] = [];
    let acc = 0;
    steps.forEach((d, i) => {
      acc += d;
      timers.push(setTimeout(() => setStageIdx(i + 1), acc));
    });
    return () => timers.forEach(clearTimeout);
  }, [isLoading]);

  // Upload source with nothing staged: the one blocked state the user can fix
  // in one click, so the arrow points at the fix instead of going dead.
  // A collection pick counts as staged photos — without this the arrow would
  // sit blocked on "add photos" while the picks are visibly right there.
  const pickCount = Math.min(pick?.imageIds.length ?? 0, MAX_UPLOADS);
  const needsPhotos =
    bg === "single" && userImages.length === 0 && pickCount === 0;

  // Input-level reasons the Generate arrow is inert (missing prompt / out of
  // AI suggestions). Kept separate from `working` so the button can stay bright
  // and breathing while it works, but dim when there's nothing to run.
  const genBlocked =
    (!aiMode && !prompt.trim()) ||
    (aiMode && bg === "collection" && !prompt.trim()) ||
    (aiMode && suggestRound >= MAX_SUGGESTIONS);

  // Shared by the desktop footer toggle and the phone link under the box.
  function toggleSource() {
    setBg(bg === "single" ? "collection" : "single");
    // Switching source discards staged uploads so they don't silently ride
    // along into a stock-photo generation.
    setUserImages([]);
    setUploadNote("");
    // The AI plan was built from the old source — start fresh.
    resetSuggestion();
  }

  // On Upload the photos decide the deck size (the server enforces one slide
  // per photo), so the count is derived, not chosen. Non-null = derived.
  const derivedSlides =
    bg === "single" && pickCount > 0
      ? pickCount
      : bg === "single" && userImages.length > 0
        ? userImages.length
        : null;

  // How many skeleton cards to show while building — the real deck size when we
  // know it (uploads / chosen count), clamped to a sane 3–10.
  const rawCount = derivedSlides ?? Number(slides);
  const skeletonCount =
    Number.isFinite(rawCount) && rawCount > 0
      ? Math.min(Math.max(rawCount, 3), 10)
      : 6;
  // Creeping determinate fill, driven by the narrator stage; caps below 100 so
  // it never claims "done" before the deck actually lands.
  const genPct = Math.min(10 + stageIdx * 14, 94);

  return (
    <>
      {showAuthGate && <AuthGate onClose={() => setShowAuthGate(false)} />}

      {/* ── "Use a collection" picker (from the + menu / phone footer) ── */}
      <Modal
        open={collPickerOpen}
        onClose={() => setCollPickerOpen(false)}
        title="Use a collection"
        width="max-w-sm"
      >
        <div className="-mx-2 max-h-80 overflow-y-auto">
          {collList === null ? (
            <p className="px-2 py-3 text-sm text-white/40">Loading…</p>
          ) : collError ? (
            <p className="px-2 py-3 text-sm text-red-400">{collError}</p>
          ) : collList.length === 0 ? (
            <div className="px-2 py-3">
              <p className="text-sm text-white/50">No collections yet.</p>
              <Link
                href="/dashboard/collections"
                className="mt-1 inline-block text-sm font-semibold text-accent-text hover:underline"
              >
                Create one →
              </Link>
            </div>
          ) : (
            collList.map((c) => (
              <button
                key={c.id}
                type="button"
                disabled={c.imageCount === 0 || !!collLoadingId}
                onClick={() => void chooseCollection(c)}
                className="flex w-full items-center gap-3 rounded-xl px-2 py-2.5 text-left transition-colors hover:bg-white/6 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {c.covers[0] ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={c.covers[0]}
                    alt=""
                    className="h-10 w-10 shrink-0 rounded-lg object-cover ring-1 ring-white/10"
                  />
                ) : (
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-white/[0.06]">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="text-white/30" aria-hidden>
                      <rect x="3" y="3" width="18" height="18" rx="3" />
                      <circle cx="9" cy="9" r="2" />
                      <path d="m21 15-3.5-3.5L6 23" />
                    </svg>
                  </span>
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-white">
                    {c.name}
                  </span>
                  <span className="block text-xs text-white/35">
                    {collLoadingId === c.id
                      ? "Loading photos…"
                      : c.imageCount === 0
                        ? "Empty"
                        : `${c.imageCount} photo${c.imageCount === 1 ? "" : "s"}`}
                  </span>
                </span>
              </button>
            ))
          )}
        </div>
      </Modal>

      {/* ── Phone settings sheet ─────────────────────────────────────
             The three pills, one screen, one tap each. Only reachable from
             the summary line below `sm`. */}
      {settingsOpen && (
        <div className="fixed inset-0 z-[60] sm:hidden">
          <button
            type="button"
            aria-label="Close settings"
            onClick={() => setSettingsOpen(false)}
            className="absolute inset-0 cursor-default bg-black/60"
          />
          <div className="animate-sheet-in absolute inset-x-0 bottom-0 max-h-[82vh] overflow-y-auto rounded-t-[28px] bg-[#161618] px-4 pb-9 pt-2.5">
            {/* Grab handle — the phone convention that tells you this thing
                came up from the bottom. */}
            <div aria-hidden className="mx-auto mb-3 h-1 w-9 rounded-full bg-white/20" />
            <div className="mb-4 flex items-center justify-between px-1">
              <h2 className="text-[15px] font-semibold text-white">Settings</h2>
              <button
                type="button"
                onClick={() => setSettingsOpen(false)}
                className="text-[15px] font-semibold text-accent-text"
              >
                Done
              </button>
            </div>

            {/* Supercharge lives here on phones. As a bare bolt in the footer
                cluster it read as a fifth mystery icon next to attach/collection
                /AI/send; here it's a named switch with its one line of
                explanation, like every other setting. First in the sheet on
                purpose — it's the one setting that changes how good the deck
                is, and the rest have defaults nobody needs to touch. */}
            <SheetGroup title="Quality">
              <button
                type="button"
                role="switch"
                aria-checked={supercharge}
                onClick={() => {
                  setSupercharge((v) => !v);
                  setAiMode(false);
                  resetSuggestion();
                }}
                className={`flex w-full items-center justify-between gap-3 px-4 py-3.5 text-left transition-colors ${
                  supercharge ? "sc-row-on" : "active:bg-white/6"
                }`}
              >
                <span className="flex min-w-0 items-center gap-3">
                  {/* One-shot shockwave on the tile, steady glow after — the
                      infinite pulse lives nowhere on this row; the sustained
                      state is the row's aurora + orbiting ring instead. */}
                  <span
                    aria-hidden
                    className={`grid h-8 w-8 shrink-0 place-items-center rounded-full transition-colors ${
                      supercharge
                        ? "sc-tile-on bg-accent/30 text-accent-text"
                        : "bg-white/[0.07] text-white/50"
                    }`}
                  >
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" className="sc-bolt">
                      <path d="M13 2 4.5 12.5a1 1 0 0 0 .8 1.6H11l-1 8 8.5-10.6a1 1 0 0 0-.8-1.6H12l1-8z" />
                    </svg>
                  </span>
                  <span className="min-w-0">
                    <span className="block text-[15px] text-white">Supercharge</span>
                    <span className="mt-0.5 block text-[12px] leading-snug text-white/40">
                      A stronger model reviews the draft and fixes what&apos;s weak.
                    </span>
                  </span>
                </span>
                <span
                  aria-hidden
                  className={`relative h-6 w-11 shrink-0 rounded-full transition-colors duration-200 ${
                    supercharge ? "bg-accent" : "bg-white/15"
                  }`}
                >
                  <span
                    className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform duration-200 ${
                      supercharge ? "translate-x-5" : "translate-x-0"
                    }`}
                  />
                </span>
              </button>
            </SheetGroup>

            {/* Grouped rows, iOS-style: one tap, a check on the chosen row.
                Wrapped chips made long labels ("Title slide + captions") break
                mid-row and read as a ransom note. */}
            <SheetGroup title="Slides">
              {derivedSlides !== null ? (
                <p className="px-4 py-3.5 text-[15px] text-white/40">
                  {derivedSlides} — one per photo you added
                </p>
              ) : (
                <div className="grid grid-cols-4 gap-px overflow-hidden bg-white/6">
                  {SLIDE_COUNTS.map((n) => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => setSlides(String(n))}
                      aria-pressed={slides === String(n)}
                      className={`py-3.5 text-[15px] transition-colors ${
                        slides === String(n)
                          ? "bg-accent/25 font-semibold text-white"
                          : "bg-[#1e1e21] text-white/70 active:bg-[#26262a]"
                      }`}
                    >
                      {n}
                    </button>
                  ))}
                </div>
              )}
            </SheetGroup>

            <SheetGroup title="Layout">
              {LAYOUTS.map((l) => (
                <SheetRow
                  key={l.value}
                  active={layout === l.value}
                  onClick={() => setLayout(l.value)}
                >
                  {l.label}
                </SheetRow>
              ))}
            </SheetGroup>

            <SheetGroup title="Goal">
              {GOALS.map((g) => (
                <SheetRow key={g} active={goal === g} onClick={() => setGoal(g)}>
                  {g}
                </SheetRow>
              ))}
            </SheetGroup>

          </div>
        </div>
      )}

      {/* ── Hero heading ─────────────────────────────────────────── */}
      <div className="mb-6 text-center">
        <h1 className="text-4xl font-bold tracking-tighter text-white sm:text-5xl">
          What will you post{" "}
          <em style={{ fontFamily: "var(--font-display)", fontStyle: "italic", fontWeight: 400 }}>
            today?
          </em>
        </h1>
        <p className="mt-2.5 text-base text-white/40">
          Pick a style. Write your hook. Go viral.
        </p>
      </div>

      {/* ── Draft restored banner ────────────────────────────────── */}
      {restoredFromDraft && (
        <div className="mb-4 flex items-center gap-2 rounded-xl border border-accent/20 bg-accent/10 px-4 py-3 text-sm text-accent-text">
          <span aria-hidden>{"✓"}</span>
          <span>Your idea was saved — click Generate to continue.</span>
        </div>
      )}

      {/* ── Photos brought over from a collection ────────────────── */}
      {pick && (
        <div className="mb-4 rounded-2xl border border-white/[0.08] bg-white/[0.03] px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-white/70">
              <span className="font-semibold text-white">{pickCount}</span>{" "}
              {pickCount === 1 ? "photo" : "photos"} from{" "}
              <span className="font-semibold text-white">
                {pick.collectionName || "your collection"}
              </span>
            </p>
            <button
              type="button"
              onClick={() => setPick(null)}
              className="text-xs font-semibold text-white/40 transition-colors hover:text-white"
            >
              Clear
            </button>
          </div>
          <div className="no-scrollbar mt-2.5 flex gap-2 overflow-x-auto">
            {pick.thumbs.slice(0, MAX_UPLOADS).map((src, i) => (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                key={i}
                src={src}
                alt=""
                className="h-14 w-14 shrink-0 rounded-lg object-cover ring-1 ring-white/10"
              />
            ))}
          </div>
          {/* Said out loud rather than silently dropping the extras: a deck
              holds MAX_UPLOADS slides, so a bigger pick can't all be used. */}
          {pick.imageIds.length > MAX_UPLOADS && (
            <p className="mt-2 text-xs text-amber-300/80">
              A slideshow holds {MAX_UPLOADS} slides — the first {MAX_UPLOADS} of
              your {pick.imageIds.length} picks will be used.
            </p>
          )}
        </div>
      )}

      {/* ── Composer card — one seamless surface, no internal borders.
             On phones it's the Claude-app composer: a single compact rounded
             box with the controls tucked inside its bottom edge and one quiet
             line of links underneath. ── */}
      <div
        className="overflow-visible rounded-3xl border border-white/8 bg-[#0f0f16]/[0.92] px-3 pb-3 pt-1 shadow-[0_40px_80px_rgba(0,0,0,0.5)] sm:px-0 sm:pb-0 sm:pt-0"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          // Stock photos means "don't use my photos" — ignore drops entirely.
          if (bg !== "single") return;
          addUserFiles(e.dataTransfer.files);
        }}
      >
        {/* Settings row — pill dropdowns, `sm` and up only (panels are
            portalled to <body> so the scroll container can't clip them).
            Hidden entirely in AI-decide mode: the AI picks all of these. */}
        {!aiMode && (
          <div className="no-scrollbar hidden flex-nowrap items-center gap-2 overflow-x-auto px-6 pt-5 sm:flex">
            {/* On Upload the photos decide the deck size (the server enforces
                one slide per photo), so offering a slide count here would be a
                choice that silently doesn't apply. Show the derived number
                instead. */}
            {bg === "single" && derivedSlides != null ? (
              <div className="flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-white/10 px-3 py-2">
                <span className="select-none text-[13px] text-white/40">Slides</span>
                <span className="text-[13px] font-semibold text-white">
                  {derivedSlides}
                </span>
                <span className="text-[13px] text-white/30">
                  {derivedSlides === 1 ? "· 1 photo" : `· ${derivedSlides} photos`}
                </span>
              </div>
            ) : (
              <DropdownSelect
                label="Slides"
                value={slides}
                onChange={setSlides}
                options={SLIDE_COUNTS.map((n) => ({ value: String(n), label: `${n} slides` }))}
              />
            )}
            <DropdownSelect
              label="Layout"
              value={layout}
              onChange={setLayout}
              options={LAYOUTS}
            />
            <DropdownSelect
              label="Goal"
              value={goal}
              onChange={setGoal}
              options={GOALS.map((g) => ({ value: g, label: g }))}
            />
          </div>
        )}

        <div className="flex flex-col gap-2 pt-0.5 sm:gap-3 sm:px-6 sm:pb-5 sm:pt-1">

          {/* Hook text — flush with the card, no inner box */}
          <div className="relative">
            <textarea
              ref={promptRef}
              value={prompt}
              onChange={(e) => {
                setPrompt(e.target.value);
                if (!e.target.value.trim()) setRemixFormat(null);
              }}
              onFocus={() => setIsFocused(true)}
              onBlur={() => setIsFocused(false)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  if (aiMode) void handleSuggest();
                  else void handleGenerate();
                }
              }}
              rows={1}
              placeholder=""
              aria-label={
                aiMode
                  ? "Optional direction for the AI"
                  : "Describe your slideshow idea"
              }
              /* Auto-grows from a short resting height instead of sitting at a
                 fixed 3 rows — empty, it was several lines of dead space, which
                 is most of what made the phone layout feel tall and blocky.
                 min-h keeps a comfortable target before any typing. */
              className="min-h-[3.2em] w-full resize-none overflow-hidden bg-transparent pt-3 text-base leading-snug text-white focus:outline-none sm:min-h-[5.1em] sm:pt-4 sm:text-lg"
            />
            {!isFocused && !prompt && (
              <div
                className="pointer-events-none absolute left-0 top-3 flex select-none items-start text-base leading-snug text-white/30 sm:top-4 sm:text-lg"
                aria-hidden
              >
                {aiMode ? (
                  <span>
                    {bg === "single"
                      ? "Optional — add a direction, or just drop in photos and let AI decide…"
                      : "What should this be about? AI picks the rest…"}
                  </span>
                ) : (
                  <>
                    <span>{animText}</span>
                    <span className="animate-cursor ml-px inline-block h-[1.15em] w-px translate-y-px bg-white/35" />
                  </>
                )}
              </div>
            )}
          </div>

          {/* Photo attachments — Upload source ONLY. On Stock photos there is no
              upload affordance at all, so the user's photos can never silently
              ride along into a stock generation. */}
          {bg === "single" && (
          /* With nothing staged this whole band is just "+ 0/10 Add a photo",
             so on phones it collapses into the footer's empty left slot (the
             ⌘↵ hint there is desktop-only). CSS-hidden rather than unmounted —
             the file inputs below live in here and the footer button clicks
             one of them. Once photos exist the thumbnails need the room and it
             comes back on every width. */
          <div
            className={`flex-wrap items-center gap-2 ${
              userImages.length === 0 ? "hidden sm:flex" : "flex"
            }`}
          >
            {userImages.map((src, i) => (
              <div
                key={i}
                className="relative h-12 w-12 overflow-hidden rounded-lg border border-white/12"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={src} alt="" className="h-full w-full object-cover" />
                <button
                  type="button"
                  onClick={() => {
                    setUserImages((prev) => prev.filter((_, j) => j !== i));
                    setUploadNote("");
                  }}
                  aria-label="Remove photo"
                  className="absolute right-0.5 top-0.5 grid h-4 w-4 place-items-center rounded-full bg-black/70 text-white transition-colors hover:bg-black"
                >
                  <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" aria-hidden>
                    <path d="M18 6L6 18M6 6l12 12" />
                  </svg>
                </button>
              </div>
            ))}
            {/* "+" attach button with a small menu (Photos / Files) */}
            <div ref={addMenuRef} className="relative">
              <button
                type="button"
                onClick={() => setAddMenuOpen((o) => !o)}
                aria-label="Add photos or files"
                aria-expanded={addMenuOpen}
                className={`grid h-8 w-8 place-items-center rounded-full border transition-colors ${
                  addMenuOpen
                    ? "border-white/25 text-white"
                    : "border-white/10 text-white/40 hover:border-white/25 hover:text-white"
                }`}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
                  <path d="M12 5v14M5 12h14" />
                </svg>
              </button>

              {addMenuOpen && (
                <div className="animate-dropdown-in absolute left-0 top-full z-50 mt-1.5 min-w-36 overflow-hidden rounded-xl border border-white/8 bg-[#1a1a1c] shadow-2xl shadow-black/60">
                  <button
                    type="button"
                    onClick={() => {
                      setAddMenuOpen(false);
                      userFileRef.current?.click();
                    }}
                    className="flex w-full items-center gap-2.5 px-4 py-2.5 text-sm text-white/70 transition-colors hover:bg-white/6 hover:text-white"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                      <rect x="3" y="3" width="18" height="18" rx="2" />
                      <circle cx="8.5" cy="8.5" r="1.5" />
                      <path d="M21 15l-5-5L5 21" />
                    </svg>
                    Photos
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setAddMenuOpen(false);
                      anyFileRef.current?.click();
                    }}
                    className="flex w-full items-center gap-2.5 px-4 py-2.5 text-sm text-white/70 transition-colors hover:bg-white/6 hover:text-white"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                      <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
                      <path d="M13 2v7h7" />
                    </svg>
                    Files
                  </button>
                  {/* Collections need a session — guests only get local files. */}
                  {isLoggedIn && (
                    <button
                      type="button"
                      onClick={openCollectionPicker}
                      className="flex w-full items-center gap-2.5 px-4 py-2.5 text-sm text-white/70 transition-colors hover:bg-white/6 hover:text-white"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                        <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />
                      </svg>
                      Collection
                    </button>
                  )}
                </div>
              )}

            </div>

            {/* Upload counter — makes the 10-photo cap obvious up front */}
            <span className="text-[12px] tabular-nums text-white/30">
              {userImages.length}/{MAX_UPLOADS}
            </span>
            {userImages.length === 0 && (
              <span className="text-[12px] text-white/35">
                {aiMode
                  ? "Add photos and AI will do the rest"
                  : "Add a photo to generate"}
              </span>
            )}
            {/* Short decks are a valid choice, not a mistake — say what will
                happen and get out of the way. Deliberately the same quiet grey
                as the other hints: nothing here is an error. */}
            {userImages.length > 0 && userImages.length <= 3 && (
              <span className="text-[12px] text-white/35">
                {userImages.length === 1
                  ? "1 photo — you'll get a single-slide post. Add more for a listicle."
                  : `${userImages.length} photos — you'll get a short ${userImages.length}-slide post. Add more for a listicle.`}
              </span>
            )}
            {uploadNote && (
              <span className="text-[12px] text-amber-300/80">{uploadNote}</span>
            )}

            <input
              ref={userFileRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => {
                addUserFiles(e.target.files);
                e.target.value = "";
              }}
            />
            <input
              ref={anyFileRef}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => {
                addUserFiles(e.target.files);
                e.target.value = "";
              }}
            />
          </div>
          )}

          {/* Try suggestions + AI-decide toggle. Desktop only — on phones the
              Claude-style box carries its controls inside the bottom edge and
              the two text links sit under the card. */}
          <div className="hidden flex-wrap items-center gap-2 sm:flex">
            {!aiMode && suggestions.length > 0 && (
              <div ref={tryRef} className="relative min-w-0">
                <button
                  type="button"
                  onClick={() => setTryOpen((v) => !v)}
                  aria-expanded={tryOpen}
                  aria-haspopup="listbox"
                  className="flex min-w-0 max-w-full items-center gap-1.5 rounded-full border border-white/10 px-3.5 py-1.5 text-[13px] text-white/60 transition-colors hover:border-accent/40 hover:text-white"
                >
                  <span className="shrink-0 text-white/35">Try:</span>
                  {/* Keyed on the index so each rotation remounts the span and
                      replays the fade — cheaper than an exit/enter pair. */}
                  <span key={tryIdx} className="try-swap min-w-0 truncate">
                    {suggestions[tryIdx % suggestions.length]}
                  </span>
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="shrink-0 text-white/35">
                    <path d="M6 9l6 6 6-6" />
                  </svg>
                </button>
                {tryOpen && (
                  <div className="animate-dropdown-in absolute left-0 top-full z-30 mt-2 w-max max-w-[26rem] rounded-xl border border-white/[0.08] bg-[#1a1a1c] p-1 shadow-2xl">
                    {suggestions.map((t) => (
                      <button
                        key={t}
                        type="button"
                        onClick={() => {
                          setPrompt(t);
                          setTryOpen(false);
                          promptRef.current?.focus();
                        }}
                        className="block w-full rounded-lg px-3 py-2 text-left text-[13px] text-white/70 transition-colors hover:bg-white/[0.06] hover:text-white"
                      >
                        {t}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            <button
              type="button"
              onClick={() => {
                setAiMode((v) => !v);
                setSupercharge(false);
                resetSuggestion();
                promptRef.current?.focus();
              }}
              aria-pressed={aiMode}
              className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-[13px] font-semibold transition-colors ${
                aiMode
                  ? "border-accent/60 bg-accent/20 text-accent-text"
                  : "border-accent/35 bg-accent/10 text-accent-text hover:bg-accent/20"
              }`}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                <path d="M12 2l1.9 5.7a2 2 0 0 0 1.3 1.3L21 11l-5.8 2a2 2 0 0 0-1.3 1.3L12 20l-1.9-5.7A2 2 0 0 0 8.8 13L3 11l5.8-2a2 2 0 0 0 1.3-1.3L12 2z" />
              </svg>
              {aiMode ? "Back to manual" : "Let AI decide"}
            </button>
            <button
              type="button"
              onClick={() => {
                setSupercharge((v) => !v);
                setAiMode(false);
                resetSuggestion();
                promptRef.current?.focus();
              }}
              aria-pressed={supercharge}
              title="A stronger model reviews the finished draft and fixes what's weak."
              className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-[13px] font-semibold transition-colors ${
                supercharge
                  ? "sc-pill-on border-transparent text-white"
                  : "border-white/10 bg-white/[0.03] text-white/60 hover:border-accent/40 hover:text-white"
              }`}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden className="sc-bolt">
                <path d="M13 2 4.5 12.5a1 1 0 0 0 .8 1.6H11l-1 8 8.5-10.6a1 1 0 0 0-.8-1.6H12l1-8z" />
              </svg>
              {supercharge ? "Supercharged" : "Supercharge"}
            </button>
            {aiMode && !suggestion && !suggestError && (
              <span className="text-[12px] text-white/30">
                AI picks the niche, angle, slide count and layout for you.
              </span>
            )}
            {supercharge && (
              <span className="text-[12px] text-white/30">
                A stronger model reviews the draft and fixes what&apos;s weak.
              </span>
            )}
          </div>

          {/* AI plan — one proposal: approve it, or nudge it (max 3 per build) */}
          {aiMode && (suggestion || suggestError) && (
            <div className="rounded-2xl bg-white/[0.03] p-4">
              {suggestError && (
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-[13px] text-red-400">{suggestError}</p>
                  <button
                    type="button"
                    onClick={() =>
                      void handleGenerate({
                        // No niche → the server derives it from the prompt.
                        slides: "6",
                        layout: LAYOUTS[0].value,
                        goal: GOALS[0],
                        prompt: prompt.trim() || "A scroll-stopping slideshow from these photos",
                      })
                    }
                    className="rounded-full border border-white/12 px-3 py-1.5 text-[12px] text-white/60 transition-colors hover:border-white/25 hover:text-white"
                  >
                    Generate with defaults
                  </button>
                </div>
              )}

              {aiOptions.length > 0 && (
                <>
                  <p className="text-[13px] font-semibold text-white">
                    Pick a direction
                  </p>
                  <p className="mt-0.5 text-[12px] text-white/40">
                    {aiOptions.length > 1
                      ? "Three takes on your photos — choose one, or describe your own below."
                      : "Here's the direction — generate it, or describe your own below."}
                  </p>

                  {/* Option cards — radio-style, the picked one is accented */}
                  <div className="mt-3 flex flex-col gap-2">
                    {aiOptions.map((opt, i) => {
                      const picked = i === pickedIndex;
                      return (
                        <button
                          key={`${opt.angle}-${i}`}
                          type="button"
                          onClick={() => setPickedIndex(i)}
                          aria-pressed={picked}
                          className={`rounded-xl border p-3 text-left transition-colors ${
                            picked
                              ? "border-accent/60 bg-accent/[0.08]"
                              : "border-white/8 bg-white/[0.02] hover:border-white/20"
                          }`}
                        >
                          <div className="flex items-start gap-2.5">
                            <span
                              aria-hidden
                              className={`mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full border ${
                                picked ? "border-accent bg-accent" : "border-white/25"
                              }`}
                            >
                              {picked && (
                                <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
                                  <path d="M20 6L9 17l-5-5" />
                                </svg>
                              )}
                            </span>
                            <span className="min-w-0">
                              <span className="block text-[14px] font-semibold leading-snug text-white">
                                {opt.angle}
                              </span>
                              {opt.rationale && (
                                <span className="mt-0.5 block text-[12px] leading-relaxed text-white/40">
                                  {opt.rationale}
                                </span>
                              )}
                              <span className="mt-1.5 flex flex-wrap items-center gap-1">
                                {[
                                  `${opt.slides} slides`,
                                  LAYOUTS.find((l) => l.value === opt.layout)?.label ??
                                    opt.layout,
                                  opt.goal,
                                ].map((chip) => (
                                  <span
                                    key={chip}
                                    className="rounded-full border border-white/8 bg-white/[0.03] px-2 py-0.5 text-[10px] text-white/45"
                                  >
                                    {chip}
                                  </span>
                                ))}
                              </span>
                            </span>
                          </div>
                        </button>
                      );
                    })}
                  </div>

                  {/* Own-direction row — the pivot, stated plainly */}
                  {suggestRound < MAX_SUGGESTIONS ? (
                    <div className="mt-3 rounded-xl border border-dashed border-white/12 p-3">
                      <p className="text-[12px] text-white/45">
                        None of these? Describe your own direction
                      </p>
                      <div className="mt-2 flex items-center gap-1.5">
                        <input
                          value={refineText}
                          onChange={(e) => setRefineText(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" && refineText.trim()) {
                              e.preventDefault();
                              void handleSuggest(refineText);
                            }
                          }}
                          placeholder="e.g. make it about meal prep instead"
                          aria-label="Describe your own direction"
                          className="min-w-0 flex-1 border-b border-white/10 bg-transparent pb-1 text-[13px] text-white transition-colors placeholder:text-white/25 focus:border-white/25 focus:outline-none"
                        />
                        <button
                          type="button"
                          onClick={() => void handleSuggest(refineText)}
                          disabled={!refineText.trim() || suggestLoading || isLoading}
                          className="shrink-0 rounded-full border border-white/12 px-3 py-1.5 text-[12px] text-white/60 transition-colors hover:border-white/25 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          {suggestLoading ? "Thinking…" : "Rethink"}
                        </button>
                      </div>
                      {suggestRound === MAX_SUGGESTIONS - 1 && (
                        <p className="mt-2 text-[11px] text-white/25">
                          1 rethink left
                        </p>
                      )}
                    </div>
                  ) : (
                    <p className="mt-3 text-[12px] text-white/30">
                      Last set — pick one and generate, or edit your inputs to start
                      over.
                    </p>
                  )}

                  <button
                    type="button"
                    onClick={approveSuggestion}
                    disabled={isLoading || suggestLoading || !suggestion}
                    className="mt-3 w-full rounded-full bg-accent px-4 py-2.5 text-[13px] font-semibold text-white shadow-[0_8px_24px_rgba(122,110,255,0.35)] transition-all hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Generate this one
                  </button>
                </>
              )}
            </div>
          )}
        </div>

        {/* Control row — on phones this is the Claude composer's bottom edge:
            attach, settings and the AI toggle on the left, send on the right,
            all inside the box. On desktop it stays the old footer. */}
        <div className="flex items-center justify-between gap-2 pt-1 sm:gap-3 sm:px-6 sm:pb-5 sm:pt-0">
          {/* Keyboard hint is desktop-only — there's no ⌘↵ on a phone, and it
              wrapped to two lines there. */}
          <span className="hidden text-[13px] text-white/30 sm:inline">
            {"⌘↵"} {aiMode ? "to let AI decide" : "to generate"}
          </span>

          {/* Phone control cluster. The Photos/Files split is a distinction the
              OS sheet already makes on a phone, so "+" goes straight to the
              picker. Every child is shrink-0, so without the scroll container
              this cluster overflowed its own box and printed the AI sparkle on
              top of the send button at 375px — it scrolls now instead. */}
          <div className="no-scrollbar flex min-w-0 items-center gap-1 overflow-x-auto sm:hidden">
            {bg === "single" && userImages.length === 0 && (
              // A bare "+" on a phone doesn't say what it adds, and this deck
              // can't generate without photos — so it carries a label until the
              // first one is staged, then shrinks back to an icon.
              <button
                type="button"
                onClick={() => userFileRef.current?.click()}
                aria-label="Add photos"
                className="flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full bg-white/[0.07] px-2.5 py-2.5 text-[13px] text-white transition-colors active:bg-white/[0.12] min-[430px]:pr-3.5"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
                  <path d="M12 5v14M5 12h14" />
                </svg>
                {/* The label costs 77px — nearly a third of the row — so it only
                    fits on big phones. Below 430px it collided with the send
                    button (collection + settings + sparkle + send leave 261px at
                    375px, and the four controls already need 238). */}
                <span className="hidden min-[430px]:inline">Add photos</span>
              </button>
            )}
            {/* Phones never see the attach strip's + menu (it's display:none
                until a photo is staged), so the collection picker gets its own
                footer button. */}
            {bg === "single" && isLoggedIn && (
              <button
                type="button"
                onClick={openCollectionPicker}
                aria-label="Use a collection"
                className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-white/[0.07] text-white transition-colors active:bg-white/[0.12]"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />
                </svg>
              </button>
            )}
            {!aiMode && (
              <button
                type="button"
                onClick={() => setSettingsOpen(true)}
                className="flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full bg-white/[0.07] px-3.5 py-2.5 text-[13px] text-white transition-colors active:bg-white/[0.12]"
              >
                {/* Value only. Showing the layout name here too meant two
                    ellipsis-truncated strings in one pill. The unit drops off
                    below 360px, the one width where the four controls plus send
                    don't fit. */}
                {derivedSlides ?? slides}
                <span className="hidden min-[360px]:inline">slides</span>
                {/* Supercharge now lives inside the sheet, so the pill carries
                    the only proof it's armed. */}
                {supercharge && (
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden className="sc-bolt text-accent-text">
                    <path d="M13 2 4.5 12.5a1 1 0 0 0 .8 1.6H11l-1 8 8.5-10.6a1 1 0 0 0-.8-1.6H12l1-8z" />
                  </svg>
                )}
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="text-white/35">
                  <path d="M6 9l6 6 6-6" />
                </svg>
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                setAiMode((v) => !v);
                setSupercharge(false);
                resetSuggestion();
                promptRef.current?.focus();
              }}
              aria-pressed={aiMode}
              aria-label={aiMode ? "Back to manual" : "Let AI decide"}
              className={`grid h-10 w-10 shrink-0 place-items-center rounded-full transition-colors ${
                aiMode ? "bg-accent/25 text-accent-text" : "bg-white/[0.07] text-accent-text"
              }`}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                <path d="M12 2l1.9 5.7a2 2 0 0 0 1.3 1.3L21 11l-5.8 2a2 2 0 0 0-1.3 1.3L12 20l-1.9-5.7A2 2 0 0 0 8.8 13L3 11l5.8-2a2 2 0 0 0 1.3-1.3L12 2z" />
              </svg>
            </button>
          </div>

          <div className="flex items-center gap-2.5">
            {/* Source used to be a "Source: Upload" dropdown — two words of
                jargon plus a click, to choose between exactly two things.
                Upload is always the default, so this is just the one-click
                escape hatch, stating the current mode in plain English.
                On phones it moves below the box, Claude-style. */}
            <button
              id="source-toggle"
              type="button"
              role="switch"
              aria-checked={bg === "collection"}
              aria-label="Use our photos"
              onClick={toggleSource}
              className="group hidden shrink-0 items-center gap-2.5 whitespace-nowrap rounded-full px-2 py-2 sm:flex"
            >
              <span
                className={`text-[13px] transition-colors ${
                  bg === "collection" ? "text-white" : "text-white/40"
                } group-hover:text-white/80`}
              >
                Use our photos
              </span>
              {/* Switch. The label above says what it does, so the track itself
                  carries no text — state is the knob position plus the accent. */}
              <span
                aria-hidden
                className={`relative h-6 w-11 shrink-0 rounded-full transition-colors duration-200 ${
                  bg === "collection" ? "bg-accent" : "bg-white/15"
                }`}
              >
                {/* left-0.5 is explicit: with no inset the knob falls back to
                    its static position, which lands it at the far side. */}
                <span
                  className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform duration-200 ${
                    bg === "collection" ? "translate-x-5" : "translate-x-0"
                  }`}
                />
              </span>
            </button>
          <div className="relative shrink-0">
            {/* "No photos and not using ours" is the one blocked state with an
                obvious fix, so it gets a pointer instead of a dead button: the
                arrow stays clickable and answers with this. A disabled button
                swallows clicks, which is exactly why it read as broken. */}
            {/* Gated on `needsPhotos` too, so adding a photo or flipping the
                switch dismisses it without an effect chasing the state. */}
            {photoHint && needsPhotos && (
              <div
                role="status"
                className="animate-dropdown-in absolute bottom-full right-0 z-20 mb-2 w-max max-w-[15rem] rounded-xl bg-[#26262a] px-3.5 py-2.5 text-[13px] leading-snug text-white shadow-xl shadow-black/50"
              >
                {/* Names the control by the label actually on screen — the
                    source picker is a segmented "My photos / Our photos" on
                    phones, not the desktop "Use our photos" switch. */}
                <span className="sm:hidden">
                  Add photos, or switch to{" "}
                  <span className="font-semibold">Our photos</span> below
                </span>
                <span className="hidden sm:inline">
                  Add a photo, or turn on{" "}
                  <span className="font-semibold">Use our photos</span>
                </span>
                {/* little arrow pointing down at the button */}
                <span
                  aria-hidden
                  className="absolute right-4 top-full -mt-px h-2 w-2 -translate-y-1/2 rotate-45 bg-[#26262a]"
                />
              </div>
            )}
            <button
              type="button"
              onClick={() => {
                if (needsPhotos) {
                  setPhotoHint(true);
                  // Taps have no mouseleave to hide it.
                  setTimeout(() => setPhotoHint(false), 4000);
                  return;
                }
                void (aiMode ? handleSuggest() : handleGenerate());
              }}
              // `working` covers the generate/plan spinner; genBlocked is the
              // input-level dead states (see their defs above).
              disabled={working || genBlocked}
              // Upload source means "use MY photos" — dimmed like a disabled
              // control, but still clickable so it can explain itself.
              aria-disabled={needsPhotos}
              onMouseEnter={() => needsPhotos && setPhotoHint(true)}
              onMouseLeave={() => setPhotoHint(false)}
              aria-label={aiMode ? "Let AI decide" : "Generate"}
              className={`grid h-10 w-10 shrink-0 place-items-center rounded-full bg-accent text-white transition-all hover:brightness-110 disabled:cursor-not-allowed sm:h-11 sm:w-11 sm:shadow-[0_8px_24px_rgba(122,110,255,0.35)] ${
                working
                  ? "gen-btn-breathe" // stays bright + pulses while it works
                  : genBlocked || needsPhotos
                    ? "opacity-40"
                    : ""
              }`}
            >
              {working ? (
                <svg className="gen-spin h-5 w-5" viewBox="0 0 24 24" fill="none" aria-hidden>
                  <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2.5" />
                  <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
                </svg>
              ) : (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M12 19V5M5 12l7-7 7 7" />
                </svg>
              )}
            </button>
          </div>
          </div>
        </div>
      </div>

      {/* ── Under-box switch (phones only) ───────────────────────────
             Was a text link reading "No photos? Use ours", which never said
             where to click or that it was a setting at all. It's the same
             switch the desktop footer uses — a control that shows its own
             state — just under the box, where there's room for the track. */}
      <div className="mt-3 flex justify-center sm:hidden">
        {/* Segmented, not a switch. A switch has one label whose meaning flips
            with the track ("Use your own photos" reading ON while you're on
            ours), so it can state the opposite of the truth. Both options are
            visible here and the filled one is the answer — nothing to infer. */}
        {/* While the blocked-generate hint is up, the control it's pointing at
            lights up too — a tooltip by the send button and the fix 60px away
            is easy to read past. */}
        <div
          role="radiogroup"
          aria-label="Photo source"
          className={`flex items-center gap-1 rounded-full bg-white/[0.06] p-1 transition-all duration-300 ${
            photoHint && needsPhotos
              ? "animate-pulse ring-2 ring-accent ring-offset-2 ring-offset-black"
              : ""
          }`}
        >
          {[
            { value: "single" as const, label: "My photos" },
            { value: "collection" as const, label: "Our photos" },
          ].map((opt) => (
            <button
              key={opt.value}
              type="button"
              role="radio"
              aria-checked={bg === opt.value}
              onClick={() => bg !== opt.value && toggleSource()}
              className={`rounded-full px-4 py-1.5 text-[13px] transition-all duration-200 ${
                bg === opt.value
                  ? "bg-accent font-semibold text-white shadow-[0_4px_14px_rgba(99,102,241,0.45)]"
                  : "text-white/45 active:text-white/70"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Error ────────────────────────────────────────────────── */}
      {genStatus === "error" && errorMsg && (
        <div className="mt-4 rounded-xl border border-red-500/20 bg-red-500/6 px-4 py-3 text-sm text-red-400">
          {errorMsg}
        </div>
      )}

      {/* ── Building… (skeleton filmstrip + stage narrator) ─────────
             Mirrors the result card's shape so the real deck simply resolves
             in place. Shown only during real generation, not the AI-plan step. */}
      {isLoading && (
        <div className="animate-generate mt-10 overflow-hidden rounded-2xl border border-white/8 bg-[#0a0a0a]">
          {/* Header: live stage narrator + creeping progress rail */}
          <div className="px-6 py-6 sm:px-8">
            <div className="flex items-center gap-2.5">
              {/* Pulsing "live" dot */}
              <span className="relative flex h-2.5 w-2.5 shrink-0">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-60" />
                <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-accent" />
              </span>
              {/* Keyed so each new line re-mounts and fades up */}
              <p
                key={superStage?.stage ?? stageIdx}
                className="gen-stage-in text-sm font-semibold text-white"
              >
                {/* Supercharge streams REAL pipeline stages; fall back to the
                    time-driven narrator on the normal (non-streamed) path. */}
                {superStage?.label ?? GEN_STAGES[Math.min(stageIdx, GEN_STAGES.length - 1)]}
                <span className="gen-dots ml-0.5 inline-flex">
                  <span>.</span>
                  <span>.</span>
                  <span>.</span>
                </span>
              </p>
            </div>
            {/* Progress rail: determinate creep + an indeterminate glide */}
            <div className="relative mt-4 h-1 w-full overflow-hidden rounded-full bg-white/8">
              <div
                className="absolute inset-y-0 left-0 rounded-full bg-accent transition-[width] duration-700 ease-out"
                style={{ width: `${genPct}%` }}
              />
              <div className="gen-rail-glow absolute inset-y-0 w-1/3 rounded-full bg-linear-to-r from-transparent via-white/50 to-transparent" />
            </div>
          </div>

          {/* Skeleton slide cards — cascade in, shimmer, then the real deck
              replaces them when the response lands. */}
          <div className="flex gap-3 overflow-x-auto px-6 pb-8 no-scrollbar sm:px-8">
            {Array.from({ length: skeletonCount }).map((_, j) => (
              <div
                key={j}
                className="gen-card-in shrink-0"
                style={{ animationDelay: `${j * 90}ms` }}
              >
                <div className="gen-shimmer relative aspect-9/16 w-28 overflow-hidden rounded-xl border border-white/6 bg-white/[0.03] sm:w-32">
                  {/* slide-number chip */}
                  <div className="absolute left-2 top-2 h-4 w-4 rounded-full bg-white/8" />
                  {/* faux caption lines near the bottom, where captions live */}
                  <div className="absolute inset-x-3 bottom-4 space-y-1.5">
                    <div className="h-2 w-4/5 rounded-full bg-white/12" />
                    <div className="h-2 w-3/5 rounded-full bg-white/8" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Results ──────────────────────────────────────────────── */}
      {result && result.length > 0 && (
        <div className="mt-10 space-y-6">
          {result.map((ss, i) => {
            const canEdit = ss.persisted && !!ss.id && ss.slides.every((s) => s.bgUrl);

            return (
              <div
                key={i}
                className="animate-generate overflow-hidden rounded-2xl border border-white/8 bg-[#0a0a0a]"
              >
                {/* Header */}
                <div className="flex items-start justify-between gap-4 px-6 py-6 sm:px-8">
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-widest text-white/25">
                      Ready to post
                    </p>
                    <h3 className="mt-1 text-base font-bold leading-snug text-white">{ss.title}</h3>
                    <p className="mt-0.5 text-xs text-white/30">{ss.slides.length} slides</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void handleGenerate()}
                    disabled={isLoading}
                    className="shrink-0 rounded-full border border-white/8 bg-white/4 px-3 py-1.5 text-xs text-white/40 transition-colors hover:border-white/20 hover:text-white disabled:opacity-40"
                  >
                    {"↻"} Regenerate
                  </button>
                </div>

                {/* Preview + caption editor (editable), or a simple filmstrip
                    for the logged-out / legacy case. */}
                {canEdit ? (
                  <div className="px-6 pb-8 sm:px-8">
                    <SlideEditor
                      id={ss.id!}
                      initialSlides={toEditorSlides(ss.slides)}
                      onReposition={() => setEditBump((b) => b + 1)}
                      onSlidesChange={(edited) =>
                        // Keep result state (TikTok modal captions, downloads)
                        // in sync with caption edits made inside the editor.
                        setResult((prev) =>
                          prev
                            ? prev.map((show, k) =>
                                k !== i
                                  ? show
                                  : {
                                      ...show,
                                      slides: show.slides.map((sl) => {
                                        const e = edited.find(
                                          (x) => x.position === sl.position,
                                        );
                                        return e ? { ...sl, caption: e.caption } : sl;
                                      }),
                                    },
                              )
                            : prev,
                        )
                      }
                    />
                  </div>
                ) : (
                  <div className="flex gap-3 overflow-x-auto px-6 pb-6 no-scrollbar sm:px-8">
                    {ss.slides.map((sl, j) => (
                      <div
                        key={j}
                        className="group relative shrink-0 w-24 overflow-hidden rounded-xl border border-white/6"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={bustUrl(sl.url, editBump)}
                          alt={sl.caption}
                          className="aspect-9/16 w-full object-cover"
                        />
                        <div className="absolute inset-0 flex items-end bg-linear-to-t from-black/80 to-transparent opacity-0 transition-opacity group-hover:opacity-100">
                          <button
                            type="button"
                            onClick={() =>
                              void downloadImage(sl.url, `${ss.title || "slide"}-${j + 1}.jpg`)
                            }
                            className="w-full py-1.5 text-center text-[9px] font-semibold text-white"
                          >
                            Download
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Actions */}
                <div className="flex flex-wrap items-center gap-2 border-t border-white/5 px-6 py-4 sm:px-8">
                  {ss.persisted && ss.id ? (
                    <>
                      <TikTokPostButton
                        slideshowId={ss.id}
                        slides={ss.slides.map((s) => ({
                          position: s.position,
                          caption: s.caption,
                          url: s.url,
                        }))}
                        isConnected={isConnected}
                        returnTo="/dashboard"
                      />
                      <Link
                        href="/dashboard/slideshows"
                        className="rounded-full border border-white/10 bg-white/4 px-4 py-2 text-xs font-medium text-accent-text transition-colors hover:border-accent/30"
                      >
                        View in library {"✓"}
                      </Link>
                      <SaveToCameraRoll
                        urls={ss.slides.map((s) => s.url)}
                        title={ss.title}
                      />
                      <a
                        href={`/api/slideshows/${ss.id}/zip`}
                        className="rounded-full border border-white/8 bg-white/4 px-4 py-2 text-xs font-medium text-white/50 transition-colors hover:border-white/20 hover:text-white"
                      >
                        Download .zip
                      </a>
                    </>
                  ) : (
                    <Link
                      href="/?auth=login"
                      className="rounded-full bg-white px-4 py-2 text-xs font-semibold text-black transition-opacity hover:opacity-90"
                    >
                      Sign in to post &amp; save
                    </Link>
                  )}
                </div>

              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
