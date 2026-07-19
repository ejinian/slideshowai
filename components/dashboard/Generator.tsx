"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import {
  GENERATOR_NICHES,
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

/* ── Post goals — a settings-row dropdown, sent to the caption model ───────── */
const GOALS = ["Grow followers", "Drive sales", "Educate", "Entertain"];

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
  // "Help me find my hook" — plain-language assist mode. The user describes
  // their business/goal; /api/assist returns 3 hook options with a why-it-works
  // explanation; picking one prefills the generator (review-first, no auto-gen).
  const [assistMode, setAssistMode] = useState(false);
  const [assistLoading, setAssistLoading] = useState(false);
  const [assistError, setAssistError] = useState("");
  const [assistHooks, setAssistHooks] = useState<
    { hook: string; why: string; niche: string; slides: string; prompt: string }[] | null
  >(null);
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
      const state = JSON.parse(saved) as Record<string, string>;
      if (state.prompt) setPrompt(state.prompt);
      if (state.niche) setNiche(state.niche);
      if (state.slides) setSlides(state.slides);
      if (state.layout) setLayout(state.layout);
      if (state.bg) setBg(state.bg as BgOption);
      if (state.goal) setGoal(state.goal);
      localStorage.removeItem(DRAFT_KEY);
      localStorage.removeItem(AUTO_KEY);
      setRestoredFromDraft(true);
    } catch {}
  }, [isLoggedIn]);

  async function handleAssist() {
    if (!isLoggedIn) {
      setShowAuthGate(true);
      return;
    }
    if (assistLoading) return;
    setAssistLoading(true);
    setAssistError("");
    setAssistHooks(null);
    try {
      const res = await fetch("/api/assist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description: prompt }),
      });
      const data = (await res.json()) as {
        hooks?: { hook: string; why: string; niche: string; slides: string; prompt: string }[];
        error?: string;
      };
      if (!res.ok || !data.hooks?.length) {
        throw new Error(data.error || "Couldn't come up with hooks — try again.");
      }
      setAssistHooks(data.hooks);
    } catch (e) {
      setAssistError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setAssistLoading(false);
    }
  }

  // Picking a hook prefills the generator (review-first — the user still hits
  // generate) and exits assist mode.
  function pickHook(h: { hook: string; why: string; niche: string; slides: string; prompt: string }) {
    setNiche(h.niche);
    setSlides(h.slides);
    setPrompt(h.prompt);
    setAssistMode(false);
    setAssistHooks(null);
    promptRef.current?.focus();
  }

  async function handleGenerate() {
    if (!isLoggedIn) {
      try {
        localStorage.setItem(
          DRAFT_KEY,
          JSON.stringify({ prompt, niche, slides, layout, bg, goal }),
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
      const nicheLabel = GENERATOR_NICHES.find((n) => n.value === niche)?.label ?? niche;
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          niche: nicheLabel.replace(/^[^\p{L}]+/u, "").trim(),
          layout,
          slideCount: Number(slides),
          slideshowCount: 1,
          prompt: goal ? `${prompt}\n\nGoal of this post: ${goal}.`.trim() : prompt,
          backgroundMode: bg,
          // The niche now drives image selection (the collection carousel was
          // removed); its value doubles as the library collection id.
          collection: niche,
          userImages: userImages.length ? userImages : undefined,
        }),
      });
      const data = (await res.json()) as { slideshows?: ResultSlideshow[]; error?: string };
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

  // Step 3 uploads: read picked/dropped files as data URLs (max 10 kept).
  function addUserFiles(fileList: FileList | null) {
    if (!fileList) return;
    Array.from(fileList)
      .filter((f) => f.type.startsWith("image/"))
      .forEach((f) => {
        const reader = new FileReader();
        reader.onload = (ev) => {
          const src = ev.target?.result as string;
          if (src) setUserImages((prev) => [...prev, src].slice(0, 10));
        };
        reader.readAsDataURL(f);
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
          addUserFiles(e.dataTransfer.files);
        }}
      >
        {/* Settings row — pill dropdowns, always one left-to-right line
            (never wraps; scrolls horizontally if space runs out — panels are
            portalled to <body> so the scroll container can't clip them) */}
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

        <div className="flex flex-col gap-3 px-6 pb-5 pt-1">

          {/* Hook text — flush with the card, no inner box */}
          <div className="relative">
            <textarea
              ref={promptRef}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onFocus={() => setIsFocused(true)}
              onBlur={() => setIsFocused(false)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  if (assistMode) void handleAssist();
                  else void handleGenerate();
                }
              }}
              rows={3}
              placeholder=""
              aria-label={
                assistMode
                  ? "Describe your business and goal"
                  : "Describe your slideshow idea"
              }
              className="w-full resize-none bg-transparent pt-4 text-lg leading-snug text-white focus:outline-none"
            />
            {!isFocused && !prompt && (
              <div
                className="pointer-events-none absolute left-0 top-4 flex select-none items-start text-lg leading-snug text-white/30"
                aria-hidden
              >
                {assistMode ? (
                  <span>
                    Tell us about your business and what you want to achieve…
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

          {/* Photo attachments — inline strip, drag-drop works on the whole card */}
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
                  onClick={() =>
                    setUserImages((prev) => prev.filter((_, j) => j !== i))
                  }
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

          {/* Try suggestions + hook assist */}
          <div className="flex flex-wrap items-center gap-2">
            {!assistMode && (
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
                setAssistMode((v) => {
                  const next = !v;
                  if (!next) {
                    setAssistHooks(null);
                    setAssistError("");
                  }
                  return next;
                });
                promptRef.current?.focus();
              }}
              aria-pressed={assistMode}
              className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-[13px] font-semibold transition-colors ${
                assistMode
                  ? "border-accent/60 bg-accent/20 text-accent-text"
                  : "border-accent/35 bg-accent/10 text-accent-text hover:bg-accent/20"
              }`}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                <path d="M12 2l1.9 5.7a2 2 0 0 0 1.3 1.3L21 11l-5.8 2a2 2 0 0 0-1.3 1.3L12 20l-1.9-5.7A2 2 0 0 0 8.8 13L3 11l5.8-2a2 2 0 0 0 1.3-1.3L12 2z" />
              </svg>
              {assistMode ? "Back to normal mode" : "Help me find my hook"}
            </button>
          </div>

          {/* Assist results — 3 hook options with why-it-works explanations */}
          {assistMode && (assistHooks || assistError) && (
            <div className="space-y-2">
              {assistError && (
                <p className="text-xs text-red-400">{assistError}</p>
              )}
              {assistHooks?.map((h) => (
                <button
                  key={h.hook}
                  type="button"
                  onClick={() => pickHook(h)}
                  className="group block w-full rounded-xl bg-white/[0.03] px-4 py-3 text-left transition-colors hover:bg-white/[0.06]"
                >
                  <span className="block text-sm font-semibold text-white">
                    {h.hook}
                  </span>
                  <span className="mt-1 block text-xs leading-relaxed text-white/40">
                    {h.why}
                  </span>
                  <span className="mt-1.5 block text-[10px] font-medium text-accent-text opacity-0 transition-opacity group-hover:opacity-100">
                    Use this hook →
                  </span>
                </button>
              ))}
              {assistHooks && (
                <p className="pt-0.5 text-[10px] text-white/20">
                  Pick one — we&apos;ll fill everything in. You can still tweak it before generating.
                </p>
              )}
            </div>
          )}
        </div>

        {/* Footer: hint + source + generate */}
        <div className="flex items-center justify-between gap-3 px-6 pb-5">
          <span className="text-[13px] text-white/30">
            {"⌘↵"} {assistMode ? "for hook ideas" : "to generate"}
          </span>
          <div className="flex items-center gap-2.5">
            <DropdownSelect
              label="Source"
              value={bg}
              onChange={(v) => setBg(v as BgOption)}
              options={[
                { value: "single", label: "Upload" },
                { value: "collection", label: "Stock photos" },
              ]}
            />
          <button
            type="button"
            onClick={() => void (assistMode ? handleAssist() : handleGenerate())}
            disabled={isLoading || assistLoading}
            aria-label={assistMode ? "Get hook ideas" : "Generate"}
            className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-accent text-white shadow-[0_8px_24px_rgba(122,110,255,0.35)] transition-all hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {isLoading || assistLoading ? (
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
