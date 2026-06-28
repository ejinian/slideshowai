"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  COLLECTIONS,
  GENERATOR_NICHES,
  IMAGE_MODELS,
  LAYOUTS,
  NICHE_SUGGESTIONS,
  PINNED_TEMPLATES,
  SLIDE_COUNTS,
  STYLES,
} from "@/lib/generator-options";
import { GYM_IMAGES } from "@/lib/library-images";
import { saveSlideshow } from "@/app/dashboard/slideshows/actions";
import { SlideEditor, type EditorSlide } from "@/components/dashboard/slideshows/SlideEditor";
import { TikTokPostButton } from "@/components/dashboard/slideshows/TikTokPostButton";
import type { SlideRole } from "@/lib/generate/layout";

type BgOption = "collection" | "auto" | "single";

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

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const selectedLabel = options.find((o) => o.value === value)?.label ?? value;

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 rounded-lg px-2 py-1 transition-colors hover:bg-white/5"
      >
        <span className="select-none text-[11px] text-white/30">{label}</span>
        <span className="text-xs font-semibold text-white/85">{selectedLabel}</span>
        <svg
          className={`text-white/30 transition-transform duration-150 ${open ? "rotate-180" : ""}`}
          width="10" height="10" viewBox="0 0 24 24"
          fill="none" stroke="currentColor" strokeWidth="2.5"
          strokeLinecap="round" strokeLinejoin="round" aria-hidden
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {open && (
        <div className="absolute left-0 top-full z-50 mt-1.5 min-w-45 overflow-hidden rounded-xl border border-white/8 bg-[#1a1a1c] shadow-2xl shadow-black/60">
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
        </div>
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
  const [bg, setBg] = useState<BgOption>("collection");
  const [model, setModel] = useState(IMAGE_MODELS[0].id);
  const [collection, setCollection] = useState(COLLECTIONS[0].id);
  const [style, setStyle] = useState(STYLES[0].id);
  const [singleImage, setSingleImage] = useState<string | null>(null);

  const [genStatus, setGenStatus] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [result, setResult] = useState<ResultSlideshow[] | null>(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [savedIds, setSavedIds] = useState<string[]>([]);
  const [editingIdx, setEditingIdx] = useState<Set<number>>(new Set([0]));
  const [showAuthGate, setShowAuthGate] = useState(false);
  const [restoredFromDraft, setRestoredFromDraft] = useState(false);

  const promptRef = useRef<HTMLTextAreaElement>(null);

  const [suggestions, setSuggestions] = useState<string[]>([]);
  useEffect(() => {
    const pool = NICHE_SUGGESTIONS[collection] ?? PINNED_TEMPLATES;
    setSuggestions([...pool].sort(() => Math.random() - 0.5).slice(0, 3));
  }, [collection]);

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
      if (state.collection) setCollection(state.collection);
      if (state.style) setStyle(state.style);
      if (state.model) setModel(state.model);
      localStorage.removeItem(DRAFT_KEY);
      localStorage.removeItem(AUTO_KEY);
      setRestoredFromDraft(true);
    } catch {}
  }, [isLoggedIn]);

  function toggleEditing(i: number) {
    setEditingIdx((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  }

  async function handleGenerate() {
    if (!isLoggedIn) {
      try {
        localStorage.setItem(
          DRAFT_KEY,
          JSON.stringify({ prompt, niche, slides, layout, bg, collection, style, model }),
        );
        localStorage.setItem(AUTO_KEY, "true");
      } catch {}
      setShowAuthGate(true);
      return;
    }

    setGenStatus("loading");
    setErrorMsg("");
    setResult(null);
    setSavedIds([]);
    setEditingIdx(new Set([0]));
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
          prompt,
          backgroundMode: bg,
          collection,
          style,
          model,
          singleImage: singleImage ?? undefined,
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

  async function handleSave(id: string) {
    try {
      await saveSlideshow(id);
      setSavedIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
    } catch {}
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

  function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => setSingleImage(ev.target?.result as string);
    reader.readAsDataURL(file);
  }

  const isLoading = genStatus === "loading";

  return (
    <>
      {showAuthGate && <AuthGate onClose={() => setShowAuthGate(false)} />}

      {/* ── Hero heading ─────────────────────────────────────────── */}
      <div className="mb-8 text-center">
        <h1 className="text-4xl font-bold tracking-tight text-white sm:text-5xl">
          Make your next viral TikTok.
        </h1>
        <p className="mt-3 text-base text-white/45">
          Describe your idea. Pick a style. Done in seconds.
        </p>
      </div>

      {/* ── Draft restored banner ────────────────────────────────── */}
      {restoredFromDraft && (
        <div className="mb-4 flex items-center gap-2 rounded-xl border border-accent/20 bg-accent/10 px-4 py-3 text-sm text-accent-text">
          <span aria-hidden>{"✓"}</span>
          <span>Your idea was saved — click Generate to continue.</span>
        </div>
      )}

      {/* ── Form card ──────────────────────────────────────────────── */}
      <div className="rounded-2xl bg-[#1c1c1e]">
        {/* Options bar */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-5 pt-4 pb-3">
          <DropdownSelect
            label="Niche"
            value={niche}
            onChange={setNiche}
            options={GENERATOR_NICHES}
          />
          <span className="h-3 w-px bg-white/10" aria-hidden />
          <DropdownSelect
            label="Slides"
            value={slides}
            onChange={setSlides}
            options={SLIDE_COUNTS.map((n) => ({ value: String(n), label: `${n} slides` }))}
          />
          <span className="h-3 w-px bg-white/10" aria-hidden />
          <DropdownSelect
            label="Layout"
            value={layout}
            onChange={setLayout}
            options={LAYOUTS}
          />
          {/* Mode toggle */}
          <div className="ml-auto flex items-center gap-0.5">
            {(["collection", "auto", "single"] as BgOption[]).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setBg(mode)}
                className={`rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors ${
                  bg === mode ? "bg-white/10 text-white" : "text-white/35 hover:text-white/65"
                }`}
              >
                {mode === "collection" ? "Photos" : mode === "auto" ? "AI" : "Upload"}
              </button>
            ))}
          </div>
        </div>

        {/* Textarea */}
        <textarea
          ref={promptRef}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              void handleGenerate();
            }
          }}
          rows={4}
          placeholder="What's your content about? e.g. 5 reasons your gym content isn't going viral..."
          className="w-full resize-none bg-transparent px-5 py-4 text-[15px] text-white/90 placeholder:text-white/30 focus:outline-none"
        />

        {/* Try suggestions — right under textarea */}
        <div className="flex flex-wrap items-center gap-2 px-5 pb-3">
          <span className="shrink-0 text-[11px] text-white/25">Try:</span>
          {suggestions.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => {
                setPrompt(t);
                promptRef.current?.focus();
              }}
              className="shrink-0 rounded-full border border-white/9 bg-white/3 px-3 py-1 text-[11px] text-white/40 transition-colors hover:border-white/20 hover:text-white/80"
            >
              {t}
            </button>
          ))}
        </div>

        {/* Footer: hint + send button */}
        <div className="flex items-center justify-between px-5 pb-5">
          <span className="text-[10px] text-white/20">{"⌘↵"} to generate</span>
          <button
            type="button"
            onClick={() => void handleGenerate()}
            disabled={isLoading}
            aria-label="Generate"
            className="flex h-9 w-9 items-center justify-center rounded-full bg-white text-black shadow-lg transition-all hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {isLoading ? (
              <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden>
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.3" strokeWidth="3" />
                <path d="M22 12a10 10 0 0 1-10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
              </svg>
            ) : (
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M12 19V5M5 12l7-7 7 7" />
              </svg>
            )}
          </button>
        </div>
      </div>

      {/* ── Collection strip ─────────────────────────────────────── */}
      {bg === "collection" && (
        <div className="mt-3">
          <div className="flex gap-2.5 overflow-x-auto px-1 py-2 no-scrollbar">
            {COLLECTIONS.map((c, idx) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setCollection(c.id)}
                className={`relative shrink-0 h-32 w-48 overflow-hidden rounded-2xl transition-all ${
                  collection === c.id
                    ? "ring-2 ring-accent ring-offset-2 ring-offset-black"
                    : "opacity-55 hover:opacity-85"
                }`}
              >
                <div className="absolute inset-0 grid grid-cols-2 grid-rows-2">
                  {[0, 1, 2, 3].map((k) => {
                    const src = GYM_IMAGES[(idx * 4 + k) % GYM_IMAGES.length];
                    return (
                      <div
                        key={k}
                        className="bg-cover bg-center"
                        style={{ backgroundImage: `url(${src})` }}
                      />
                    );
                  })}
                </div>
                <div className="absolute inset-0 bg-linear-to-t from-black/85 via-black/20 to-transparent" />
                <div className="absolute bottom-0 left-0 right-0 px-3 pb-2.5">
                  <p className="text-[13px] font-bold leading-tight text-white">{c.name}</p>
                </div>
                {collection === c.id && (
                  <div className="absolute right-2 top-2 flex h-5 w-5 items-center justify-center rounded-full bg-accent">
                    <svg width="9" height="9" viewBox="0 0 10 10" fill="none" aria-hidden>
                      <path
                        d="M2 5l2.5 2.5L8 2.5"
                        stroke="white"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </div>
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── AI style picker ──────────────────────────────────────── */}
      {bg === "auto" && (
        <div className="mt-3">
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
            {STYLES.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setStyle(s.id)}
                className={`relative overflow-hidden rounded-xl transition-all ${
                  style === s.id
                    ? "ring-2 ring-accent ring-offset-1 ring-offset-black"
                    : "opacity-55 hover:opacity-85"
                }`}
              >
                <div
                  className={`flex aspect-[3/4] items-center justify-center bg-linear-to-br text-3xl ${s.gradient}`}
                >
                  <span aria-hidden>{s.emoji}</span>
                </div>
                <div className="absolute inset-x-0 bottom-0 bg-linear-to-t from-black/90 to-transparent p-2 pt-6">
                  <p className="text-[10px] font-semibold text-white">{s.name}</p>
                </div>
              </button>
            ))}
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {IMAGE_MODELS.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => setModel(m.id)}
                className={`h-7 rounded-full border px-3 text-[11px] font-medium transition-colors ${
                  model === m.id
                    ? "border-accent/40 bg-accent/10 text-accent-text"
                    : "border-white/10 text-white/35 hover:text-white/70"
                }`}
              >
                {m.name}
                {m.badge ? <span className="ml-1.5 opacity-50">{m.badge}</span> : null}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Upload zone ──────────────────────────────────────────── */}
      {bg === "single" && (
        <div className="mt-3">
          <label className="flex cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed border-white/10 bg-white/2 px-6 py-10 text-center transition-colors hover:border-white/20">
            {singleImage ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={singleImage}
                alt="Uploaded"
                className="mb-3 h-16 w-auto rounded-lg object-cover"
              />
            ) : (
              <div className="mb-3 grid h-9 w-9 place-items-center rounded-full border border-white/10 text-lg text-white/40">
                {"↑"}
              </div>
            )}
            <p className="text-sm font-medium text-white/70">
              {singleImage ? "Change image" : "Upload background"}
            </p>
            <p className="mt-1 text-xs text-white/30">PNG or JPG</p>
            <input
              type="file"
              accept="image/png,image/jpeg"
              className="sr-only"
              onChange={handleFileUpload}
            />
          </label>
        </div>
      )}

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
            const saved = ss.id ? savedIds.includes(ss.id) : false;
            const canEdit = ss.persisted && !!ss.id && ss.slides.every((s) => s.bgUrl);
            const editing = canEdit && editingIdx.has(i);

            return (
              <div
                key={i}
                className="animate-fade-up overflow-hidden rounded-2xl border border-white/8 bg-[#0a0a0a]"
              >
                {/* Header */}
                <div className="flex items-start justify-between gap-4 px-5 py-5">
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

                {/* Filmstrip */}
                <div className="flex gap-2 overflow-x-auto px-5 pb-5 no-scrollbar">
                  {ss.slides.map((sl, j) => (
                    <div
                      key={j}
                      className="group relative shrink-0 w-20 overflow-hidden rounded-xl border border-white/6"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={sl.url}
                        alt={sl.caption}
                        className="aspect-9/16 w-full object-cover"
                      />
                      <div className="absolute inset-0 flex items-end bg-linear-to-t from-black/80 to-transparent opacity-0 transition-opacity group-hover:opacity-100">
                        <button
                          type="button"
                          onClick={() =>
                            void downloadImage(sl.url, `${ss.title || "slide"}-${j + 1}.png`)
                          }
                          className="w-full py-1.5 text-center text-[9px] font-semibold text-white"
                        >
                          Download
                        </button>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Actions */}
                <div className="flex flex-wrap items-center gap-2 border-t border-white/5 px-5 py-4">
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
                      {saved ? (
                        <Link
                          href="/dashboard/slideshows"
                          className="rounded-full border border-white/10 bg-white/4 px-4 py-2 text-xs font-medium text-accent-text transition-colors hover:border-accent/30"
                        >
                          View in library {"✓"}
                        </Link>
                      ) : (
                        <button
                          type="button"
                          onClick={() => void handleSave(ss.id!)}
                          className="rounded-full border border-white/8 bg-white/4 px-4 py-2 text-xs font-medium text-white/50 transition-colors hover:border-white/20 hover:text-white"
                        >
                          Save to library
                        </button>
                      )}
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

                {/* Caption editor */}
                {canEdit && (
                  <div className="border-t border-white/5">
                    <button
                      type="button"
                      onClick={() => toggleEditing(i)}
                      className="flex w-full items-center gap-2 px-5 py-3 text-xs text-white/30 transition-colors hover:text-white/70"
                    >
                      <span aria-hidden className="text-[10px]">
                        {editing ? "↑" : "✥"}
                      </span>
                      {editing ? "Close editor" : "Adjust caption positions"}
                    </button>
                    {editing && (
                      <div className="border-t border-white/5">
                        <SlideEditor id={ss.id!} initialSlides={toEditorSlides(ss.slides)} />
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
