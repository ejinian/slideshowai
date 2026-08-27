"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import {
  GENERATOR_NICHES,
  DETAIL_LEVELS,
  PINNED_TEMPLATES,
  SLIDE_COUNTS,
} from "@/lib/generator-options";
import { SlideEditor, type EditorSlide } from "@/components/dashboard/slideshows/SlideEditor";
import { TikTokPostButton } from "@/components/dashboard/slideshows/TikTokPostButton";
import { SaveToCameraRoll } from "@/components/dashboard/slideshows/SaveToCameraRoll";
import type { SlideRole } from "@/lib/generate/layout";
import { assessPrompt } from "@/lib/generate/promptStrength";
import {
  takeCollectionPick,
  type CollectionPick,
} from "@/lib/collections-selection";
import { Modal } from "@/components/ui/Modal";

type BgOption = "collection" | "single" | "ai";

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
/** Real provenance from /api/generate — every number is measured, none invented. */
interface DeckProvenance {
  shape: string | null;
  hookType: string | null;
  niche: string | null;
  viewsPerHour: number | null;
  source: "trend" | "reference" | "showcase" | "before_after" | null;
}

/** Display name + the psychology of each canonical hook shape — the "why". */
const SHAPE_INFO: Record<string, { name: string; why: string }> = {
  curiosity_gap: {
    name: "Curiosity-gap",
    why: "it hides the payoff so viewers have to swipe",
  },
  forbidden_secret: {
    name: "Forbidden-secret",
    why: "it feels like something they weren't supposed to see",
  },
  cost_stakes: {
    name: "Stakes",
    why: "it puts something on the line for ignoring it",
  },
  callout: {
    name: "Callout",
    why: "it talks straight at the viewer, which stops the scroll",
  },
  before_after: {
    name: "Before-and-after",
    why: "the transformation makes viewers want the ending",
  },
  outcome_promise: {
    name: "Outcome-promise",
    why: "it leads with the concrete win",
  },
  listicle: {
    name: "Listicle",
    why: "a numbered promise tells viewers exactly what they'll get",
  },
  pov_story: {
    name: "POV",
    why: "a first-person story reads as real, not as an ad",
  },
  price_anchor: {
    name: "Price-anchor",
    why: "a real number makes people stop and compare",
  },
};

function provenanceLine(p: DeckProvenance): string | null {
  if (p.source === "showcase") {
    return "Showcase format — your photos carry the deck, text stays out of the way. How product drops are actually posted.";
  }
  if (p.source === "before_after") {
    return "Before/after format — one slide for the transformation, one for the thing that changed. How real “i went from X to Y” posts are built.";
  }
  if (p.source === "reference") {
    return p.hookType
      ? `Hook copied from your reference's ${p.hookType.toLowerCase()} mechanic.`
      : "Hook copied from your reference's mechanic.";
  }
  const info = p.shape ? SHAPE_INFO[p.shape] : null;
  const name = info?.name ?? (p.hookType || null);
  if (!name) return null;
  const vph =
    p.viewsPerHour && p.viewsPerHour >= 2 ? p.viewsPerHour.toLocaleString() : null;
  const where = vph
    ? `it's what a trending ${p.niche ?? ""} post pulling ${vph} views/hr is running right now`.replace("  ", " ")
    : `it's what's trending in ${p.niche ?? "your niche"} right now`;
  return info
    ? `${name} hook — picked because ${info.why}, and ${where}.`
    : `${name} hook — picked because ${where}.`;
}

interface ResultSlideshow {
  id: string | null;
  title: string;
  persisted: boolean;
  /** "short" | "long" in compare mode; null otherwise. */
  variant?: string | null;
  slides: ResultSlide[];
}

const ROLES: SlideRole[] = ["title", "reason", "plug", "cta"];
const DRAFT_KEY = "slidelabsai_draft";
const AUTO_KEY = "slidelabsai_autoGenerate";
const MAX_UPLOADS = 10;

/** A product page the user pasted a link to, already read by /api/product. */
interface AttachedProduct {
  url: string;
  title: string;
  vendor: string | null;
  priceLabel: string | null;
  /** 1080x1920 JPEG data URLs, ready to use as the deck's photos. */
  images: string[];
  /** The topic brief /api/generate will receive as its prompt. */
  brief: string;
  warnings: string[];
  /** Resolved server-side from the product's SHORT topic line, not the brief. */
  nicheSlug: string | null;
  nicheLabel: string | null;
}

const URL_RE = /https?:\/\/[^\s<>"']+/i;

/** tiktok.com / vm.tiktok.com — routed to the Reference flow, not Product. */
function isTikTokUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === "vm.tiktok.com" || host === "tiktok.com" || host.endsWith(".tiktok.com");
  } catch {
    return false;
  }
}

/** The first http(s) link in the box, if there is one. */
function firstUrl(text: string): string | null {
  const m = text.match(URL_RE);
  if (!m) return null;
  try {
    const u = new URL(m[0].replace(/[.,;)]+$/, ""));
    return u.protocol === "https:" || u.protocol === "http:" ? u.href : null;
  } catch {
    return null;
  }
}

/** A pasted store link. TikTok links are a different feature entirely. */
function findProductUrl(text: string): string | null {
  const u = firstUrl(text);
  return u && !isTikTokUrl(u) ? u : null;
}

/** A pasted TikTok link — "make one like this". */
function findTikTokUrl(text: string): string | null {
  const u = firstUrl(text);
  return u && isTikTokUrl(u) ? u : null;
}

/** Everything the user typed AROUND the link — treated as their own angle. */
function stripUrl(text: string): string {
  return text.replace(URL_RE, " ").replace(/\s+/g, " ").trim();
}

function priceLabel(p: {
  priceMin?: number | null;
  priceMax?: number | null;
  currency?: string | null;
}): string | null {
  if (p.priceMin == null) return null;
  const cur = p.currency === "USD" || !p.currency ? "$" : `${p.currency} `;
  const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2));
  return p.priceMax != null && p.priceMax !== p.priceMin
    ? `${cur}${fmt(p.priceMin)}–${cur}${fmt(p.priceMax)}`
    : `${cur}${fmt(p.priceMin)}`;
}

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

// Everything the ideas dialog retunes when a goal chip is picked. The dialog
// answering the pick — heading, hint, placeholder and shapes all shifting to
// speak that goal's language — is what makes it read as a collaborator rather
// than a form. `null` key = no goal picked. Shapes are DIRECTIONS the planner
// adapts, never text that lands in the composer verbatim.
const GOAL_META: Record<
  string,
  {
    heading: string;
    hint: string | null;
    placeholder: string;
    shapes: [string, string, string];
  }
> = {
  none: {
    heading: "What should we make?",
    hint: null,
    placeholder: "my coffee shop's new menu…",
    shapes: [
      "what my prices actually get you",
      "mistakes first-timers make",
      "a day behind the scenes",
    ],
  },
  sell: {
    heading: "What are we selling?",
    hint: "angles built to convert — the payoff, the price, the proof",
    placeholder: "my lavender candle line…",
    shapes: [
      "what the price actually gets you",
      "3 things to know before buying",
      "how it's actually made",
    ],
  },
  grow: {
    heading: "What keeps them coming back?",
    hint: "angles people return for — series energy, personality, routine",
    placeholder: "my barbershop's daily cuts…",
    shapes: [
      "a day behind the scenes",
      "things i wish i knew starting out",
      "the routine that runs this place",
    ],
  },
  educate: {
    heading: "What do you know cold?",
    hint: "angles with one concrete takeaway someone can use today",
    placeholder: "how i meal prep for the week…",
    shapes: [
      "the exact steps i use",
      "mistakes first-timers make",
      "myths people still believe",
    ],
  },
  entertain: {
    heading: "What's the bit?",
    hint: "angles with surprise and personality — still true to what you do",
    placeholder: "my dog judging my cooking…",
    shapes: [
      "expectation vs reality",
      "things that happen here every day",
      "rating the wildest requests",
    ],
  },
};

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


