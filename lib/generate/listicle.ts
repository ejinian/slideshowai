import OpenAI from "openai";
import type { RunLogger } from "./diagnostics";
// SlideRole lives in the pure layout module (no server deps) so the client-side
// drag editor can share it. Re-exported here to keep existing import sites working.
import type { SlideRole } from "./layout";
import { scanDeckForAiLingo } from "./aiLingo";
import {
  frameworkBlock,
  shortDeckPlan,
  SHORT_DECK_MAX,
} from "./captionFrameworks";

// Server-only. Generates a TikTok Photo Mode "listicle" per slideshow:
//   title (numbered hook) → N numbered reasons (one is a native product plug) → CTA.
// Uses OpenAI structured outputs; validates + retries once; then enforces the
// role/number structure by position so compositing styling is always correct.

export type { SlideRole };

export interface ListicleSlide {
  role: SlideRole;
  number: number | null;
  text: string;
  /** 3-5 concrete visual words describing the ideal background photo. */
  imageKeywords?: string[];
  /** Optional paragraph under the heading. Short decks (1-3) only. */
  body?: string | null;
}

/** A trending post's format recipe, passed through from "Remix this trend" so
 *  the deck mirrors the trend's MECHANIC instead of just its vibe. */
export interface FormatBlueprint {
  /** 1-3 word format label, e.g. "Before and after", "Gatekeep listicle". */
  hookType?: string | null;
  /** The trend's own caption — the strongest style exemplar available. */
  exemplarCaption?: string | null;
  /** Slide-by-slide beats ("1" → "Hook — …", "2-5" → "Proof — …"). */
  anatomy?: { slides: string; beat: string }[] | null;
}

export interface ListicleRequest {
  niche: string;
  description: string; // the user's "angle / product" box
  slideCount: number;
  slideshowCount: number;
  /** Pre-rendered block of real trending hooks for this niche (may be ""). */
  exemplars?: string;
  /** Static curated hook-formula bank for slide 1 (may be "" / undefined). */
  hooks?: string;
  /** Present only on remixes: the specific trend's format to transplant. */
  format?: FormatBlueprint | null;
}

interface Structure {
  count: number;
  reasonCount: number;
  /** Role per slide index. The single source of truth for the deck's shape. */
  roles: SlideRole[];
}

// If the user's topic states a list count ("3 exercises", "5 tips"), that number
// is their intent for how many value slides they want — honor it instead of
// letting the slide-count dropdown force a contradicting headline number
// ("3 ways" rendering as "4"). Returns the desired value-slide count (2..8), or
// null when the topic has no explicit listicle count.
const LIST_NOUNS =
  "ways?|tips?|reasons?|mistakes?|things?|steps?|exercises?|foods?|habits?|" +
  "signs?|lessons?|rules?|hacks?|secrets?|myths?|examples?|ideas?|benefits?|" +
  "facts?|moves?|drills?|stretches?|recipes?|traits?|questions?";
export function explicitListCount(text: string): number | null {
  const m = text.match(new RegExp(`\\b(\\d{1,2})\\s+(?:${LIST_NOUNS})\\b`, "i"));
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return n >= 2 && n <= 8 ? n : null;
}

// reasonCount = slideCount - 2 (title + cta). There is no plug slide: forcing a
// mandatory ad slot made the model fill it with junk (it parroted the user's
// topic verbatim) whenever there was no product to sell.
// Decks of 1-2 slides are a different FORMAT, not a shorter listicle: there is
// no list to number and (at 1) nothing to swipe to, so "title + reasons + cta"
// has no meaning. They get their own shapes. 3+ is unchanged.
export function listicleStructure(slideCount: number): Structure {
  const count = Math.min(Math.max(Math.floor(slideCount) || 6, 1), 10);
  if (count === 1) return { count, reasonCount: 0, roles: ["title"] };
  if (count === 2) return { count, reasonCount: 0, roles: ["title", "cta"] };
  const reasonCount = count - 2;
  return {
    count,
    reasonCount,
    roles: [
      "title",
      ...Array<SlideRole>(reasonCount).fill("reason"),
      "cta",
    ],
  };
}

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    slides: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          role: { type: "string", enum: ["title", "reason", "plug", "cta"] },
          number: { type: ["integer", "null"] },
          text: { type: "string" },
          image_keywords: { type: "array", items: { type: "string" } },
        },
        required: ["role", "number", "text", "image_keywords"],
      },
    },
  },
  required: ["slides"],
} as const;

