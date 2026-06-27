"use client";

import { useState } from "react";
import Link from "next/link";
import {
  COLLECTIONS,
  GENERATOR_NICHES,
  IMAGE_MODELS,
  LAYOUTS,
  PINNED_TEMPLATES,
  SLIDE_COUNTS,
  SLIDESHOW_COUNTS,
  STYLES,
} from "@/lib/generator-options";
import { GYM_IMAGES } from "@/lib/library-images";
import { saveSlideshow } from "@/app/dashboard/slideshows/actions";
import { SlideEditor, type EditorSlide } from "@/components/dashboard/slideshows/SlideEditor";
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

/* ------------------------------- primitives ------------------------------- */

function StepCard({
  n,
  title,
  children,
  className = "",
}: {
  n: number;
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-[var(--radius-card)] border border-border bg-surface p-6 ${className}`}>
      <div className="flex items-center gap-3">
        <span className="grid h-7 w-7 place-items-center rounded-full bg-accent text-sm font-bold text-accent-foreground">
          {n}
        </span>
        <h2 className="text-base font-semibold">{title}</h2>
      </div>
      <div className="mt-5">{children}</div>
    </section>
  );
}

function LabeledSelect({
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
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium">{label}</span>
      <div className="relative">
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full appearance-none rounded-lg border border-border bg-background px-3 py-2.5 pr-9 text-sm text-foreground transition-colors focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/40"
        >
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <svg
          className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </div>
    </label>
  );
}

function Selectable({
  selected,
  onSelect,
  className = "",
  children,
}: {
  selected: boolean;
  onSelect: () => void;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      role="radio"
      aria-checked={selected}
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect();
        }
      }}
      className={`cursor-pointer transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 ${className}`}
    >
      {children}
    </div>
  );
}

function RadioDot({ selected, className = "" }: { selected: boolean; className?: string }) {
  return (
    <span
      className={`grid h-4 w-4 shrink-0 place-items-center rounded-full border ${
        selected ? "border-accent" : "border-muted"
      } ${className}`}
    >
      {selected ? <span className="h-2 w-2 rounded-full bg-accent" /> : null}
    </span>
  );
}

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-medium text-accent-text">
      {children}
    </span>
  );
}

/* -------------------------------- generator ------------------------------- */

export function Generator() {
  const [niche, setNiche] = useState(GENERATOR_NICHES[0].value);
  const [layout, setLayout] = useState(LAYOUTS[0].value);
  const [slides, setSlides] = useState("6");
  const [shows, setShows] = useState("1");
  const [prompt, setPrompt] = useState("");
  const [bg, setBg] = useState<BgOption>("collection");
  const [model, setModel] = useState(IMAGE_MODELS[0].id);
  const [collection, setCollection] = useState(COLLECTIONS[0].id);
  const [style, setStyle] = useState(STYLES[0].id);

  const [status, setStatus] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [result, setResult] = useState<ResultSlideshow[] | null>(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [savedIds, setSavedIds] = useState<string[]>([]);
  // Which result slideshows have the drag editor expanded (first one by default).
  const [editingIdx, setEditingIdx] = useState<Set<number>>(new Set([0]));

  function toggleEditing(i: number) {
    setEditingIdx((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  }

  async function handleGenerate() {
    setStatus("loading");
    setErrorMsg("");
    setResult(null);
    setSavedIds([]);
    try {
      const nicheLabel = GENERATOR_NICHES.find((n) => n.value === niche)?.label ?? niche;
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          niche: nicheLabel.replace(/^[^\p{L}]+/u, "").trim(),
          layout,
          slideCount: Number(slides),
          slideshowCount: Number(shows),
          prompt,
          backgroundMode: bg,
          collection,
          style,
          model,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Generation failed.");
      setResult((data.slideshows as ResultSlideshow[]) ?? []);
      setStatus("done");
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "Generation failed.");
      setStatus("error");
    }
  }

  async function handleSave(id: string) {
    try {
      await saveSlideshow(id);
      setSavedIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "Could not save slideshow.");
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

  const step3Title =
    bg === "collection"
      ? "Select an image collection"
      : bg === "auto"
        ? "Select an image style"
        : "Upload your background image";

  return (
    <div className="pb-4">
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Step 1 — prompt */}
        <StepCard n={1} title="Describe your slideshow">
          <div className="grid grid-cols-2 gap-4">
            <LabeledSelect label="Niche" value={niche} onChange={setNiche} options={GENERATOR_NICHES} />
            <LabeledSelect label="Layout" value={layout} onChange={setLayout} options={LAYOUTS} />
            <LabeledSelect
              label="Number of slides"
              value={slides}
              onChange={setSlides}
              options={SLIDE_COUNTS.map((n) => ({ value: String(n), label: `${n} slides` }))}
            />
            <LabeledSelect
              label="Number of slideshows"
              value={shows}
              onChange={setShows}
              options={SLIDESHOW_COUNTS.map((n) => ({
                value: String(n),
                label: `${n} slideshow${n > 1 ? "s" : ""}`,
              }))}
            />
          </div>

          <div className="mt-4">
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-sm font-medium">Your angle / product</span>
              <button
                type="button"
                className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1 text-xs font-medium text-muted transition-colors hover:border-accent hover:text-accent-text"
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <rect x="3" y="4" width="18" height="16" rx="2" />
                  <path d="M3 9h18" />
                </svg>
                Templates
              </button>
            </div>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={5}
              placeholder="e.g. Our new high-protein meal prep that delivers fresh to your door — first week 50% off."
              className="w-full resize-none rounded-lg border border-border bg-background px-3 py-2.5 text-sm text-foreground placeholder:text-muted transition-colors focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/40"
            />
            <p className="mt-3 text-xs text-muted">Quick start with a pinned template:</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {PINNED_TEMPLATES.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setPrompt(t)}
                  className="rounded-full border border-border bg-card px-3 py-1 text-xs text-muted transition-colors hover:border-accent hover:text-accent-text"
                >
                  {t}
                </button>
              ))}
            </div>
          </div>
        </StepCard>

        {/* Step 2 — image source */}
        <StepCard n={2} title="Choose your images">
          <div className="space-y-3">
            <Selectable
              selected={bg === "collection"}
              onSelect={() => setBg("collection")}
              className={`rounded-xl border p-4 ${bg === "collection" ? "border-accent bg-accent/10" : "border-border bg-card hover:border-accent/50"}`}
            >
              <div className="flex items-start gap-3">
                <RadioDot selected={bg === "collection"} className="mt-0.5" />
                <div className="flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold">Use an image collection</span>
                    <Badge>Recommended</Badge>
                  </div>
                  <p className="mt-0.5 text-sm text-muted">
                    Pick a curated set — we match an image to each slide.
                  </p>
                </div>
              </div>
            </Selectable>

            <div>
              <Selectable
                selected={bg === "auto"}
                onSelect={() => setBg("auto")}
                className={`rounded-xl border p-4 ${bg === "auto" ? "border-accent bg-accent/10" : "border-border bg-card hover:border-accent/50"}`}
              >
                <div className="flex items-start gap-3">
                  <RadioDot selected={bg === "auto"} className="mt-0.5" />
                  <div className="flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-semibold">Auto-generate images</span>
                      <span className="text-xs font-medium text-accent-text">+3 credits / slide</span>
                    </div>
                    <p className="mt-0.5 text-sm text-muted">
                      Generate a unique AI image for every slide.
                    </p>
                  </div>
                </div>
              </Selectable>

              {bg === "auto" ? (
                <div className="ml-7 mt-2 space-y-2 rounded-xl border border-border bg-background/50 p-3">
                  <p className="text-xs font-medium text-muted">Image generation model</p>
                  {IMAGE_MODELS.map((m) => (
                    <Selectable
                      key={m.id}
                      selected={model === m.id}
                      onSelect={() => setModel(m.id)}
                      className={`flex items-center justify-between rounded-lg border p-3 ${model === m.id ? "border-accent bg-accent/10" : "border-border bg-card hover:border-accent/50"}`}
                    >
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold">{m.name}</span>
                          {m.badge ? <Badge>{m.badge}</Badge> : null}
                        </div>
                        <p className="mt-0.5 text-xs text-muted">{m.desc}</p>
                      </div>
                      <RadioDot selected={model === m.id} />
                    </Selectable>
                  ))}
                </div>
              ) : null}
            </div>

            <Selectable
              selected={bg === "single"}
              onSelect={() => setBg("single")}
              className={`rounded-xl border p-4 ${bg === "single" ? "border-accent bg-accent/10" : "border-border bg-card hover:border-accent/50"}`}
            >
              <div className="flex items-start gap-3">
                <RadioDot selected={bg === "single"} className="mt-0.5" />
                <div className="flex-1">
                  <span className="text-sm font-semibold">Use a single image</span>
                  <p className="mt-0.5 text-sm text-muted">One background image for all slides.</p>
                </div>
              </div>
            </Selectable>
          </div>
        </StepCard>
      </div>

      {/* Step 3 — dynamic */}
      <StepCard n={3} title={step3Title} className="mt-6">
        {bg === "collection" ? (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            {COLLECTIONS.map((c, idx) => (
              <Selectable
                key={c.id}
                selected={collection === c.id}
                onSelect={() => setCollection(c.id)}
                className={`overflow-hidden rounded-xl border ${collection === c.id ? "border-accent ring-2 ring-accent/40" : "border-border hover:border-accent/50"}`}
              >
                <div className="grid grid-cols-4">
                  {[0, 1, 2, 3].map((k) => {
                    const src = GYM_IMAGES[(idx * 4 + k) % GYM_IMAGES.length];
                    return (
                      <div
                        key={k}
                        className="aspect-square bg-cover bg-center"
                        style={{ backgroundImage: `url(${src})` }}
                      />
                    );
                  })}
                </div>
                <div className="flex items-center justify-between gap-2 p-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">{c.name}</p>
                    <p className="text-xs text-muted">{c.count} images</p>
                  </div>
                  <RadioDot selected={collection === c.id} />
                </div>
              </Selectable>
            ))}
          </div>
        ) : bg === "auto" ? (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
            {STYLES.map((s) => (
              <Selectable
                key={s.id}
                selected={style === s.id}
                onSelect={() => setStyle(s.id)}
                className={`relative overflow-hidden rounded-xl border ${style === s.id ? "border-accent ring-2 ring-accent/40" : "border-border hover:border-accent/50"}`}
              >
                <div className={`flex aspect-[3/4] items-center justify-center bg-gradient-to-br ${s.gradient} text-4xl`}>
                  <span aria-hidden>{s.emoji}</span>
                </div>
                <RadioDot
                  selected={style === s.id}
                  className="absolute right-2 top-2 bg-black/40 backdrop-blur-sm"
                />
                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-3 pt-8">
                  <p className="text-xs font-semibold text-white">{s.name}</p>
                </div>
              </Selectable>
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-border bg-background/40 px-6 py-14 text-center">
            <span className="grid h-12 w-12 place-items-center rounded-full bg-accent-soft text-xl text-accent-text" aria-hidden>
              ⬆
            </span>
            <p className="mt-4 text-sm font-semibold">Drag &amp; drop an image, or click to browse</p>
            <p className="mt-1 text-xs text-muted">
              PNG or JPG up to 10MB — used as the background for every slide.
            </p>
          </div>
        )}
      </StepCard>

      {/* Error banner */}
      {status === "error" ? (
        <p className="mt-6 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {errorMsg}
        </p>
      ) : null}

      {/* Results */}
      {result && result.length > 0 ? (
        <section className="mt-10">
          <h2 className="text-lg font-bold tracking-tight">Your slideshows</h2>
          <p className="mt-1 text-sm text-muted">
            {result[0]?.persisted
              ? "Saved as drafts — hit “Save to my slideshows” to keep one in your library."
              : "Preview ready. Download any slide, or sign in to save the set to your library."}
          </p>
          <div className="mt-6 space-y-10">
            {result.map((ss, i) => {
              const saved = ss.id ? savedIds.includes(ss.id) : false;
              const canEdit =
                ss.persisted && !!ss.id && ss.slides.every((s) => s.bgUrl);
              const editing = canEdit && editingIdx.has(i);
              return (
                <div key={i}>
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                    <h3 className="text-sm font-semibold text-muted">
                      {ss.title} · {ss.slides.length} slides
                    </h3>
                    <div className="flex items-center gap-2">
                      {ss.persisted && ss.id ? (
                        <>
                          <a
                            href={`/api/slideshows/${ss.id}/zip`}
                            className="rounded-full border border-border bg-card px-3 py-1.5 text-xs font-semibold transition-colors hover:border-accent hover:text-accent-text"
                          >
                            Download all (.zip)
                          </a>
                          {saved ? (
                            <Link
                              href="/dashboard/slideshows"
                              className="rounded-full bg-accent/15 px-3 py-1.5 text-xs font-semibold text-accent-text"
                            >
                              Saved ✓ — View in library
                            </Link>
                          ) : (
                            <button
                              type="button"
                              onClick={() => handleSave(ss.id!)}
                              className="rounded-full bg-accent px-3 py-1.5 text-xs font-semibold text-accent-foreground transition-colors hover:bg-accent-strong"
                            >
                              Save to my slideshows
                            </button>
                          )}
                        </>
                      ) : (
                        <Link
                          href="/login"
                          className="rounded-full border border-border bg-card px-3 py-1.5 text-xs font-semibold transition-colors hover:border-accent hover:text-accent-text"
                        >
                          Sign in to save
                        </Link>
                      )}
                    </div>
                  </div>
                  {canEdit ? (
                    <button
                      type="button"
                      onClick={() => toggleEditing(i)}
                      className="mb-3 inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-xs font-semibold transition-colors hover:border-accent hover:text-accent-text"
                    >
                      {editing ? "← Back to preview" : "✥ Adjust caption positions"}
                    </button>
                  ) : null}
                  {editing ? (
                    <SlideEditor id={ss.id!} initialSlides={toEditorSlides(ss.slides)} />
                  ) : (
                    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
                      {ss.slides.map((sl, j) => (
                        <div key={j} className="overflow-hidden rounded-xl border border-border bg-card">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={sl.url} alt={sl.caption} className="aspect-[9/16] w-full object-cover" />
                          <div className="flex items-center justify-between gap-2 p-2.5">
                            <span className="truncate text-xs text-muted" title={sl.caption}>
                              {j + 1}. {sl.caption}
                            </span>
                            <button
                              type="button"
                              onClick={() => downloadImage(sl.url, `${ss.title || "slide"}-${j + 1}.png`)}
                              className="shrink-0 rounded-md border border-border px-2 py-1 text-[11px] font-semibold transition-colors hover:border-accent hover:text-accent-text"
                            >
                              PNG
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      ) : null}

      {/* Sticky create bar */}
      <div className="sticky bottom-4 z-10 mt-8">
        <div className="flex items-center justify-between gap-4 rounded-full border border-border bg-card/90 p-2 pl-5 shadow-xl backdrop-blur">
          <p className="hidden text-xs sm:block">
            {status === "loading" ? (
              <span className="text-muted">Writing captions &amp; compositing slides…</span>
            ) : bg === "auto" ? (
              <span className="text-muted">Auto-generate (AI images) isn&apos;t enabled yet — pick a collection.</span>
            ) : (
              <span className="text-muted">AI listicle · composited 9:16 PNGs</span>
            )}
          </p>
          <button
            type="button"
            onClick={handleGenerate}
            disabled={status === "loading"}
            className="inline-flex items-center gap-2 rounded-full bg-accent px-6 py-3 text-sm font-semibold text-accent-foreground shadow-lg shadow-accent/25 transition-colors hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-60"
          >
            {status === "loading" ? (
              <>
                <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden>
                  <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.3" strokeWidth="3" />
                  <path d="M22 12a10 10 0 0 1-10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                </svg>
                Generating…
              </>
            ) : (
              <>
                <span aria-hidden>⚡</span>
                Create Slideshow
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