/* ── AI-decide suggestion shape (from /api/suggest) ────────────────────────── */
interface AiSuggestion {
  niche: string;
  slides: number;
  detail: string;
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
  locked = false,
  lockedHint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  /** Shows the current value but refuses to open — another control owns it. */
  locked?: boolean;
  lockedHint?: string;
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
        disabled={locked}
        title={locked ? lockedHint : undefined}
        onClick={() => setOpen((o) => !o)}
        className={`flex items-center gap-1.5 whitespace-nowrap rounded-full border border-white/10 px-3 py-2 transition-colors ${
          locked ? "cursor-default opacity-50" : "hover:border-white/25"
        }`}
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
  const [detail, setDetail] = useState<string>(DETAIL_LEVELS[0].value);
  const [slides, setSlides] = useState("6");
  const [prompt, setPrompt] = useState("");
  // "single" = Upload (the user's own photos, via the + attach); "collection" =
  // stock photos the app finds. Upload is the default.
  const [bg, setBg] = useState<BgOption>("single");
  // Composer redesign: post goal + optional user photos (used for the first
  // slides; the library fills the rest).
  const [userImages, setUserImages] = useState<string[]>([]);
  // Photo order. The strip already renders userImages in array order — the
  // surprise is that a multi-select FileList arrives in the OS's order, not the
  // order you clicked, so "upload order" alone was never enough. Dragging fixes
  // it, and doing so implies intent: the first drag turns `keepOrder` on, which
  // stops the vision model from resequencing for the hook.
  const [keepOrder, setKeepOrder] = useState(false);
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  function moveImage(from: number, to: number) {
    if (from === to) return;
    setUserImages((cur) => {
      if (to < 0 || to >= cur.length) return cur;
      const next = [...cur];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
    setKeepOrder(true);
    resetSuggestion(false);
  }
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
  const [provenance, setProvenance] = useState<DeckProvenance | null>(null);
  // Which of several returned decks is on screen. Compare mode ("Both") returns
  // two, and multi-variation runs return more; stacking them meant two drag
  // editors mounted at once, two sets of post/download buttons with nothing
  // saying which deck they acted on, and two Regenerate buttons that both
  // rebuilt everything. One at a time, switched by a segmented control.
  const [activeIdx, setActiveIdx] = useState(0);
  // How MANY decks to make, kept separate from Detail (which is the format).
  // "Both — compare" is two decks by definition, so it forces this on and locks
  // it: the switch then exists to explain why you're getting two, not to add a
  // third or fourth. Two decks = 2 credits either way.
  const [twoVersions, setTwoVersions] = useState(false);
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
  // "Get ideas" (né "Let AI decide", reworked 2026-08-13). It used to be a
  // MODE: the pills hid, the arrow silently changed meaning, and plan cards
  // mutated the page under the composer — three surprises, two generate paths.
  // Now it's an ACTION: pressing it opens a dialog where /api/suggest pitches
  // directions from your photos/idea; tapping one FILLS THE COMPOSER (prompt +
  // pills, visibly) and the user presses the one true Generate themselves.
  // Same house rule as the TikTok-reference and product-link flows: AI moves
  // visible controls, the human pulls the trigger. /api/suggest is unchanged.
  const [ideasOpen, setIdeasOpen] = useState(false);
  // Supercharge — the judge-LLM pass over the finished draft. A stronger model
  // reviews captions + the chosen images and fixes what's weak. (No longer
  // exclusive with the ideas dialog — that stopped being a generation path.)
  // superStage reflects the live pipeline step streamed back from
  // /api/generate while it runs.
  const [supercharge, setSupercharge] = useState(false);
  // The full streamed history — rendered exactly like the time-driven log
  // (finished stages stack with checks, the last one shimmers), so both
  // loading paths look identical.
  const [superStages, setSuperStages] = useState<{ stage: string; label: string }[]>([]);
  const superStage = superStages.length ? superStages[superStages.length - 1] : null;
  const SUPER_STAGE_LABELS: Record<string, string> = {
    generating: "Thinking",
    illustrating: "Sourcing images",
    judging: "Judging",
    revising: "Revising",
    finalizing: "Finalizing",
  };
  // Sub-detail line per streamed stage — same voice as genDetails.
  const SUPER_STAGE_DETAILS: Record<string, string> = {
    generating: "Writing the draft against what's trending right now",
    illustrating: "Matching every caption to a photo that actually shows it",
    judging: "A stronger model is reviewing every slide",
    revising: "Applying the judge's fixes",
    finalizing: "Laying your captions onto the slides",
  };
  // Phone-only settings sheet, behind the one-line summary.
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Tooltip over the generate arrow when it's blocked on missing photos.
  const [photoHint, setPhotoHint] = useState(false);
  const [suggestLoading, setSuggestLoading] = useState(false);
  const [suggestError, setSuggestError] = useState("");
  // The planner pitches several directions at once; tapping one applies it to
  // the composer directly, so nothing here is "selected" — `suggestion` (the
  // lead option) only seeds `previous` on a rethink call.
  const [aiOptions, setAiOptions] = useState<AiSuggestion[]>([]);
  const suggestion = aiOptions[0] ?? null;
  // Count of suggestions made this build (0-based round sent to the server).
  const [suggestRound, setSuggestRound] = useState(0);
  const [refineText, setRefineText] = useState("");
  // Goal chip in the ideas dialog — steers which ANGLES the planner pitches
  // (/api/suggest consumes it; it never reaches the generate prompt). Sticky
  // across rethinks in the same build, toggled off by tapping again.
  const [ideaIntent, setIdeaIntent] = useState<string | null>(null);
  // Ideas-dialog thinking narrator — cycles three stage lines while
  // /api/suggest runs, then holds on the last (same trick as the build state).
  // NOTE: the reset to stage 0 happens in handleSuggest, not here — setting
  // state synchronously in an effect body triggers a cascading render.
  const [ideaStage, setIdeaStage] = useState(0);
  useEffect(() => {
    if (!suggestLoading) return;
    const t = setInterval(() => setIdeaStage((i) => Math.min(i + 1, 2)), 1400);
    return () => clearInterval(t);
  }, [suggestLoading]);
  const [isFocused, setIsFocused] = useState(false);
  const [animText, setAnimText] = useState("");
  const animRef = useRef<{
    phase: "typing" | "pausing" | "deleting";
    idx: number;
    charIdx: number;
    timer: ReturnType<typeof setTimeout> | null;
  }>({ phase: "typing", idx: 0, charIdx: 0, timer: null });

  const promptRef = useRef<HTMLTextAreaElement>(null);

  // Example ideas typed by the animated placeholder — shuffled on mount so the
  // box doesn't open on the same one every visit. (These used to also feed a
  // one-tap "Try:" pill; that was removed 2026-08-13, so now they're purely
  // illustrative and never become the prompt without the user typing.)
  const [suggestions, setSuggestions] = useState<string[]>([]);
  useEffect(() => {
    setSuggestions(
      [...PINNED_TEMPLATES].sort(() => Math.random() - 0.5).slice(0, 3),
    );
  }, []);

  // ── Weak-prompt nudge ────────────────────────────────────────────────
  // A bare subject ("cool cars") can only produce slides nobody acts on, so
  // once the user pauses on one we offer sharper angles. Deliberately a nudge,
  // never a gate: Generate stays live the whole time. Detection is local and
  // free (assessPrompt) — the model call only happens if they take us up on it.
  const [debouncedPrompt, setDebouncedPrompt] = useState("");
  const [sharpenOptions, setSharpenOptions] = useState<
    { prompt: string; why: string }[] | null
  >(null);
  const [sharpenBusy, setSharpenBusy] = useState(false);
  const [sharpenError, setSharpenError] = useState<string | null>(null);
  // Keyed by the exact text that was dismissed, so editing the idea brings the
  // nudge back but re-reading the same weak prompt doesn't nag.
  const [sharpenDismissed, setSharpenDismissed] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedPrompt(prompt.trim()), 700);
    return () => clearTimeout(t);
  }, [prompt]);

  // Any edit invalidates suggestions written for the previous wording.
  useEffect(() => {
    setSharpenOptions(null);
    setSharpenError(null);
  }, [debouncedPrompt]);

  const promptStrength = useMemo(
    () => assessPrompt(debouncedPrompt),
    [debouncedPrompt],
  );
  // ── Product link ─────────────────────────────────────────────────────
  // Shopify / TikTok Shop creators paste the product URL straight into the box
  // — there is deliberately NO extra field or mode for this. A link in the
  // prompt IS the input, and everything the deck needs (the real photos, the
  // price, the actual copy) is read off that page.
  // One state object keyed by the URL it belongs to, rather than separate
  // product/busy/error flags. Deriving from `url === linkInPrompt` means
  // clearing the box needs no reset in the effect — a synchronous setState
  // there would cascade an extra render on every keystroke pause.
  const [productState, setProductState] = useState<{
    url: string;
    status: "loading" | "error" | "ready";
    error?: string;
    data?: AttachedProduct;
  } | null>(null);
  // Keyed by URL, same as the sharpen dismissal: removing a product shouldn't
  // have it snap straight back while its link is still sitting in the box.
  const [productDismissed, setProductDismissed] = useState<string | null>(null);
  // What we've already attempted, so the effect can't re-fire on its own writes.
  const attemptedUrlRef = useRef<string | null>(null);

  // The link has its own labelled field, opened from the "+" menu — pasting a
  // URL into the idea box works too, but it's a shortcut, not the affordance.
  const [linkFieldOpen, setLinkFieldOpen] = useState(false);
  const [linkInput, setLinkInput] = useState("");
  const [debouncedLink, setDebouncedLink] = useState("");
  const linkInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedLink(linkInput.trim()), 500);
    return () => clearTimeout(t);
  }, [linkInput]);

  const linkFromField = useMemo(() => findProductUrl(debouncedLink), [debouncedLink]);
  const linkFromPrompt = useMemo(
    () => findProductUrl(debouncedPrompt),
    [debouncedPrompt],
  );
  // The dedicated field wins — it's the explicit request.
  const linkInPrompt = linkFromField ?? linkFromPrompt;
  // Whatever the user typed as their idea, minus the link if it was in there —
  // that's their own angle for the post.
  const linkAngle = useMemo(
    () => (linkFromField ? debouncedPrompt.trim() : stripUrl(debouncedPrompt)),
    [debouncedPrompt, linkFromField],
  );

  // Only ever the state belonging to the link currently in the box.
  const current = productState?.url === linkInPrompt ? productState : null;
  const product = current?.status === "ready" ? (current.data ?? null) : null;
  const productBusy = current?.status === "loading";
  const productError = current?.status === "error" ? (current.error ?? null) : null;

  useEffect(() => {
    if (!linkInPrompt || linkInPrompt === productDismissed) return;
    if (attemptedUrlRef.current === linkInPrompt) return;
    attemptedUrlRef.current = linkInPrompt;

    const url = linkInPrompt;
    const angle = linkAngle;
    let cancelled = false;
    void (async () => {
      setProductState({ url, status: "loading" });
      try {
        const res = await fetch("/api/product", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url, angle }),
        });
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok) {
          setProductState({
            url,
            status: "error",
            error: data?.error ?? "Couldn't read that product page.",
          });
          return;
        }
        setProductState({
          url,
          status: "ready",
          data: {
            url,
            title: data.product.title,
            vendor: data.product.vendor ?? null,
            priceLabel: priceLabel(data.product),
            images: Array.isArray(data.images) ? data.images : [],
            brief: data.brief ?? "",
            warnings: Array.isArray(data.warnings) ? data.warnings : [],
            nicheSlug: data.niche?.slug ?? null,
            nicheLabel: data.niche?.label ?? null,
          },
        });
        // Someone pasting a product link is selling something. Move the pill —
        // visibly, so it stays theirs to change — rather than quietly
      } catch {
        if (!cancelled) {
          setProductState({
            url,
            status: "error",
            error: "Couldn't read that product page.",
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // linkAngle is read once, not tracked: re-scraping the store every time the
    // user adds a word of direction would be wasteful, and the angle is
    // re-applied at generate time anyway.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linkInPrompt, productDismissed]);

  // A product's photos take over the upload path — but ONLY on the upload
  // source. On "Use our photos" they are ignored like any other staged photo,
  // so the deck is stock imagery with the product's copy over it.
  const productImages = product?.images ?? [];
  const useProductPhotos = bg === "single" && productImages.length > 0;

  // ── TikTok reference — "make one like this" ──────────────────────────
  // Paste a TikTok slideshow link and /api/reference reads its slides,
  // distills the FORMAT (hook shape, per-slide beats) and rides it through the
  // same blueprint channel Remix uses. Costs 1 extra credit — the analysis is
  // a vision pass over someone's real post. Same state discipline as Product:
  // one object keyed by URL, dismissal keyed by URL, attempts deduped by ref.
  const [refState, setRefState] = useState<{
    url: string;
    status: "loading" | "error" | "ready";
    error?: string;
    data?: {
      format: Record<string, unknown>;
      /** Used ONLY when the idea box is empty — see lib/reference/tiktok.ts. */
      subject: string | null;
      slideCount: number;
      author: string | null;
      views: number | null;
      hookText: string | null;
    };
  } | null>(null);
  const [refDismissed, setRefDismissed] = useState<string | null>(null);
  const refAttemptedRef = useRef<string | null>(null);
  const [refFieldOpen, setRefFieldOpen] = useState(false);
  const [refInput, setRefInput] = useState("");
  const [debouncedRef, setDebouncedRef] = useState("");
  const refInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedRef(refInput.trim()), 500);
    return () => clearTimeout(t);
  }, [refInput]);

  const refFromField = useMemo(() => findTikTokUrl(debouncedRef), [debouncedRef]);
  const refFromPrompt = useMemo(
    () => findTikTokUrl(debouncedPrompt),
    [debouncedPrompt],
  );
  const refInPlay = refFromField ?? refFromPrompt;

  const currentRef = refState?.url === refInPlay ? refState : null;
  const reference = currentRef?.status === "ready" ? (currentRef.data ?? null) : null;
  const referenceBusy = currentRef?.status === "loading";
  const referenceError = currentRef?.status === "error" ? (currentRef.error ?? null) : null;

  useEffect(() => {
    if (!refInPlay || refInPlay === refDismissed) return;
    if (refAttemptedRef.current === refInPlay) return;
    refAttemptedRef.current = refInPlay;

    const url = refInPlay;
    let cancelled = false;
    void (async () => {
      setRefState({ url, status: "loading" });
      try {
        const res = await fetch("/api/reference", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url }),
        });
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok || !data.reference) {
          setRefState({
            url,
            status: "error",
            error: data?.error ?? "Couldn't read that TikTok post.",
          });
          return;
        }
        setRefState({ url, status: "ready", data: data.reference });
        // Match the reference's length — visibly, on the pill, so it stays the
        // user's to change. Same move as Product nudging the Goal pill.
        const n = Math.max(
          Math.min(data.reference.slideCount, Math.max(...SLIDE_COUNTS)),
          Math.min(...SLIDE_COUNTS),
        );
        setSlides(String(n));
      } catch {
        if (!cancelled) {
          setRefState({ url, status: "error", error: "Couldn't read that TikTok post." });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refInPlay, refDismissed]);

  // Hidden in AI-decide mode — the planner already pitches directions there, so
  // two competing "here's a better idea" surfaces would just be noise. Also
  // hidden while a link is in play: a URL always scores "weak", and offering to
  // rewrite it into a topic would throw the product away.
  const showSharpen =
    !ideasOpen &&
    promptStrength.weak &&
    !linkInPrompt &&
    !refInPlay &&
    sharpenDismissed !== debouncedPrompt;

  async function handleSharpen() {
    setSharpenBusy(true);
    setSharpenError(null);
    try {
      const res = await fetch("/api/sharpen", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: debouncedPrompt }),
      });
      const data = (await res.json()) as {
        options?: { prompt: string; why: string }[];
        error?: string;
      };
      if (!res.ok) throw new Error(data.error || "failed");
      const opts = data.options ?? [];
      if (opts.length === 0) throw new Error("No sharper angle came back.");
      setSharpenOptions(opts);
    } catch (e) {
      setSharpenError(
        e instanceof Error && e.message !== "failed"
          ? e.message
          : "Couldn't sharpen that — try again.",
      );
    } finally {
      setSharpenBusy(false);
    }
  }
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
      if (typeof state.detail === "string" && state.detail) setDetail(state.detail);
      if (typeof state.bg === "string" && state.bg) setBg(state.bg as BgOption);
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
    setSuggestError("");
    setRefineText("");
    if (resetRound) setSuggestRound(0);
  }

  // Ask /api/suggest for directions. `nudge` (from the dialog's refine box)
  // rides along as a change request; the prior plan is sent as `previous` so the
  // model adjusts rather than starts over. Capped at MAX_SUGGESTIONS server-side.
  async function handleSuggest(nudge?: string) {
    if (!isLoggedIn) {
      setShowAuthGate(true);
      return;
    }
    if (suggestLoading) return;
    // Source follows what's actually staged, not the toggle alone: photos make
    // it a vision call; otherwise the typed idea is the whole seed.
    const source: "upload" | "stock" =
      bg === "single" && userImages.length > 0 ? "upload" : "stock";
    // Never fire a hopeless call — with nothing to read, the dialog shows its
    // seed input instead.
    if (source === "stock" && !prompt.trim() && !nudge?.trim()) return;

    setSuggestLoading(true);
    setSuggestError("");
    setIdeaStage(0);
    try {
      const trimmedNudge = nudge?.trim();
      // A nudge is only a "change request" when there's something to change —
      // from the dialog's empty state (no prior options, empty box) the typed
      // text IS the direction, and wrapping it as a correction confused the
      // planner into looking for a plan that doesn't exist.
      const promptForCall = trimmedNudge
        ? prompt.trim() || suggestion
          ? `${prompt.trim()}${prompt.trim() ? "\n\n" : ""}Change requested: ${trimmedNudge}`
          : trimmedNudge
        : prompt;
      const res = await fetch("/api/suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: promptForCall,
          images: source === "upload" ? userImages : undefined,
          source,
          intent: ideaIntent ?? undefined,
          round: suggestRound,
          previous: suggestion
            ? {
                niche: suggestion.niche,
                angle: suggestion.angle,
                slides: suggestion.slides,
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
      setSuggestRound((r) => r + 1);
      setRefineText("");
    } catch (e) {
      setSuggestError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setSuggestLoading(false);
    }
  }

  // Open the ideas dialog on its seed state. Deliberately no auto-fetch even
  // with photos staged: the goal chips + optional direction are the point of
  // the dialog, and firing on open would skip past them before the user ever
  // saw a choice. One tap on the arrow (or a chip/shape) starts the pitch.
  function openIdeas() {
    if (!isLoggedIn) {
      setShowAuthGate(true);
      return;
    }
    setIdeasOpen(true);
  }

  // Tapping a direction fills the composer — prompt in the box, pills snapped
  // to the plan — and hands the wheel back. The user presses Generate. Note
  // the plan's niche is deliberately dropped: with its prompt in the box the
  // server's auto-detect sees the same topic the user does, and there is no
  // visible control a niche override could live behind. `arrowCue` is the
  // one-shot pulse pointing at the button that now finishes the job.
  const [arrowCue, setArrowCue] = useState(false);
  function applySuggestion(opt: AiSuggestion) {
    setPrompt(opt.prompt);
    setSlides(String(opt.slides));
    setDetail(opt.detail);
    setIdeasOpen(false);
    setArrowCue(true);
    promptRef.current?.focus();
  }

  // `override` bypasses the composer state for a caller that carries its own
  // exact config. Since the ideas dialog started writing INTO the composer
  // (2026-08-13) nothing passes it — kept because the no-race shape is what a
  // future one-shot caller needs, and the plumbing below is already wired.
  async function handleGenerate(
    override?: {
      // An explicit niche wins over the server's prompt-derived auto-detect.
      niche?: string;
      slides: string;
      detail: string;
          prompt: string;
    },
    // Diagnostics-only provenance for planned runs (local dumps).
    aiPlan?: Record<string, unknown>,
  ) {
    // A pasted product link replaces the prompt with the brief /api/product
    // built from the real page — the raw URL is worthless as a topic, and the
    // brief carries the price, the copy and the conversion structure. Anything
    // the user typed alongside the link rides along as their own direction.
    // "Let AI decide" (`override`) still wins, as it does everywhere else.
    const productPrompt =
      product && !override
        ? linkAngle
          ? `${product.brief}\n\nThe creator's own direction for this post: ${linkAngle}`
          : product.brief
        : null;

    const forcedTwo = (override?.detail ?? detail) === "both";
    // A TikTok reference link is FORMAT, never topic — strip it from the text
    // so the copy model doesn't see a URL as the subject.
    const ownPrompt =
      reference && refFromPrompt ? stripUrl(prompt) : prompt;
    const eff = {
      slides: override?.slides ?? slides,
      detail: override?.detail ?? detail,
      prompt: productPrompt ?? override?.prompt ?? ownPrompt,
    };
    // The reference's blueprint rides the exact channel Remix already uses.
    // Remix wins if both are somehow in play — it was the more explicit ask.
    const fmt = remixFormat ?? (reference?.format as Record<string, unknown> | undefined) ?? undefined;
    // Explicit niche slug. "Let AI decide" wins; otherwise a pasted product
    // supplies one resolved from its short topic line. Undefined → the server
    // keyword-votes over the prompt, which is only safe for text a human typed.
    const nicheSlug =
      override?.niche ?? (productPrompt ? (product?.nicheSlug ?? undefined) : undefined);
    const nicheLabel = nicheSlug
      ? (GENERATOR_NICHES.find((n) => n.value === nicheSlug)?.label ?? nicheSlug)
          .replace(/^[^\p{L}]+/u, "")
          .trim()
      : undefined;

    if (!isLoggedIn) {
      try {
        localStorage.setItem(
          DRAFT_KEY,
          JSON.stringify({ ...eff, bg, format: fmt }),
        );
        localStorage.setItem(AUTO_KEY, "true");
      } catch {}
      setShowAuthGate(true);
      return;
    }

    setGenStatus("loading");
    setErrorMsg("");
    setResult(null);
    setProvenance(null);
    setSuperStages([]);
    setRestoredFromDraft(false);
    // Restart the loading narrator here rather than in its effect — a
    // synchronous setState in an effect body cascades an extra render.
    setStageIdx(0);

    try {
      const payload = JSON.stringify({
        // Both undefined in manual mode → /api/generate derives the niche from
        // the prompt (lib/generate/nicheDetect.ts).
        niche: nicheLabel,
        detail: eff.detail,
        slideCount: Number(eff.slides),
        slideshowCount: twoVersions || forcedTwo ? 2 : 1,
        prompt: eff.prompt,
        // "Use our photos" means OUR photos, full stop. A product's own images
        // are treated exactly like uploads here: on stock they are dropped
        // rather than silently forcing the image-first path. The product still
        // drives the copy — only the pictures change.
        backgroundMode: bg,
        // AI-decide passes its chosen niche slug (doubles as the image
        // collection id); manual omits it so the server infers it.
        collection: nicheSlug,
        userImages: useProductPhotos
          ? productImages.slice(0, MAX_UPLOADS)
          : userImages.length
            ? userImages
            : undefined,
        // Hard constraint: slide N uses photo N, and the vision model may not
        // resequence for the hook. Deliberately keyed on the user's OWN
        // uploads: a product's gallery isn't an order they chose, so the
        // image-first model stays free to lead with the best hook shot.
        keepPhotoOrder: keepOrder && userImages.length > 1 ? true : undefined,
        // Ids, not bytes. The server reads these from the collections bucket,
        // which is what keeps a big pick from hitting the request-body limit.
        // The WHOLE pick goes up (cap mirrors the server's
        // MAX_COLLECTION_PICK): a big pick is a pool the server's vision pass
        // narrows to the photos that best fit the prompt — not a first-10.
        collectionImageIds: pick ? pick.imageIds.slice(0, 60) : undefined,
        // "Remix this trend" carries the trend's format recipe through.
        format: fmt,
        // Anchors the topic when the box is empty. Ignored server-side the
        // moment the user has typed a real one.
        referenceSubject: reference?.subject ?? undefined,
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
                provenance?: DeckProvenance | null;
                error?: string;
              };
              try {
                evt = JSON.parse(line);
              } catch {
                continue;
              }
              if (evt.type === "stage") {
                const stage = evt.stage ?? "";
                const label =
                  evt.label || SUPER_STAGE_LABELS[stage] || "Working";
                setSuperStages((prev) =>
                  prev.length && prev[prev.length - 1].stage === stage
                    ? prev
                    : [...prev, { stage, label }],
                );
              } else if (evt.type === "result") {
                setResult(evt.slideshows ?? []);
                setProvenance(evt.provenance ?? null);
                setActiveIdx(0);
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
          setSuperStages([]);
        }
        return;
      }

      // Read as text first: a 413/proxy error returns plain text, and calling
      // res.json() on it is what produced `Unexpected token 'R'`.
      const raw = await res.text();

      let data: {
        slideshows?: ResultSlideshow[];
        provenance?: DeckProvenance | null;
        error?: string;
      };
      try {
        data = JSON.parse(raw) as typeof data;
      } catch {
        throw new Error(
          res.status === 413
            ? `Those photos are too large to upload (${mb.toFixed(1)}MB). Try fewer or smaller images.`
            : `Server returned ${res.status} (${ctype || "unknown type"}): ${raw.slice(0, 120)}`,
        );
      }
      if (!res.ok) throw new Error(data?.error || "Generation failed.");
      setResult(data.slideshows ?? []);
      setProvenance(data.provenance ?? null);
      setActiveIdx(0);
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
      setKeepOrder(false);
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

  // ── Dev-only: hold the building state open ───────────────────────────
  // The build UI exists for a few seconds in the middle of a paid generation,
  // which makes it nearly impossible to iterate on — you get one look per
  // credit, and the stage you want has usually already gone by. This pins it
  // open and lets you step the narrator by hand. Gated exactly like the
  // onboarding replay link on /dashboard: development builds only, so it
  // cannot ship. It drives the SAME state the real path does, so what you
  // tune here is what users see.
  const devTools = process.env.NODE_ENV === "development";
  const [previewBuild, setPreviewBuild] = useState(false);

  const isLoading = genStatus === "loading" || previewBuild;
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
    // In the dev preview the stage is stepped by hand — leaving the timers on
    // would drag it forward under you a second after every click.
    if (previewBuild) return;
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
  }, [isLoading, previewBuild]);

  // Upload source with nothing staged: the one blocked state the user can fix
  // in one click, so the arrow points at the fix instead of going dead.
  // A collection pick counts as staged photos — without this the arrow would
  // sit blocked on "add photos" while the picks are visibly right there.
  const pickCount = Math.min(pick?.imageIds.length ?? 0, MAX_UPLOADS);
  // A pasted product brings its own photos, so it satisfies this the same way
  // an upload or a collection pick does.
  const needsPhotos =
    bg === "single" &&
    userImages.length === 0 &&
    pickCount === 0 &&
    productImages.length === 0 &&
    !productBusy;

  // Input-level reasons the Generate arrow is inert (missing prompt / out of
  // AI suggestions). Kept separate from `working` so the button can stay bright
  // and breathing while it works, but dim when there's nothing to run.
  // An attached product IS the brief — it carries the topic, the facts and the
  // CTA — so the idea box stops being required once one resolves. Typing an
  // angle stays optional on top of it.
  const genBlocked = !prompt.trim() && !product && !reference;

  // Shared by the desktop footer controls and the phone picker under the box.
  function setSource(v: BgOption) {
    setBg(v);
    // Switching source discards staged uploads so they don't silently ride
    // along into a stock-photo or AI generation.
    if (v !== "single") {
      setUserImages([]);
      setUploadNote("");
    }
    // The AI plan was built from the old source — start fresh.
    resetSuggestion();
  }
  function toggleSource() {
    setSource(bg === "single" ? "collection" : "single");
  }

  // On Upload the photos decide the deck size (the server enforces one slide
  // per photo), so the count is derived, not chosen. Non-null = derived.
  // A pick BIGGER than a deck is a pool, not a deck — the server narrows it to
  // the Slides pill's count, so the pill stays the user's choice there.
  const poolPick = (pick?.imageIds.length ?? 0) > MAX_UPLOADS;
  const derivedSlides =
    bg === "single" && pickCount > 0 && !poolPick
      ? pickCount
      : bg === "single" && userImages.length > 0
        ? userImages.length
        : null;

  // The deck size being built — the real count when we know it (uploads /
  // chosen count), clamped to a sane 3–10. Feeds the narrator's photo line.
  const rawCount = derivedSlides ?? Number(slides);
  const buildingCount =
    Number.isFinite(rawCount) && rawCount > 0
      ? Math.min(Math.max(rawCount, 3), 10)
      : 6;
  // Creeping determinate fill, driven by the narrator stage; caps below 100 so
  // it never claims "done" before the deck actually lands.
  const genPct = superStages.length
    ? Math.min(12 + superStages.length * 17, 94)
    : Math.min(10 + stageIdx * 14, 94);

  // Per-stage sub-detail shown under the active narrator line — the quiet
  // second voice that makes the build read as real work (which it is: each
  // line names what that pipeline stage actually does). Built at render time
  // because most lines reference the live request.
  const trimmedPrompt = prompt.trim();
  const genDetails: (string | null)[] = [
    trimmedPrompt
      ? `“${trimmedPrompt.slice(0, 48)}${trimmedPrompt.length > 48 ? "…" : ""}”`
      : product
        ? `reading ${product.title}`
        : "reading your photos",
    "pulling this week's highest-velocity hooks",
    "testing angles, keeping the sharpest one",
    bg === "single"
      ? `matching captions to your ${derivedSlides ?? (userImages.length || pickCount || buildingCount)} photos`
      : bg === "ai"
        ? "generating a bespoke image for every caption"
        : "searching live photos for every caption",
    "sizing text so nothing ever cuts off",
    "a final pass over every slide",
    null, // "Almost there" speaks for itself
  ];

  return (
    <>
      {showAuthGate && <AuthGate onClose={() => setShowAuthGate(false)} />}

      {/* ── Dev-only: building-state preview ─────────────────────────────
             Bottom-LEFT, because the onboarding replay link owns bottom-right
             and the Next.js dev indicator sits between them. Not rendered at
             all in a production build. */}
      {devTools && (
        // Desktop-only: on a phone this fixed pill sat on top of the under-box
        // source control and the last shape chip. It's a tuning tool — tune on
        // the wide screen, check the result at 375px without it in the way.
        <div className="fixed bottom-4 left-4 z-50 hidden items-center gap-1 rounded-full border border-white/12 bg-[#141418]/95 p-1 shadow-lg shadow-black/40 backdrop-blur sm:flex">
          <button
            type="button"
            onClick={() => {
              setStageIdx(0);
              setPreviewBuild((v) => !v);
            }}
            aria-pressed={previewBuild}
            className={`rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${
              previewBuild
                ? "bg-accent text-white"
                : "text-white/60 hover:bg-white/[0.06] hover:text-white"
            }`}
          >
            {previewBuild ? "Stop preview" : "Preview building"}
          </button>
          {/* Stepper — the whole point is to sit ON a stage and tune it, which
              the 900–5200ms timers never let you do. */}
          {previewBuild && (
            <>
              <button
                type="button"
                onClick={() => setStageIdx((i) => Math.max(i - 1, 0))}
                disabled={stageIdx === 0}
                aria-label="Previous stage"
                className="grid h-7 w-7 place-items-center rounded-full text-white/60 transition-colors hover:bg-white/[0.06] hover:text-white disabled:opacity-25"
              >
                ‹
              </button>
              <span className="select-none px-1 text-[11px] tabular-nums text-white/40">
                {stageIdx + 1}/{GEN_STAGES.length}
              </span>
              <button
                type="button"
                onClick={() =>
                  setStageIdx((i) => Math.min(i + 1, GEN_STAGES.length - 1))
                }
                disabled={stageIdx >= GEN_STAGES.length - 1}
                aria-label="Next stage"
                className="grid h-7 w-7 place-items-center rounded-full text-white/60 transition-colors hover:bg-white/[0.06] hover:text-white disabled:opacity-25"
              >
                ›
              </button>
              {/* Hands it back to the real 900–5200ms timings, to check the
                  pacing rather than the pixels. */}
              <button
                type="button"
                onClick={() => {
                  setStageIdx(0);
                  setPreviewBuild(false);
                  setGenStatus("loading");
                }}
                title="Run the real stage timings (no API call) — stops at the last stage"
                className="rounded-full px-2.5 py-1.5 text-[11px] font-semibold text-white/60 transition-colors hover:bg-white/[0.06] hover:text-white"
              >
                Play
              </button>
            </>
          )}
          {/* The timed run has no fetch to end it, so it needs its own exit. */}
          {!previewBuild && genStatus === "loading" && (
            <button
              type="button"
              onClick={() => setGenStatus("idle")}
              className="rounded-full px-2.5 py-1.5 text-[11px] font-semibold text-white/60 transition-colors hover:bg-white/[0.06] hover:text-white"
            >
              Stop
            </button>
          )}
        </div>
      )}

      {/* ── "Get ideas" dialog ──────────────────────────────────────────
             The old "Let AI decide" mode, reshaped into an action: directions
             are pitched HERE, and tapping one fills the composer (prompt +
             pills) — the user still presses the one real Generate. Bottom
             sheet on phones, centered on desktop (the Modal does both). */}
      <Modal
        open={ideasOpen}
        onClose={() => setIdeasOpen(false)}
        title="Get ideas"
        width="max-w-2xl"
      >
        {/* Thinking — the same activity-log treatment the build state uses:
            cycling stage lines with the text sweep, over three ghost cards
            shaped like the directions about to land in their place. */}
        {suggestLoading && (
          <div>
            <div
              key={ideaStage}
              className="gen-stage-in flex items-center gap-2.5"
            >
              <span className="relative flex h-2.5 w-2.5 shrink-0">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-60" />
                <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-accent" />
              </span>
              <p className="gen-shimmer-text text-sm font-semibold">
                {
                  [
                    bg === "single" && userImages.length > 0
                      ? `Reading your ${userImages.length === 1 ? "photo" : `${userImages.length} photos`}`
                      : "Reading your idea",
                    "Checking what's trending",
                    "Sketching three angles",
                  ][ideaStage]
                }
                <span className="gen-dots ml-0.5 inline-flex">
                  <span>.</span>
                  <span>.</span>
                  <span>.</span>
                </span>
              </p>
            </div>
            <div className="mt-4 flex flex-col gap-2.5">
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  className="gen-stage-in animate-pulse rounded-xl border border-white/8 bg-white/[0.02] p-4 sm:p-5"
                  style={{ animationDelay: `${i * 120}ms` }}
                >
                  <div className="h-3.5 w-3/5 rounded-full bg-white/10" />
                  <div className="mt-2.5 h-3 w-4/5 rounded-full bg-white/[0.05]" />
                  <div className="mt-3 flex gap-1.5">
                    <div className="h-5 w-16 rounded-full bg-white/[0.05]" />
                    <div className="h-5 w-24 rounded-full bg-white/[0.05]" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Error */}
        {!suggestLoading && suggestError && (
          <div className="flex flex-wrap items-center gap-2 pb-1">
            <p className="text-[13px] text-red-400">{suggestError}</p>
            <button
              type="button"
              onClick={() => void handleSuggest()}
              className="rounded-full border border-white/12 px-3 py-1.5 text-[12px] text-white/60 transition-colors hover:border-white/25 hover:text-white"
            >
              Try again
            </button>
          </div>
        )}

        {/* Nothing to read yet — ask for the hint instead of firing blind.
            Styled as a tiny composer of its own (sparkle hero, card input,
            accent ↑, tappable shapes) so the empty state reads as the start
            of something, not a bare form. */}
        {!suggestLoading && !suggestError && aiOptions.length === 0 && (() => {
          const meta = GOAL_META[ideaIntent ?? "none"] ?? GOAL_META.none;
          const hasPhotos = bg === "single" && userImages.length > 0;
          return (
          <div className="relative">
            {/* Soft aurora behind the hero — the dialog's one glow. */}
            <div
              aria-hidden
              className="pointer-events-none absolute -left-10 -top-12 h-44 w-72 rounded-full bg-accent/15 blur-3xl"
            />
            <div className="relative flex items-center gap-4">
              <span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-indigo-500/40 via-fuchsia-500/25 to-rose-500/25 text-accent-text ring-1 ring-white/10">
                <svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor" aria-hidden className="animate-pulse">
                  <path d="M12 2l1.9 5.7a2 2 0 0 0 1.3 1.3L21 11l-5.8 2a2 2 0 0 0-1.3 1.3L12 20l-1.9-5.7A2 2 0 0 0 8.8 13L3 11l5.8-2a2 2 0 0 0 1.3-1.3L12 2z" />
                </svg>
              </span>
              <div className="min-w-0">
                {/* Keyed on the goal so every retune replays the fade — the
                    dialog visibly answers the chip you just pressed. */}
                <p key={meta.heading} className="gen-stage-in text-lg font-semibold text-white">
                  {meta.heading}
                </p>
                <p className="mt-0.5 text-[13px] leading-relaxed text-white/40">
                  {hasPhotos
                    ? `I'll read your ${userImages.length === 1 ? "photo" : `${userImages.length} photos`} and pitch three angles — add a direction if you have one.`
                    : bg === "single"
                      ? "Add photos to the composer, or toss me a rough direction — I'll pitch three angles."
                      : "Toss me a rough direction — I'll pitch three angles."}
                </p>
              </div>
            </div>

            {/* Goal chips — single-select, tap again to clear. This steers
                which angles get pitched; the planner consumes it and the
                returned prompts embody it (never a "Goal:" line — that's the
                drift bug the old composer Goal pill died of). */}
            <div className="relative mt-5 flex flex-wrap gap-2">
              {[
                {
                  value: "sell",
                  label: "Sell a product",
                  icon: <path d="M20.6 13.4 11 3.8A2 2 0 0 0 9.6 3.2H5a2 2 0 0 0-2 2v4.6a2 2 0 0 0 .6 1.4l9.6 9.6a2 2 0 0 0 2.8 0l4.6-4.6a2 2 0 0 0 0-2.8zM7.5 8.5a1 1 0 1 1 0-2 1 1 0 0 1 0 2z" />,
                },
                {
                  value: "grow",
                  label: "Grow my following",
                  icon: <path d="M3 17l6-6 4 4 7-8M16 7h5v5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />,
                },
                {
                  value: "educate",
                  label: "Educate",
                  icon: <path d="M12 3 2 8l10 5 8-4v6h2V8L12 3zM6 12.5V16c0 1.7 2.7 3 6 3s6-1.3 6-3v-3.5l-6 3-6-3z" />,
                },
                {
                  value: "entertain",
                  label: "Entertain",
                  icon: <path d="M12 2l1.9 5.7a2 2 0 0 0 1.3 1.3L21 11l-5.8 2a2 2 0 0 0-1.3 1.3L12 20l-1.9-5.7A2 2 0 0 0 8.8 13L3 11l5.8-2a2 2 0 0 0 1.3-1.3L12 2z" />,
                },
              ].map((intent) => {
                const on = ideaIntent === intent.value;
                return (
                  <button
                    key={intent.value}
                    type="button"
                    onClick={() => setIdeaIntent(on ? null : intent.value)}
                    aria-pressed={on}
                    className={`inline-flex items-center gap-1.5 rounded-full border px-4 py-2 text-[13px] font-medium transition-all ${
                      on
                        ? "border-accent/60 bg-accent/20 text-white shadow-[0_0_18px_rgba(99,102,241,0.3)]"
                        : "border-white/10 bg-white/[0.02] text-white/55 hover:border-white/25 hover:text-white"
                    }`}
                  >
                    <svg
                      width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden
                      className={on ? "text-accent-text" : "text-white/35"}
                    >
                      {intent.icon}
                    </svg>
                    {intent.label}
                  </button>
                );
              })}
            </div>

            {/* The confirmation whisper — what picking that goal just changed */}
            {meta.hint && (
              <p key={meta.hint} className="gen-stage-in mt-2.5 text-[12px] text-accent-text/80">
                {meta.hint}
              </p>
            )}

            <div className="mt-3 flex items-center gap-2 rounded-2xl bg-white/[0.04] p-2.5 pl-4 ring-1 ring-white/[0.06] transition-shadow focus-within:ring-accent/40">
              <input
                value={refineText}
                onChange={(e) => setRefineText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (refineText.trim() || hasPhotos)) {
                    e.preventDefault();
                    void handleSuggest(refineText);
                  }
                }}
                // The dialog exists to collect exactly this input — but only
                // focus it where that doesn't cost anything: on a phone,
                // autofocus pops the keyboard over the goal chips, hiding the
                // first decision. The dialog only mounts client-side (open on
                // interaction), so reading matchMedia at render is safe.
                autoFocus={
                  typeof window !== "undefined" &&
                  window.matchMedia("(min-width: 640px)").matches
                }
                placeholder={
                  hasPhotos
                    ? "optional — an angle for your photos…"
                    : meta.placeholder
                }
                aria-label="Rough direction"
                className="min-w-0 flex-1 bg-transparent text-base text-white placeholder:text-white/25 focus:outline-none"
              />
              <button
                type="button"
                onClick={() => void handleSuggest(refineText)}
                // With photos staged the photos ARE the seed, so the arrow is
                // live on an empty box.
                disabled={!refineText.trim() && !hasPhotos}
                aria-label="Get directions"
                className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-accent text-white transition-all hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-35"
              >
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M12 19V5M5 12l7-7 7 7" />
                </svg>
              </button>
            </div>

            {/* Proven shapes as one-tap seeds, retuned per goal. These are
                DIRECTIONS the planner adapts, never text that lands in the
                composer verbatim (the removed Try pill's mistake). */}
            <p className="mt-5 text-[12px] font-semibold uppercase tracking-wide text-white/25">
              Or start from a shape
            </p>
            <div className="mt-2.5 flex flex-wrap gap-2">
              {meta.shapes.map((shape, i) => (
                <button
                  // Keyed by slot so a goal switch remounts and replays the
                  // stagger — the row visibly deals new cards.
                  key={`${ideaIntent ?? "none"}-${i}`}
                  type="button"
                  onClick={() => void handleSuggest(shape)}
                  style={{ animationDelay: `${i * 70}ms` }}
                  className="gen-stage-in rounded-full border border-white/10 bg-white/[0.02] px-4 py-2 text-[13px] text-white/60 transition-colors hover:border-accent/50 hover:bg-accent/[0.08] hover:text-white"
                >
                  {shape}
                </button>
              ))}
            </div>
          </div>
          );
        })()}

        {/* Directions */}
        {!suggestLoading && aiOptions.length > 0 && (
          <>
            <p className="text-[13px] text-white/40">
              Tap one — it fills the composer, and you hit Generate.
            </p>
            <div className="mt-4 flex flex-col gap-2.5">
              {aiOptions.map((opt, i) => (
                <button
                  key={`${opt.angle}-${i}`}
                  type="button"
                  onClick={() => applySuggestion(opt)}
                  // Staggered entrance — the cards land one after another in
                  // the ghost cards' places, so the fetch reads as arriving.
                  style={{ animationDelay: `${i * 110}ms` }}
                  className="gen-stage-in group rounded-xl border border-white/8 bg-white/[0.02] p-4 text-left transition-all hover:border-accent/50 hover:bg-accent/[0.06] sm:p-5"
                >
                  <span className="flex items-start justify-between gap-3">
                    <span className="block text-[16px] font-semibold leading-snug text-white">
                      {opt.angle}
                    </span>
                    {/* The invitation — quiet until the card is hovered */}
                    <svg
                      width="17" height="17" viewBox="0 0 24 24" fill="none"
                      stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
                      aria-hidden
                      className="mt-0.5 shrink-0 -translate-x-1 text-white/15 transition-all group-hover:translate-x-0 group-hover:text-accent-text"
                    >
                      <path d="M5 12h14M12 5l7 7-7 7" />
                    </svg>
                  </span>
                  {opt.rationale && (
                    <span className="mt-1 block text-[13px] leading-relaxed text-white/45">
                      {opt.rationale}
                    </span>
                  )}
                  <span className="mt-2.5 flex flex-wrap items-center gap-1.5">
                    {/* The planner orders best-first — say so, on the card. */}
                    {i === 0 && (
                      <span className="rounded-full border border-accent/40 bg-accent/15 px-2.5 py-1 text-[11px] font-semibold text-accent-text">
                        Best fit
                      </span>
                    )}
                    {[
                      `${opt.slides} slides`,
                      DETAIL_LEVELS.find((d) => d.value === opt.detail)?.label ??
                        opt.detail,
                    ].map((chip) => (
                      <span
                        key={chip}
                        className="rounded-full border border-white/8 bg-white/[0.03] px-2.5 py-1 text-[11px] text-white/45"
                      >
                        {chip}
                      </span>
                    ))}
                  </span>
                </button>
              ))}
            </div>

            {/* Rethink — max 3 rounds per build, same cap as before */}
            {suggestRound < MAX_SUGGESTIONS ? (
              <div className="mt-4 rounded-xl border border-dashed border-white/12 p-4">
                <p className="text-[13px] text-white/45">
                  None of these? Describe your own direction
                </p>
                <div className="mt-2.5 flex items-center gap-2">
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
                    className="min-w-0 flex-1 border-b border-white/10 bg-transparent pb-1.5 text-sm text-white transition-colors placeholder:text-white/25 focus:border-white/25 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => void handleSuggest(refineText)}
                    disabled={!refineText.trim() || suggestLoading}
                    className="shrink-0 rounded-full border border-white/12 px-4 py-2 text-[13px] text-white/60 transition-colors hover:border-white/25 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Rethink
                  </button>
                </div>
                {suggestRound === MAX_SUGGESTIONS - 1 && (
                  <p className="mt-2 text-[12px] text-white/25">1 rethink left</p>
                )}
              </div>
            ) : (
              <p className="mt-4 text-[13px] text-white/30">
                Last set — tap one, or close and write your own.
              </p>
            )}
          </>
        )}
      </Modal>

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
                onClick={() => setSupercharge((v) => !v)}
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

            <SheetGroup title="Detail">
              {DETAIL_LEVELS.map((d) => (
                <SheetRow
                  key={d.value}
                  active={detail === d.value}
                  onClick={() => setDetail(d.value)}
                >
                  {d.label}
                </SheetRow>
              ))}
            </SheetGroup>

            <SheetGroup title="Versions">
              {[1, 2].map((n) => (
                <SheetRow
                  key={n}
                  active={(twoVersions || detail === "both" ? 2 : 1) === n}
                  onClick={() => {
                    // "Both" is locked at two — ignore the tap rather than
                    // letting the sheet disagree with what actually generates.
                    if (detail !== "both") setTwoVersions(n === 2);
                  }}
                >
                  {n === 1 ? "1 slideshow" : "2 slideshows · 2 credits"}
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
              <span className="font-semibold text-white">
                {pick.imageIds.length}
              </span>{" "}
              {pick.imageIds.length === 1 ? "photo" : "photos"} from{" "}
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
            {pick.thumbs.length > MAX_UPLOADS && (
              <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg bg-white/[0.06] text-xs font-semibold text-white/50 ring-1 ring-white/10">
                +{pick.thumbs.length - MAX_UPLOADS}
              </div>
            )}
          </div>
          {/* A pick bigger than a deck is a pool: the server's vision pass
              chooses the best-fitting photos for each prompt. */}
          {pick.imageIds.length > MAX_UPLOADS && (
            <p className="mt-2 text-xs text-white/40">
              AI picks the photos that best fit your prompt from all{" "}
              {pick.imageIds.length}.
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
            Always visible: the ideas dialog writes INTO these, so hiding them
            would hide the very state it just set. */}
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
              label="Detail"
              value={detail}
              onChange={setDetail}
              options={DETAIL_LEVELS.map((d) => ({ value: d.value, label: d.label }))}
            />
            <DropdownSelect
              label="Versions"
              value={twoVersions || detail === "both" ? "2" : "1"}
              onChange={(v) => setTwoVersions(v === "2")}
              options={[
                { value: "1", label: "1 slideshow" },
                { value: "2", label: "2 slideshows" },
              ]}
              // "Both — compare" is two decks by definition. Shown locked at 2
              // rather than hidden, so the 2-credit cost is visible and the
              // reason for it is one hover away.
              locked={detail === "both"}
              lockedHint={"\"Both — compare\" always makes two"}
            />
          </div>

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
                  void handleGenerate();
                }
              }}
              rows={1}
              placeholder=""
              aria-label="Describe your slideshow idea"
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
                {product ? (
                  // The product is the brief. Typing rotating topic ideas here
                  // would say the opposite — that the box still has to be filled.
                  <span>Optional — add an angle, or just hit generate…</span>
                ) : (
                  <>
                    <span>{animText}</span>
                    <span className="animate-cursor ml-px inline-block h-[1.15em] w-px translate-y-px bg-white/35" />
                  </>
                )}
              </div>
            )}
          </div>

          {/* ── Product link ────────────────────────────────────────────
                 Opened from the "+" menu. Pasting a URL into the idea box above
                 also works and opens this same section, so there is exactly one
                 place the product ever appears. */}
          {(linkFieldOpen || !!linkInPrompt) && (
            <div className="rounded-xl bg-white/[0.03] p-2">
              <div className="flex items-center justify-between gap-2 px-1.5 pb-1">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-white/35">
                  Add product link
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setLinkFieldOpen(false);
                    setLinkInput("");
                    setDebouncedLink("");
                    if (linkInPrompt) setProductDismissed(linkInPrompt);
                  }}
                  aria-label="Remove product link"
                  className="-m-1.5 grid h-8 w-8 shrink-0 place-items-center rounded-full text-white/35 transition-colors hover:text-white"
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden>
                    <path d="M6 6l12 12M18 6L6 18" />
                  </svg>
                </button>
              </div>

              <input
                ref={linkInputRef}
                type="url"
                inputMode="url"
                autoComplete="off"
                spellCheck={false}
                value={linkInput}
                onChange={(e) => setLinkInput(e.target.value)}
                placeholder="https://yourstore.com/products/…"
                aria-label="Product link"
                className="w-full rounded-lg bg-white/[0.04] px-3 py-2 text-[13px] text-white placeholder:text-white/25 focus:outline-none focus:ring-1 focus:ring-white/15"
              />

              <p className="px-1.5 pt-1.5 text-[11px] leading-snug text-white/30">
                Shopify product pages work best — we read the real photos, price
                and description.
              </p>

              {productBusy && (
                <div className="flex items-center gap-2 px-1.5 pt-2 text-[12px] text-white/40">
                  <svg className="animate-spin" width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden>
                    <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.5" opacity="0.25" />
                    <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
                  </svg>
                  Reading that product page…
                </div>
              )}

              {productError && (
                <p className="px-1.5 pt-2 text-[12px] leading-snug text-amber-300/80">
                  {productError}
                </p>
              )}

              {product && (
                <div className="mt-2 rounded-lg bg-white/[0.04] p-1.5">
                  <div className="flex items-center gap-2.5">
                    {product.images[0] ? (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img
                        src={product.images[0]}
                        alt=""
                        className="h-10 w-10 shrink-0 rounded-md object-cover"
                      />
                    ) : null}
                    <div className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-medium leading-snug text-white">
                        {product.title}
                      </span>
                      <span className="block truncate text-[11px] leading-snug text-white/35">
                        {[
                          product.vendor,
                          product.priceLabel,
                          // On stock the product's photos are not used at all,
                          // so advertising a count here would be a lie.
                          useProductPhotos
                            ? `${product.images.length} photo${product.images.length === 1 ? "" : "s"}`
                            : "using our photos",
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    </div>
                  </div>
                  {/* The warnings are all about photo supply, so they are moot
                      when the deck is being built from stock anyway. */}
                  {useProductPhotos && product.warnings.length > 0 && (
                    <p className="px-1 pt-1.5 text-[11px] leading-snug text-white/30">
                      {product.warnings.join(" ")}
                    </p>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ── TikTok reference — "make one like this" ─────────────────
                 The ONE deliberately vibrant element in the composer: it draws
                 an extra credit (a vision pass over a real post), and the
                 gradient is the price tag made visible. Everything else in
                 this card stays muted so this reads as the special move. */}
          {(refFieldOpen || !!refInPlay) && (
            <div className="rounded-xl bg-gradient-to-r from-indigo-500 via-fuchsia-500 to-rose-400 p-[1.5px]">
              <div className="rounded-[10px] bg-[#141416] p-2">
                <div className="flex items-center justify-between gap-2 px-1.5 pb-1">
                  <span className="bg-gradient-to-r from-indigo-300 via-fuchsia-300 to-rose-300 bg-clip-text text-[11px] font-semibold uppercase tracking-wide text-transparent">
                    Make one like this
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="rounded-full bg-white/[0.06] px-2 py-0.5 text-[10px] font-medium text-white/45">
                      2 credits
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        setRefFieldOpen(false);
                        setRefInput("");
                        setDebouncedRef("");
                        if (refInPlay) setRefDismissed(refInPlay);
                      }}
                      aria-label="Remove TikTok reference"
                      className="-m-1.5 grid h-8 w-8 shrink-0 place-items-center rounded-full text-white/35 transition-colors hover:text-white"
                    >
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden>
                        <path d="M6 6l12 12M18 6L6 18" />
                      </svg>
                    </button>
                  </span>
                </div>

                <input
                  ref={refInputRef}
                  type="url"
                  inputMode="url"
                  autoComplete="off"
                  spellCheck={false}
                  value={refInput}
                  onChange={(e) => setRefInput(e.target.value)}
                  placeholder="https://www.tiktok.com/@creator/photo/…"
                  aria-label="TikTok reference link"
                  className="w-full rounded-lg bg-white/[0.04] px-3 py-2 text-[13px] text-white placeholder:text-white/25 focus:outline-none focus:ring-1 focus:ring-fuchsia-400/30"
                />

                <p className="px-1.5 pt-1.5 text-[11px] leading-snug text-white/30">
                  Paste a slideshow you wish you&apos;d made. We study its hook and
                  structure, then build yours the same way. Add your own topic
                  above, or leave it blank to stay in the same territory.
                </p>

                {referenceBusy && (
                  <div className="flex items-center gap-2 px-1.5 pt-2 text-[12px] text-fuchsia-200/70">
                    <svg className="animate-spin" width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden>
                      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.5" opacity="0.25" />
                      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
                    </svg>
                    Studying that post&apos;s slides…
                  </div>
                )}

                {referenceError && (
                  <p className="px-1.5 pt-2 text-[12px] leading-snug text-amber-300/80">
                    {referenceError} No credits were used.
                  </p>
                )}

                {reference && (
                  <div className="mt-2 rounded-lg bg-white/[0.04] p-2">
                    <span className="block text-[13px] font-medium leading-snug text-white">
                      {reference.author ? `@${reference.author}` : "That post"}
                      {reference.format?.hookType
                        ? ` · ${String(reference.format.hookType)}`
                        : ""}
                    </span>
                    {reference.hookText && (
                      <span className="mt-0.5 block truncate text-[11px] italic leading-snug text-white/40">
                        &ldquo;{reference.hookText}&rdquo;
                      </span>
                    )}
                    <span className="mt-0.5 block text-[11px] leading-snug text-white/35">
                      {reference.slideCount} slides
                      {typeof reference.views === "number" && reference.views > 0
                        ? ` · ${Intl.NumberFormat("en", { notation: "compact" }).format(reference.views)} views`
                        : ""}
                      {stripUrl(prompt).trim()
                        ? " \u00b7 yours will follow this structure"
                        : reference.subject
                          ? ` \u00b7 yours: ${reference.subject}`
                          : " \u00b7 yours will follow this structure"}
                    </span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Attachments. Every PHOTO affordance below is Upload-source only, so
              a user's photos can never silently ride along into a stock
              generation. The band itself still renders on stock because the
              "+" also reaches Product link, which is about the product's COPY
              as much as its pictures and is valid in either source. */}
          {/* With nothing staged this whole band is just "+ 0/10 Add a photo",
             so on phones it collapses into the footer's empty left slot (the
             ⌘↵ hint there is desktop-only). CSS-hidden rather than unmounted —
             the file inputs below live in here and the footer button clicks
             one of them. Once photos exist the thumbnails need the room and it
             comes back on every width. */}
          <div
            className={`flex-wrap items-center gap-2 ${
              userImages.length === 0 ? "hidden sm:flex" : "flex"
            }`}
          >
            {bg === "single" && userImages.map((src, i) => (
              <div
                key={i}
                // Drag is the desktop interaction; the ‹ › buttons below are the
                // touch one (HTML5 drag-and-drop does not fire on touch).
                draggable
                onDragStart={() => setDragIndex(i)}
                onDragEnd={() => setDragIndex(null)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  if (dragIndex !== null) moveImage(dragIndex, i);
                  setDragIndex(null);
                }}
                className={`group/thumb relative h-14 w-14 shrink-0 overflow-hidden rounded-lg border transition-all ${
                  dragIndex === i
                    ? "border-accent opacity-40"
                    : "border-white/12 hover:border-white/30"
                } cursor-grab active:cursor-grabbing`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={src} alt="" className="h-full w-full object-cover" />
                {/* Position badge — the whole point is that the order is
                    visible, so it never reads as a random pile. Top-LEFT because
                    the ‹ › controls sit along the bottom edge and are always
                    visible on touch; bottom-left buried the number behind ‹. */}
                <span className="pointer-events-none absolute left-0.5 top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-black/75 px-1 text-[10px] font-bold text-white">
                  {i + 1}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setUserImages((prev) => prev.filter((_, j) => j !== i));
                    setUploadNote("");
                  }}
                  aria-label={`Remove photo ${i + 1}`}
                  className="absolute right-0.5 top-0.5 grid h-4 w-4 place-items-center rounded-full bg-black/70 text-white transition-colors hover:bg-black"
                >
                  <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" aria-hidden>
                    <path d="M18 6L6 18M6 6l12 12" />
                  </svg>
                </button>
                {/* Touch/keyboard reorder. Always available on phones; on
                    desktop it stays out of the way until you hover. */}
                {userImages.length > 1 && (
                  <span className="absolute inset-x-0 bottom-0 flex justify-between opacity-100 transition-opacity sm:opacity-0 sm:group-hover/thumb:opacity-100">
                    <button
                      type="button"
                      onClick={() => moveImage(i, i - 1)}
                      disabled={i === 0}
                      aria-label={`Move photo ${i + 1} earlier`}
                      className="grid h-4 w-4 place-items-center bg-black/70 text-[11px] leading-none text-white disabled:opacity-25"
                    >
                      ‹
                    </button>
                    <button
                      type="button"
                      onClick={() => moveImage(i, i + 1)}
                      disabled={i === userImages.length - 1}
                      aria-label={`Move photo ${i + 1} later`}
                      className="grid h-4 w-4 place-items-center bg-black/70 text-[11px] leading-none text-white disabled:opacity-25"
                    >
                      ›
                    </button>
                  </span>
                )}
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
                  {bg === "single" && (
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
                  )}
                  {bg === "single" && (
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
                  )}
                  {/* Collections need a session — guests only get local files. */}
                  {isLoggedIn && bg === "single" && (
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
                  {/* Reading a store page is a server call, so it needs a session
                      the same way Collections does. */}
                  {isLoggedIn && (
                    <button
                      type="button"
                      onClick={() => {
                        setAddMenuOpen(false);
                        setLinkFieldOpen(true);
                        // The field mounts this render; focus on the next frame.
                        requestAnimationFrame(() => linkInputRef.current?.focus());
                      }}
                      className="flex w-full items-center gap-2.5 px-4 py-2.5 text-sm text-white/70 transition-colors hover:bg-white/6 hover:text-white"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                        <path d="M10 13a5 5 0 0 0 7.07 0l3-3A5 5 0 0 0 13 3l-1.5 1.5" />
                        <path d="M14 11a5 5 0 0 0-7.07 0l-3 3A5 5 0 0 0 11 21l1.5-1.5" />
                      </svg>
                      Product link
                    </button>
                  )}
                  {/* The special move — gradient label matches its section. */}
                  {isLoggedIn && (
                    <button
                      type="button"
                      onClick={() => {
                        setAddMenuOpen(false);
                        setRefFieldOpen(true);
                        requestAnimationFrame(() => refInputRef.current?.focus());
                      }}
                      className="flex w-full items-center gap-2.5 px-4 py-2.5 text-sm transition-colors hover:bg-white/6"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="url(#ref-grad)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                        <defs>
                          <linearGradient id="ref-grad" x1="0" y1="0" x2="24" y2="24" gradientUnits="userSpaceOnUse">
                            <stop stopColor="#818cf8" />
                            <stop offset="0.5" stopColor="#e879f9" />
                            <stop offset="1" stopColor="#fb7185" />
                          </linearGradient>
                        </defs>
                        <path d="M9 18V5l12-2v13" />
                        <circle cx="6" cy="18" r="3" />
                        <circle cx="18" cy="16" r="3" />
                      </svg>
                      <span className="whitespace-nowrap bg-gradient-to-r from-indigo-300 via-fuchsia-300 to-rose-300 bg-clip-text font-medium text-transparent">
                        Make one like this
                      </span>
                      <span className="ml-auto whitespace-nowrap pl-3 text-[10px] text-white/30">TikTok link</span>
                    </button>
                  )}
                </div>
              )}

            </div>

            {/* Upload counter — makes the 10-photo cap obvious up front */}
            {bg === "single" && (
            <span className="text-[12px] tabular-nums text-white/30">
              {userImages.length}/{MAX_UPLOADS}
            </span>
            )}
            {bg === "single" && userImages.length === 0 && (
              <span className="text-[12px] text-white/35">
                {product
                  ? // The product already supplied the deck's photos, so this
                    // must not still read as a requirement.
                    "Add your own photos too, or generate with the product's"
                  : "Add a photo to generate"}
              </span>
            )}
            {/* Short decks are a valid choice, not a mistake — say what will
                happen and get out of the way. Deliberately the same quiet grey
                as the other hints: nothing here is an error. */}
            {bg === "single" && userImages.length > 0 && userImages.length <= 3 && (
              <span className="text-[12px] text-white/35">
                {userImages.length === 1
                  ? "1 photo — you'll get a single-slide post. Add more for a listicle."
                  : `${userImages.length} photos — you'll get a short ${userImages.length}-slide post. Add more for a listicle.`}
              </span>
            )}
            {/* Ordering. The hint teaches the interaction; the toggle turns the
                order into a hard constraint the generator must honour. Dragging
                flips it on by itself, so most people never touch it. */}
            {userImages.length > 1 && (
              <>
                <button
                  type="button"
                  onClick={() => setKeepOrder((v) => !v)}
                  aria-pressed={keepOrder}
                  title="Use my photos in this exact order, one per slide"
                  className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-medium transition-colors ${
                    keepOrder
                      ? "bg-accent/20 text-accent-text"
                      : "text-white/35 hover:bg-white/[0.06] hover:text-white/70"
                  }`}
                >
                  <span
                    aria-hidden
                    className={`grid h-3.5 w-3.5 shrink-0 place-items-center rounded-[4px] border ${
                      keepOrder ? "border-accent bg-accent text-white" : "border-white/25"
                    }`}
                  >
                    {keepOrder && (
                      <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M20 6L9 17l-5-5" />
                      </svg>
                    )}
                  </span>
                  Keep this order
                </button>
                {!keepOrder && (
                  <span className="text-[12px] text-white/30">
                    Drag to reorder
                  </span>
                )}
              </>
            )}
            {uploadNote && (
              <span className="text-[12px] text-amber-300/80">{uploadNote}</span>
            )}

            {bg === "single" && (
            <>
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
            </>
            )}
          </div>

          {/* Get ideas + Supercharge. Desktop only — on phones the
              Claude-style box carries its controls inside the bottom edge and
              the two text links sit under the card. (The "Try:" suggestion
              pill lived here until 2026-08-13 — its cross-niche templates
              read as odd one-tap prompts, and pinning example topics next to
              Generate implied the app only makes decks like those. The
              animated placeholder still shows ideas, but nothing is a click
              away from becoming the user's prompt.) */}
          <div className="hidden flex-wrap items-center gap-2 sm:flex">
            <button
              type="button"
              onClick={openIdeas}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-accent/35 bg-accent/10 px-3.5 py-1.5 text-[13px] font-semibold text-accent-text transition-colors hover:bg-accent/20"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                <path d="M12 2l1.9 5.7a2 2 0 0 0 1.3 1.3L21 11l-5.8 2a2 2 0 0 0-1.3 1.3L12 20l-1.9-5.7A2 2 0 0 0 8.8 13L3 11l5.8-2a2 2 0 0 0 1.3-1.3L12 2z" />
              </svg>
              Get ideas
            </button>
            <button
              type="button"
              onClick={() => {
                setSupercharge((v) => !v);
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
            {supercharge && (
              <span className="text-[12px] text-white/30">
                A stronger model reviews the draft and fixes what&apos;s weak.
              </span>
            )}
          </div>
        </div>

        {/* Control row — on phones this is the Claude composer's bottom edge:
            attach, settings and the AI toggle on the left, send on the right,
            all inside the box. On desktop it stays the old footer. */}
        <div className="flex items-center justify-between gap-2 pt-1 sm:gap-3 sm:px-6 sm:pb-5 sm:pt-0">
          {/* Keyboard hint is desktop-only — there's no ⌘↵ on a phone, and it
              wrapped to two lines there. */}
          <span className="hidden text-[13px] text-white/30 sm:inline">
            {"⌘↵"} to generate
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
                // h-10/px-3 so the icon-only state is a 40px circle like every
                // other control in this row. py-2.5 made it 36px and 2px lower
                // than its neighbours — visibly the odd one out.
                className="flex h-10 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-full bg-white/[0.07] px-3 text-[13px] text-white transition-colors active:bg-white/[0.12] min-[430px]:pr-3.5"
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
            {(
              <button
                type="button"
                onClick={() => setSettingsOpen(true)}
                // Below 360px the visible text collapses to a bare number, so
                // the pill carries its own name for screen readers there.
                aria-label={`Settings — ${derivedSlides ?? slides} slides`}
                className="flex h-10 shrink-0 items-center gap-1 whitespace-nowrap rounded-full bg-white/[0.07] px-3.5 text-[13px] text-white transition-colors active:bg-white/[0.12]"
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
              onClick={openIdeas}
              aria-label="Get ideas"
              className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-white/[0.07] text-accent-text transition-colors active:bg-white/[0.12]"
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
              id="ai-images-toggle"
              type="button"
              role="switch"
              aria-checked={bg === "ai"}
              aria-label="Use AI images"
              title="Generate a bespoke AI image per slide (1 credit per 5 slides)"
              onClick={() => setSource(bg === "ai" ? "single" : "ai")}
              className={`hidden shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1.5 text-[13px] transition-colors sm:flex ${
                bg === "ai"
                  ? "bg-accent/15 text-accent-text"
                  : "text-white/40 hover:text-white/80"
              }`}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                <path d="M12 2l1.9 5.7a2 2 0 0 0 1.3 1.3L21 11l-5.8 2a2 2 0 0 0-1.3 1.3L12 20l-1.9-5.7A2 2 0 0 0 8.8 13L3 11l5.8-2a2 2 0 0 0 1.3-1.3L12 2z" />
              </svg>
              AI images
            </button>
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
                void handleGenerate();
              }}
              // `working` covers the generate/plan spinner; genBlocked is the
              // input-level dead states (see their defs above).
              disabled={working || genBlocked}
              // Upload source means "use MY photos" — dimmed like a disabled
              // control, but still clickable so it can explain itself.
              aria-disabled={needsPhotos}
              onMouseEnter={() => needsPhotos && setPhotoHint(true)}
              onMouseLeave={() => setPhotoHint(false)}
              aria-label="Generate"
              // `arrowCue` fires once right after the ideas dialog fills the
              // composer — pointing at the button that now finishes the job.
              onAnimationEnd={() => setArrowCue(false)}
              className={`grid h-10 w-10 shrink-0 place-items-center rounded-full bg-accent text-white transition-all hover:brightness-110 disabled:cursor-not-allowed sm:h-11 sm:w-11 sm:shadow-[0_8px_24px_rgba(122,110,255,0.35)] ${
                working
                  ? "gen-btn-breathe" // stays bright + pulses while it works
                  : genBlocked || needsPhotos
                    ? "opacity-40"
                    : arrowCue
                      ? "gen-arrow-cue"
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

      {/* ── Weak-prompt nudge ────────────────────────────────────────
             Sits under the box and never blocks Generate. Collapsed it's one
             muted line; the model is only called if the user taps through. */}
      {showSharpen && (
        <div role="status" className="mt-3">
          {sharpenOptions ? (
            <div className="rounded-2xl bg-white/[0.03] p-1.5">
              <div className="flex items-center justify-between gap-2 px-2 py-0.5">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-white/35">
                  Sharper angles
                </span>
                <button
                  type="button"
                  onClick={() => setSharpenDismissed(debouncedPrompt)}
                  aria-label="Dismiss suggestions"
                  className="-m-1.5 grid h-8 w-8 shrink-0 place-items-center rounded-full text-white/35 transition-colors hover:text-white"
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden>
                    <path d="M6 6l12 12M18 6L6 18" />
                  </svg>
                </button>
              </div>
              {sharpenOptions.map((o) => (
                <button
                  key={o.prompt}
                  type="button"
                  onClick={() => {
                    setPrompt(o.prompt);
                    setSharpenOptions(null);
                    promptRef.current?.focus();
                  }}
                  className="block w-full rounded-xl px-2.5 py-2 text-left transition-colors hover:bg-white/[0.05] active:bg-white/[0.07]"
                >
                  <span className="block text-[13px] leading-snug text-white">
                    {o.prompt}
                  </span>
                  {o.why ? (
                    <span className="mt-0.5 block text-[11px] leading-snug text-white/35">
                      {o.why}
                    </span>
                  ) : null}
                </button>
              ))}
            </div>
          ) : (
            <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 px-2 text-[13px]">
              <span className="text-white/40">
                {sharpenError ?? promptStrength.reason}
              </span>
              <button
                type="button"
                onClick={handleSharpen}
                disabled={sharpenBusy}
                className="font-semibold text-accent-text transition-opacity hover:opacity-80 disabled:opacity-50"
              >
                {sharpenBusy ? "Thinking…" : "Sharpen it"}
              </button>
              <button
                type="button"
                onClick={() => setSharpenDismissed(debouncedPrompt)}
                className="text-white/25 transition-colors hover:text-white/50"
              >
                Dismiss
              </button>
            </div>
          )}
        </div>
      )}

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
            { value: "ai" as const, label: "AI images" },
          ].map((opt) => (
            <button
              key={opt.value}
              type="button"
              role="radio"
              aria-checked={bg === opt.value}
              onClick={() => bg !== opt.value && setSource(opt.value)}
              // min-h-9 inside the p-1 track puts the whole segmented control
              // at 44px — py-1.5 alone gave 31px tap targets.
              className={`flex min-h-9 items-center rounded-full px-4 text-[13px] transition-all duration-200 ${
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
          {/* Header: Claude-style activity log — finished stages stack up with
              checks and dim; the active line shimmers, with the stage's real
              sub-detail beneath it. The log growing IS the progress signal. */}
          <div className="px-6 py-6 sm:px-8">
            {/* Progress rail on top — the first thing the eye lands on, and
                the log grows away from it instead of pushing it down. */}
            <div className="relative mb-5 h-1 w-full overflow-hidden rounded-full bg-white/8">
              <div
                className="absolute inset-y-0 left-0 rounded-full bg-accent transition-[width] duration-700 ease-out"
                style={{ width: `${genPct}%` }}
              />
              <div className="gen-rail-glow absolute inset-y-0 w-1/3 rounded-full bg-linear-to-r from-transparent via-white/50 to-transparent" />
            </div>
            <div className="space-y-2">
              {/* Finished stages (time-driven path only — Supercharge streams
                  its own real stages and shows just the live one). */}
              {(superStage
                ? superStages.slice(0, -1).map((x) => x.label)
                : GEN_STAGES.slice(0, Math.min(stageIdx, GEN_STAGES.length - 1))
              ).map((s) => (
                  <div
                    key={s}
                    className="gen-stage-in flex items-center gap-2.5 text-[13px] text-white/35"
                  >
                    <span className="flex w-4 shrink-0 justify-center">
                      <svg
                        viewBox="0 0 16 16"
                        fill="none"
                        className="h-3.5 w-3.5 text-accent/80"
                        aria-hidden
                      >
                        <path
                          d="M3.5 8.5 6.5 11.5 12.5 5"
                          stroke="currentColor"
                          strokeWidth="1.8"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    </span>
                    <span>{s}</span>
                  </div>
                ))}

              {/* Active line — keyed so each new stage re-mounts and fades up */}
              <div
                key={superStage?.stage ?? stageIdx}
                className="gen-stage-in flex items-center gap-2.5"
              >
                <span className="flex w-4 shrink-0 justify-center">
                  <span className="relative flex h-2.5 w-2.5">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-60" />
                    <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-accent" />
                  </span>
                </span>
                <p className="gen-shimmer-text text-sm font-semibold">
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

              {/* The active stage's sub-detail — what this step is actually doing */}
              {(superStage
                ? SUPER_STAGE_DETAILS[superStage.stage]
                : genDetails[Math.min(stageIdx, genDetails.length - 1)]) && (
                <p
                  key={superStage ? `sd${superStage.stage}` : `d${stageIdx}`}
                  className="gen-stage-in pl-[26px] text-xs text-white/30"
                >
                  {superStage
                    ? SUPER_STAGE_DETAILS[superStage.stage]
                    : genDetails[Math.min(stageIdx, genDetails.length - 1)]}
                </p>
              )}
            </div>
          </div>

          {/* No skeleton cards. The filmstrip always sliced its last card off
              at the edge, and the stacked-deck replacement looked worse — so
              the activity log and the progress rail ARE the loading state.
              Simple, and nothing to overflow. */}
        </div>
      )}

      {/* ── Results ──────────────────────────────────────────────── */}
      {result && result.length > 0 && (
        <div className="mt-10 space-y-6">
          {result.map((ss, i) => {
            // Others stay in `result` (so switching is instant and caption edits
            // survive) but are unmounted — a SlideEditor loads every slide image.
            if (i !== activeIdx) return null;
            const canEdit = ss.persisted && !!ss.id && ss.slides.every((s) => s.bgUrl);

            return (
              <div
                key={i}
                className="animate-generate overflow-hidden rounded-2xl border border-white/8 bg-[#0a0a0a]"
              >
                {/* Header. The status line and Regenerate share the top row, so
                    the TITLE gets the full width beneath them — sitting it
                    beside the button squeezed it into a narrow column and a
                    six-word headline wrapped onto four lines at 375px. */}
                <div className="px-4 py-5 sm:px-8 sm:py-6">
                  <div className="flex items-center justify-between gap-3">
                    {result.length > 1 ? (
                      <div className="flex min-w-0 items-center gap-0.5 rounded-full bg-white/[0.04] p-0.5">
                        {result.map((opt, k) => (
                          <button
                            key={k}
                            type="button"
                            onClick={() => setActiveIdx(k)}
                            aria-pressed={k === activeIdx}
                            className={`shrink-0 rounded-full px-3 py-1.5 text-[12px] font-medium transition-colors ${
                              k === activeIdx
                                ? "bg-accent text-white"
                                : "text-white/45 hover:text-white/80"
                            }`}
                          >
                            {opt.variant === "short"
                              ? "Short"
                              : opt.variant === "long"
                                ? "Long"
                                : `Option ${k + 1}`}
                          </button>
                        ))}
                      </div>
                    ) : (
                      <p className="text-[10px] font-semibold uppercase tracking-widest text-white/25">
                        Ready to post
                      </p>
                    )}
                    <button
                      type="button"
                      onClick={() => void handleGenerate()}
                      disabled={isLoading}
                      className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-white/8 bg-white/4 px-3 py-1.5 text-xs text-white/40 transition-colors hover:border-white/20 hover:text-white disabled:opacity-40"
                    >
                      {/* Was a bare "↻" glyph, which renders at a different
                          weight and baseline to every other control. */}
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                        <path d="M21 2v6h-6M3 12a9 9 0 0 1 15-6.7L21 8M3 22v-6h6M21 12a9 9 0 0 1-15 6.7L3 16" />
                      </svg>
                      Regenerate
                    </button>
                  </div>
                  <h3 className="mt-2 text-lg font-bold leading-tight text-white sm:text-xl">
                    {ss.title}
                  </h3>
                  <p className="mt-1 text-xs text-white/30">
                    {ss.slides.length} slides
                    {result.length > 1 && " · both saved to your library"}
                  </p>
                  {/* Why this deck — real provenance only (sampled hook shape +
                      the source post's measured velocity, plus what the
                      Supercharge judge actually did). No invented stats: a
                      "% better" claim waits on the scoring estimator
                      (docs/hook-scoring.md, step B). */}
                  {provenance && provenanceLine(provenance) && (
                    <div className="mt-3 rounded-xl bg-white/[0.03] px-3.5 py-2.5">
                      <p className="flex items-start gap-2 text-xs leading-snug text-white/60">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="mt-0.5 shrink-0 text-accent">
                          <path d="M23 6l-9.5 9.5-5-5L1 18" />
                          <path d="M17 6h6v6" />
                        </svg>
                        <span>{provenanceLine(provenance)}</span>
                      </p>
                    </div>
                  )}
                </div>

                {/* Preview + caption editor (editable), or a simple filmstrip
                    for the logged-out / legacy case. */}
                {canEdit ? (
                  <div className="px-4 pb-8 sm:px-8">
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
                  <div className="flex gap-3 overflow-x-auto px-4 pb-6 no-scrollbar sm:px-8">
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
                <div className="flex flex-wrap items-center gap-2 border-t border-white/5 px-4 py-4 sm:px-8">
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
                        /* No returnTo: fall back to the button's own default,
                           /dashboard/slideshows/<id>. This result card lives in
                           CLIENT state on /dashboard, so coming back to
                           /dashboard after the OAuth round-trip lands on an
                           empty composer and the deck the user just made is
                           gone — even though it was persisted and has an id.
                           The detail view is the same deck, and the callback's
                           ?tiktok_connected=1 reopens the post modal there. */
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