// Short decks (1-3 slides) additionally return a `body` paragraph per slide.
// A SEPARATE schema on purpose: adding `body` to the shared one would change the
// request payload — and therefore the output distribution — for 4+ listicle
// decks, which must stay byte-identical.
const SHORT_SCHEMA = (() => {
  const base = JSON.parse(JSON.stringify(SCHEMA)) as Record<string, unknown>;
  const slideItems = findSlideItems(base);
  if (slideItems) {
    (slideItems.properties as Record<string, unknown>).body = {
      type: ["string", "null"],
    };
    (slideItems.required as string[]).push("body");
  }
  return base;
})();

/** Locate the per-slide object schema regardless of the wrapper shape. */
function findSlideItems(
  node: unknown,
): { properties: Record<string, unknown>; required: string[] } | null {
  if (!node || typeof node !== "object") return null;
  const n = node as Record<string, unknown>;
  const props = n.properties as Record<string, unknown> | undefined;
  if (props && "text" in props && "image_keywords" in props) {
    return {
      properties: props,
      required: n.required as string[],
    };
  }
  for (const v of Object.values(n)) {
    const found = findSlideItems(v);
    if (found) return found;
  }
  return null;
}

const SYSTEM =
  "You are a world-class TikTok Photo Mode strategist for small businesses. You " +
  "write slideshows engineered to STOP THE SCROLL and get watched to the last slide.\n" +
  "THE USER'S TOPIC DRIVES EVERYTHING. The entire slideshow must deliver on the " +
  "topic they give (e.g. topic \"3 exercises to build a bigger chest\" → the hook " +
  "and every slide are about chest exercises). NEVER swap in a generic niche " +
  "template (\"X mistakes you're making\") when the user gave a real topic, and " +
  "never bury their topic on a single slide.\n" +
  "ANATOMY:\n" +
  "• SLIDE 1 IS THE HOOK and it decides everything — a pattern-interrupt built from " +
  "the topic: a bold/contrarian claim, a sharp curiosity gap, a callout, or a " +
  "specific promise. Never a soft intro. If slide 1 is boring, nothing else matters.\n" +
  "• EACH MIDDLE SLIDE delivers one concrete piece of the topic and earns the next " +
  "swipe.\n" +
  "• THE LAST SLIDE is a short, soft call to action.\n" +
  "VOICE — sound like a real creator, not a brand:\n" +
  "• NO exclamation marks. None.\n" +
  "• No Title Case headlines — write the way a person texts (sentence case).\n" +
  "• Ban clichés and filler: \"you're probably making\", \"did you know\", \"here's " +
  "why\", \"stay consistent\", \"game-changer\", \"unlock\", \"elevate\", \"level up\".\n" +
  "• BANNED FILLER OPENERS — these announce that a vague statement is coming and " +
  "are the fastest way to sound like a bot: \"it's all about X\", \"it all comes " +
  "down to X\", \"the key is X\", \"the secret is X\", \"X is your secret weapon\", " +
  "\"X seals the deal\", \"X is key\", \"X is a must\". Name the thing directly instead: not " +
  "\"it's all about body fat percentage\" but \"your body fat has to get to " +
  "10-15% before abs show\".\n" +
  "MODERN VOICE, NOT 2015 YOUTUBE. The single fastest way to look AI-written is " +
  "to sound like a thumbnail from ten years ago. Two registers:\n" +
  "  DATED (never write like this): \"2 fast ways to reveal your abs pronto\", " +
  "\"protein-packed meals are your secret weapon\", \"want more tips like " +
  "these? follow for the latest gym hacks\", \"focus on high-intensity " +
  "cardio\". Breathless, generic, selling.\n" +
  "  MODERN (write like this): \"most of you are eating 40g of protein and " +
  "calling it a high protein day\", \"i ate 180g of protein a day for 8 weeks, " +
  "here is what actually changed\", \"walk at 12 incline for 30 minutes, that " +
  "is the whole cardio plan\". Flat, specific, said once.\n" +
  "The modern register states a fact or an opinion and stops. It does not " +
  "hype, does not promise, does not ask a rhetorical question, and never " +
  "calls anything a hack, a secret or a game-changer. Understatement reads " +
  "as confidence; enthusiasm reads as an ad.\n" +
  "CALL-TO-ACTION WORDING. Banned outright, they read as machine-written: " +
  "\"follow me for the real stuff\", \"follow for the real ones\", \"the real " +
  "stuff\", \"drop a follow\", \"hit that follow\", \"you won't regret it\". Use " +
  "plain, ordinary phrasing instead: \"follow for more tips\", \"follow for more " +
  "[topic] tips\", \"more of these on my page\".\n" +
  "• NEVER use an em dash (—) or en dash (–). Real people type a comma, a full " +
  "stop, or start a new line. An em dash in a caption is the clearest possible " +
  "tell that a machine wrote it.\n" +
  "• NO EXPLAINER COLON. Never write a label, a colon, then the explanation " +
  "(banned: \"the shift: niche content was the difference\", \"the result: more " +
  "followers\", \"my strategy: post daily\"). Say the thing directly instead. A " +
  "colon is only allowed when it IS the joke or opens a list the next slide " +
  "answers — \"everyone: stop chasing views\", \"reasons i'm not viral yet:\".\n" +
  "• Short lines (most under ~12 words). No hashtags. NEVER use emojis — the " +
  "caption font has no emoji glyphs, so any emoji bakes onto the slide as an empty " +
  "box. Be concrete, specific, and a little contrarian.\n" +
  "NO AD SLIDE. Every middle slide is pure value delivering the topic. Never insert " +
  "a promo/product slide, and never restate the topic as if it were a product.\n" +
  "For EVERY slide also return image_keywords: 3-5 concrete VISUAL words describing " +
  "the ideal candid background photo for that slide's message (subjects, objects, " +
  "settings, mood — e.g. [\"bench press\", \"barbell\", \"dark gym\"]). Describe a " +
  "photographable scene, never abstract concepts, text, or people's emotions alone.";

