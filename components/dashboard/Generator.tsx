"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import {
  GENERATOR_NICHES,
  GOALS,
  LAYOUTS,
  NICHE_SUGGESTIONS,
  PINNED_TEMPLATES,
  SLIDE_COUNTS,
} from "@/lib/generator-options";
import { SlideEditor, type EditorSlide } from "@/components/dashboard/slideshows/SlideEditor";
import { TikTokPostButton } from "@/components/dashboard/slideshows/TikTokPostButton";
import type { SlideRole } from "@/lib/generate/layout";

type BgOption = "collection" | "single";

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
}
interface ResultSlideshow {
  id: string | null;
  title: string;
  persisted: boolean;
  slides: ResultSlide[];
}

const ROLES: SlideRole[] = ["title", "reason", "plug", "cta"];
const DRAFT_KEY = "slideshowai_draft";
const AUTO_KEY = "slideshowai_autoGenerate";
const MAX_UPLOADS = 10;

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
    url: s.url,
    bgUrl: s.bgUrl,
    pos: { x: s.posX, y: s.posY, align: s.align, maxWidth: s.maxWidth ?? undefined },
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
  const [niche, setNiche] = useState(GENERATOR_NICHES[0].value);
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
  // Little "+" attach menu (Photos / Files) in the composer.
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

  const [genStatus, setGenStatus] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [result, setResult] = useState<ResultSlideshow[] | null>(null);
  const [errorMsg, setErrorMsg] = useState("");
  // Bumped after a caption reposition so the on-demand baked filmstrip previews
  // refetch (appended as a cache-buster to the render-endpoint URLs).
  const [editBump, setEditBump] = useState(0);
  const [showAuthGate, setShowAuthGate] = useState(false);
  const [restoredFromDraft, setRestoredFromDraft] = useState(false);
  // "Remix this trend" hand-off: the trend's format recipe rides along with
  // /api/generate so the deck mirrors the trend's mechanic slide-by-slide.
  // Cleared when the prompt is emptied or an assist hook replaces it.
  const [remixFormat, setRemixFormat] = useState<Record<string, unknown> | null>(null);
  // One-click remix: generation starts on arrival (set by the draft restore).
  const [pendingAuto, setPendingAuto] = useState(false);
  // "Let AI decide" — the frictionless mode. Config pills are hidden; the user
  // just drops in photos (+ an optional direction) and /api/suggest proposes ONE
  // concrete plan (niche/angle/slides/layout/goal). They approve it (→ the
  // unchanged /api/generate) or nudge it, capped at MAX_SUGGESTIONS per build.
  const [aiMode, setAiMode] = useState(false);
  const [suggestLoading, setSuggestLoading] = useState(false);
  const [suggestError, setSuggestError] = useState("");
  const [suggestion, setSuggestion] = useState<AiSuggestion | null>(null);
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
  // Suggestions follow the selected niche (the niche now drives image selection
  // too — the old collection carousel was removed).
  useEffect(() => {
    const pool = NICHE_SUGGESTIONS[niche] ?? PINNED_TEMPLATES;
    setSuggestions([...pool].sort(() => Math.random() - 0.5).slice(0, 3));
  }, [niche]);

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
      if (typeof state.niche === "string" && state.niche) setNiche(state.niche);
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
      // Remix drafts auto-generate; fires from an effect so handleGenerate
      // sees the state set above.
      if (state.autostart === "true" && typeof state.prompt === "string" && state.prompt) {
        setPendingAuto(true);
      }
    } catch {}
  }, [isLoggedIn]);

  useEffect(() => {
    if (!pendingAuto || genStatus !== "idle") return;
    setPendingAuto(false);
    void handleGenerate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingAuto]);

  // Clears any live AI suggestion + resets the per-build round counter. Called
  // when the inputs behind a suggestion change enough that it's stale.
  function resetSuggestion(resetRound = true) {
    setSuggestion(null);
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
      let data: { suggestion?: AiSuggestion; error?: string };
      try {
        data = JSON.parse(raw) as { suggestion?: AiSuggestion; error?: string };
      } catch {
        throw new Error(
          res.status === 413
            ? "Those photos are too large — try fewer or smaller images."
            : "Something went wrong — try again.",
        );
      }
      if (!res.ok || !data.suggestion) {
        throw new Error(data.error || "Couldn't come up with a direction — try again.");
      }
      setSuggestion(data.suggestion);
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
      niche: string;
      slides: string;
      layout: string;
      goal: string;
      prompt: string;
    },
    // Diagnostics-only provenance for "Let AI decide" runs (local dumps).
    aiPlan?: Record<string, unknown>,
  ) {
    const eff = {
      niche: override?.niche ?? niche,
      slides: override?.slides ?? slides,
      layout: override?.layout ?? layout,
      goal: override?.goal ?? goal,
      prompt: override?.prompt ?? prompt,
    };

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
    setRestoredFromDraft(false);

    try {
      const nicheLabel =
        GENERATOR_NICHES.find((n) => n.value === eff.niche)?.label ?? eff.niche;
      const payload = JSON.stringify({
        niche: nicheLabel.replace(/^[^\p{L}]+/u, "").trim(),
        layout: eff.layout,
        slideCount: Number(eff.slides),
        slideshowCount: 1,
        prompt: eff.goal
          ? `${eff.prompt}\n\nGoal of this post: ${eff.goal}.`.trim()
          : eff.prompt,
        backgroundMode: bg,
        // The niche now drives image selection (the collection carousel was
        // removed); its value doubles as the library collection id.
        collection: eff.niche,
        userImages: userImages.length ? userImages : undefined,
        // "Remix this trend" carries the trend's format recipe through.
        format: remixFormat ?? undefined,
        // Diagnostics only — never reaches the model (see /api/generate).
        aiPlan,
      });

      const mb = payload.length / 1024 / 1024;
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: payload,
      });

      // Read as text first: a 413/proxy error returns plain text, and calling
      // res.json() on it is what produced `Unexpected token 'R'`.
      const ctype = res.headers.get("content-type") ?? "";
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
        // A new photo set makes any existing AI plan stale (keep the round
        // count — the 3-suggestion cap is per build, not per photo set).
        resetSuggestion(false);
      }
    });
  }

  const isLoading = genStatus === "loading";

  return (
    <>
      {showAuthGate && <AuthGate onClose={() => setShowAuthGate(false)} />}

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

      {/* ── Composer card — one seamless surface, no internal borders ── */}
      <div
        className="overflow-visible rounded-3xl border border-white/8 bg-[#0f0f16]/[0.92] shadow-[0_40px_80px_rgba(0,0,0,0.5)]"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          // Stock photos means "don't use my photos" — ignore drops entirely.
          if (bg !== "single") return;
          addUserFiles(e.dataTransfer.files);
        }}
      >
        {/* Settings row — pill dropdowns, always one left-to-right line
            (never wraps; scrolls horizontally if space runs out — panels are
            portalled to <body> so the scroll container can't clip them).
            Hidden entirely in AI-decide mode: the AI picks all of these. */}
        {!aiMode && (
          <div className="no-scrollbar flex flex-nowrap items-center gap-2 overflow-x-auto px-6 pt-5">
            <DropdownSelect
              label="Niche"
              value={niche}
              onChange={setNiche}
              options={GENERATOR_NICHES}
            />
            <DropdownSelect
              label="Slides"
              value={slides}
              onChange={setSlides}
              options={SLIDE_COUNTS.map((n) => ({ value: String(n), label: `${n} slides` }))}
            />
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

        <div className="flex flex-col gap-3 px-6 pb-5 pt-1">

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
              rows={3}
              placeholder=""
              aria-label={
                aiMode
                  ? "Optional direction for the AI"
                  : "Describe your slideshow idea"
              }
              className="w-full resize-none bg-transparent pt-4 text-lg leading-snug text-white focus:outline-none"
            />
            {!isFocused && !prompt && (
              <div
                className="pointer-events-none absolute left-0 top-4 flex select-none items-start text-lg leading-snug text-white/30"
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
          <div className="flex flex-wrap items-center gap-2">
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
                  ? "Add photos and AI will do the rest, or switch Source to Stock photos"
                  : "Add a photo to generate, or switch Source to Stock photos"}
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

          {/* Try suggestions + AI-decide toggle */}
          <div className="flex flex-wrap items-center gap-2">
            {!aiMode && (
              <>
                <span className="shrink-0 text-[13px] text-white/35">Try:</span>
                {suggestions.map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => {
                      setPrompt(t);
                      promptRef.current?.focus();
                    }}
                    className="shrink-0 rounded-full border border-white/10 px-3.5 py-1.5 text-[13px] text-white/60 transition-colors hover:border-accent hover:text-white"
                  >
                    {t}
                  </button>
                ))}
              </>
            )}
            <button
              type="button"
              onClick={() => {
                setAiMode((v) => !v);
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
            {aiMode && !suggestion && !suggestError && (
              <span className="text-[12px] text-white/30">
                AI picks the niche, angle, slide count and layout for you.
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
                        niche: niche || "other",
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

              {suggestion && (
                <>
                  <div className="mb-2.5 flex flex-wrap items-center gap-1.5">
                    {[
                      GENERATOR_NICHES.find((n) => n.value === suggestion.niche)?.label ??
                        suggestion.niche,
                      `${suggestion.slides} slides`,
                      LAYOUTS.find((l) => l.value === suggestion.layout)?.label ??
                        suggestion.layout,
                      suggestion.goal,
                    ].map((chip) => (
                      <span
                        key={chip}
                        className="rounded-full border border-white/8 bg-white/[0.03] px-2.5 py-1 text-[11px] text-white/50"
                      >
                        {chip}
                      </span>
                    ))}
                  </div>

                  <p className="text-[15px] font-semibold leading-snug text-white">
                    {suggestion.angle}
                  </p>
                  {suggestion.rationale && (
                    <p className="mt-1 text-[13px] leading-relaxed text-white/40">
                      {suggestion.rationale}
                    </p>
                  )}

                  <div className="mt-3.5 flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={approveSuggestion}
                      disabled={isLoading || suggestLoading}
                      className="shrink-0 rounded-full bg-accent px-4 py-2 text-[13px] font-semibold text-white shadow-[0_8px_24px_rgba(122,110,255,0.35)] transition-all hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      Looks good — generate
                    </button>

                    {suggestRound < MAX_SUGGESTIONS ? (
                      <div className="flex min-w-0 flex-1 items-center gap-1.5">
                        <input
                          value={refineText}
                          onChange={(e) => setRefineText(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" && refineText.trim()) {
                              e.preventDefault();
                              void handleSuggest(refineText);
                            }
                          }}
                          placeholder="or change it — e.g. make it about meal prep"
                          aria-label="Change the AI's direction"
                          className="min-w-0 flex-1 border-b border-white/10 bg-transparent pb-1 text-[13px] text-white transition-colors placeholder:text-white/25 focus:border-white/25 focus:outline-none"
                        />
                        <button
                          type="button"
                          onClick={() => void handleSuggest(refineText)}
                          disabled={!refineText.trim() || suggestLoading || isLoading}
                          className="shrink-0 rounded-full border border-white/12 px-3 py-1.5 text-[12px] text-white/60 transition-colors hover:border-white/25 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          {suggestLoading ? "Thinking…" : "Refine"}
                        </button>
                      </div>
                    ) : (
                      <span className="text-[12px] text-white/30">
                        Last pick — generate, or edit your inputs to start over.
                      </span>
                    )}
                  </div>

                  {suggestRound === MAX_SUGGESTIONS - 1 && (
                    <p className="mt-2 text-[11px] text-white/25">1 change left</p>
                  )}
                </>
              )}
            </div>
          )}
        </div>

        {/* Footer: hint + source + generate */}
        <div className="flex items-center justify-between gap-3 px-6 pb-5">
          <span className="text-[13px] text-white/30">
            {"⌘↵"} {aiMode ? "to let AI decide" : "to generate"}
          </span>
          <div className="flex items-center gap-2.5">
            <DropdownSelect
              label="Source"
              value={bg}
              onChange={(v) => {
                setBg(v as BgOption);
                // Switching source discards staged uploads so they don't
                // silently ride along into a stock-photo generation.
                setUserImages([]);
                setUploadNote("");
                // The AI plan was built from the old source — start fresh.
                resetSuggestion();
              }}
              options={[
                { value: "single", label: "Upload" },
                { value: "collection", label: "Stock photos" },
              ]}
            />
          <button
            type="button"
            onClick={() => void (aiMode ? handleSuggest() : handleGenerate())}
            disabled={
              isLoading ||
              suggestLoading ||
              // Upload source means "use MY photos" — block with none.
              (bg === "single" && userImages.length === 0) ||
              // Manual mode always needs a prompt. In AI mode the prompt is
              // optional when photos carry the idea, but stock has nothing
              // else to go on.
              (!aiMode && !prompt.trim()) ||
              (aiMode && bg === "collection" && !prompt.trim()) ||
              // Out of suggestions — approve the plan or change the inputs.
              (aiMode && suggestRound >= MAX_SUGGESTIONS)
            }
            title={
              bg === "single" && userImages.length === 0
                ? "Add at least one photo, or switch Source to Stock photos"
                : undefined
            }
            aria-label={aiMode ? "Let AI decide" : "Generate"}
            className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-accent text-white shadow-[0_8px_24px_rgba(122,110,255,0.35)] transition-all hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {isLoading || suggestLoading ? (
              <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden>
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.3" strokeWidth="3" />
                <path d="M22 12a10 10 0 0 1-10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
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

      {/* ── Error ────────────────────────────────────────────────── */}
      {genStatus === "error" && errorMsg && (
        <div className="mt-4 rounded-xl border border-red-500/20 bg-red-500/6 px-4 py-3 text-sm text-red-400">
          {errorMsg}
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
                      <a
                        href={`/api/slideshows/${ss.id}/zip`}
                        className="rounded-full border border-white/8 bg-white/4 px-4 py-2 text-xs font-medium text-white/50 transition-colors hover:border-white/20 hover:text-white"
                      >
                        Download .zip
                      </a>
                    </>
                  ) : (
                    <Link
                      href="/login"
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