// The remix blueprint, rendered as a prompt section. The trend's caption
// outranks the generic niche exemplars (it's the exact post being remixed),
// and each anatomy beat's JOB is mapped onto the deck's own slide plan.
function formatBlock(f: FormatBlueprint): string {
  const lines: string[] = [
    "REMIX A TRENDING FORMAT — transplant this trend's MECHANIC onto the topic below (its structure and psychology, NEVER its subject or wording):",
  ];
  if (f.hookType) lines.push(`• Format: ${f.hookType}`);
  if (f.exemplarCaption) {
    lines.push(
      `• The trend's own caption (your #1 style exemplar — beat it, don't copy it): "${f.exemplarCaption}"`,
    );
  }
  const beats = f.anatomy ?? [];
  if (beats.length > 0) {
    lines.push(
      "• Its slide-by-slide anatomy — give each of your slides the SAME JOB the matching beat does:",
      ...beats.map((b) => `   slides ${b.slides}: ${b.beat}`),
    );
  }
  lines.push(
    "Keep the exact slide roles/numbering required below; the blueprint shapes WHAT each slide does, not the output format.",
  );
  return lines.join("\n");
}

function buildUser(
  req: ListicleRequest,
  s: Structure,
  variant: number,
): string {
  const framework = frameworkBlock(s.count);
  return (
    (req.exemplars ? `${req.exemplars}\n\n` : "") +
    // The hook bank teaches scroll-stopping OPENERS. A one-slide post has no
    // slide 2 to open a loop toward — the framework below fully replaces it, and
    // running both would hand the model contradictory instructions.
    (req.hooks && s.count > 1 ? `${req.hooks}\n\n` : "") +
    (req.format ? `${formatBlock(req.format)}\n\n` : "") +
    (framework ? `${framework}\n\n` : "") +
    `Niche: ${req.niche}\n` +
    `TOPIC — what this WHOLE slideshow must be about: ${
      req.description ||
      "(no topic given — pick the single most scroll-stopping, specific angle for this niche and build the whole slideshow around it)"
    }\n\n` +
    (req.exemplars
      ? "Match or beat the trending examples above in specificity and scroll-stopping " +
        "power (borrow the STYLE, not the words).\n\n"
      : "") +
    // 1-3 slides are their own formats, not shrunken listicles. 4+ keeps the
    // original wording verbatim.
    (s.count <= SHORT_DECK_MAX
      ? shortDeckPlan(s.count)
      : `Build EXACTLY ${s.count} slides, in order:\n` +
        `1. role "title", number ${s.reasonCount}: the HOOK for the TOPIC above — ` +
        `scroll-stopping and specific, clearly about the topic (not a generic niche cliché). ` +
        `The headline number MUST be ${s.reasonCount} to match the ${s.reasonCount} value slides.\n` +
        `2. Slides 2–${s.count - 1}: role "reason", numbered 1..${s.reasonCount}. Each delivers ONE concrete point of the topic. There is NO ad or product slide — every one of these is pure value.\n` +
        `3. Slide ${s.count}: role "cta", number null: a short, soft call to action (e.g. "follow for more" or "link in bio"). If the topic states a goal (e.g. "Goal of this post: Grow followers"), the CTA must serve that exact goal — for "Grow followers", ask for the follow.\n`) +
    (variant > 0
      ? `\nThis is variation #${variant + 1}; choose a different hook angle than the other variations.`
      : "")
  );
}

// No `plug` role any more — every middle slide is a value "reason". (SlideRole
// still permits "plug" so previously-stored slideshows keep rendering.)
function expectedRole(i: number, s: Structure): SlideRole {
  return s.roles[i] ?? "reason";
}

function isValid(raw: ListicleSlide[], s: Structure): boolean {
  if (raw.length !== s.count) return false;
  for (let i = 0; i < s.count; i++) {
    if (raw[i]?.role !== s.roles[i]) return false;
  }
  // The hook must state the list count — but only when there IS a list worth
  // counting. A 1-2 slide post has no reasons at all, and a 3-slide post has
  // exactly one, where a numbered hook ("the 1 thing that…") reads as broken and
  // the framework explicitly asks for an unnumbered beat instead. Requiring the
  // number there would reject every good short-deck hook.
  if (s.reasonCount < 2) return true;
  return new RegExp(`\\b${s.reasonCount}\\b`).test(raw[0]?.text ?? "");
}

function fallbackText(role: SlideRole, number: number | null): string {
  // number === null on a title means a 1-2 slide post: there's no list to count.
  if (role === "title") {
    return number == null
      ? "here's the one thing nobody tells you"
      : `${number} things to know`;
  }
  if (role === "cta") return "Try it free → link in bio";
  return `Reason ${number ?? ""}`.trim();
}

// Enforce role + number by position; keep the model's text (in order).
function normalize(raw: ListicleSlide[], s: Structure): ListicleSlide[] {
  const out: ListicleSlide[] = [];
  for (let i = 0; i < s.count; i++) {
    const role = expectedRole(i, s);
    // Short decks carry NO numbers anywhere (see isValid). Critically this
    // includes the reason slide: layoutSlide bakes a reason's number inline
    // ("1. …"), which would turn a 3-slide turn like "nobody's watching" into
    // "1. nobody's watching" and destroy the mechanic.
    const numbered = s.reasonCount >= 2;
    const number =
      role === "title"
        ? numbered
          ? s.reasonCount
          : null
        : role === "cta"
          ? null
          : numbered
            ? i
            : null;
    const text = (raw[i]?.text ?? "").trim() || fallbackText(role, number);
    // Body is a short-deck feature; on a 4+ listicle it is dropped even if the
    // model volunteers one, so those decks render exactly as they always have.
    const body =
      s.count <= SHORT_DECK_MAX
        ? (raw[i]?.body ?? "").toString().trim() || null
        : null;
    out.push({
      role,
      number,
      text,
      imageKeywords: raw[i]?.imageKeywords ?? [],
      body,
    });
  }
  return out;
}

function isNetworkError(err: unknown): boolean {
  if (!(err instanceof TypeError)) return false;
  const msg = (err as TypeError).message ?? "";
  if (msg.includes("fetch failed") || msg.includes("network")) return true;
  const cause = (err as TypeError & { cause?: unknown }).cause;
  if (cause instanceof Error) {
    const code = (cause as Error & { code?: string }).code ?? "";
    return (
      code.startsWith("UND_ERR") ||
      code === "ECONNRESET" ||
      code === "ECONNREFUSED" ||
      code === "ETIMEDOUT"
    );
  }
  return false;
}

async function callOpenAI(
  openai: OpenAI,
  system: string,
  user: string,
  count: number,
  attempt = 0,
): Promise<ListicleSlide[]> {
  let completion;
  try {
    completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "listicle",
          strict: true,
          schema: count <= SHORT_DECK_MAX ? SHORT_SCHEMA : SCHEMA,
        },
      },
    });
  } catch (err) {
    if (err instanceof OpenAI.APIError) {
      if (err.status === 429 || err.code === "insufficient_quota") {
        throw new Error(
          "OpenAI quota exceeded (429). Add credits/billing to your OpenAI account at platform.openai.com → Billing. Each slideshow costs roughly a cent or two.",
        );
      }
      if (err.status === 401) {
        throw new Error(
          "OpenAI rejected the API key (401). Double-check OPENAI_API_KEY in .env.local.",
        );
      }
      throw new Error(`OpenAI request failed (${err.status}): ${err.message}`);
    }
    // Transient network error (socket reset, connection drop, etc.) — retry once
    if (isNetworkError(err) && attempt === 0) {
      await new Promise((r) => setTimeout(r, 1500));
      return callOpenAI(openai, system, user, count, 1);
    }
    if (isNetworkError(err)) {
      throw new Error(
        "Connection to OpenAI dropped twice. This is usually a transient network issue — please try again.",
      );
    }
    throw err;
  }

  const content = completion.choices[0]?.message?.content ?? "{}";
  const parsed = JSON.parse(content) as {
    slides?: {
      role?: SlideRole;
      number?: number | null;
      text?: string;
      image_keywords?: string[];
      body?: string | null;
    }[];
  };
  return (parsed.slides ?? []).map((s) => ({
    role: (s.role ?? "reason") as SlideRole,
    number: s.number ?? null,
    text: (s.text ?? "").trim(),
    imageKeywords: (s.image_keywords ?? [])
      .map((k) => String(k).trim())
      .filter(Boolean)
      .slice(0, 5),
    body: (s.body ?? "").toString().trim() || null,
  }));
}

async function generateOne(
  openai: OpenAI,
  req: ListicleRequest,
  s: Structure,
  variant: number,
  diag?: RunLogger | null,
): Promise<ListicleSlide[]> {
  const system = SYSTEM;
  let last: ListicleSlide[] = [];
  let lingo: { slide: number; tells: string[] }[] = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    const user =
      buildUser(req, s, variant) +
      (attempt > 0
        ? `\n\nYour previous attempt was rejected. Return EXACTLY ${s.count} slides with roles in order: title, then ${s.reasonCount} reasons, then cta${s.reasonCount >= 2 ? `, and the title number must be ${s.reasonCount}` : ""}.` +
          (lingo.length
            ? `\nIt also used phrasing that reads as machine-written. REMOVE these entirely and say the same thing the way a person would: ${lingo
                .map((l) => `slide ${l.slide}: ${l.tells.join(", ")}`)
                .join("; ")}.`
            : "")
        : "");
    last = await callOpenAI(openai, system, user, s.count, 0);
    // Structure AND voice both have to pass. The voice check is mechanical
    // because the prompt ban alone demonstrably leaks (a run shipped "secret
    // weapon" while that exact phrase was banned in its own prompt).
    lingo = scanDeckForAiLingo(last);
    const ok = isValid(last, s) && lingo.length === 0;
    if (diag) {
      await diag.text(
        `02_copy_prompt${attempt > 0 ? `_retry${attempt}` : ""}.txt`,
        `MODEL: gpt-4o\nSTRUCTURE: count=${s.count} reasonCount=${s.reasonCount} (no plug slide — every middle slide is pure value)\nVALID ON THIS ATTEMPT: ${ok}\n\n===== SYSTEM =====\n${system}\n\n===== USER =====\n${user}\n`,
      );
      await diag.json(
        `03_copy_raw_response${attempt > 0 ? `_retry${attempt}` : ""}.json`,
        last,
      );
    }
    if (ok) return normalize(last, s);
  }
  return normalize(last, s);
}

export async function generateListicle(
  req: ListicleRequest,
  diag?: RunLogger | null,
): Promise<ListicleSlide[][]> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || apiKey.includes("REPLACE_ME")) {
    throw new Error(
      "OPENAI_API_KEY is not set. Add it to .env.local and restart the dev server.",
    );
  }
  const openai = new OpenAI({ apiKey, timeout: 90_000, maxRetries: 0 });
  const s = listicleStructure(req.slideCount);
  const n = Math.min(Math.max(Math.floor(req.slideshowCount) || 1, 1), 5);

  return Promise.all(
    Array.from({ length: n }, (_, k) => generateOne(openai, req, s, k, diag)),
  );
}
