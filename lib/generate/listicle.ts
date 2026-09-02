import OpenAI from "openai";
import { formulaEcho } from "./hookBank";
import { copyModel, describeApiError, type CopyModel } from "./copyModel";
import type { RunLogger } from "./diagnostics";
// SlideRole lives in the pure layout module (no server deps) so the client-side
// drag editor can share it. Re-exported here to keep existing import sites working.
import type { SlideRole } from "./layout";
import { scanDeckForAiLingo, scanDeckShape, scanZingers } from "./aiLingo";
import { capsFor, registerBlock, type NicheRegister } from "./nicheRegister";
import { viralExamplesBlock } from "./viralExamples";
import { detectPlug, plugBlock, mentionsTarget, namesBrand } from "./plugRequest";
import {
  frameworkBlock,
  shortDeckPlan,
  usesBody,
  DETAILED_LISTICLE_BODY,
  AUTO_LISTICLE_BODY,
  type DetailLevel,
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
  /** Measured niche register (length / "you" targets); null = global caps. */
  register?: NicheRegister | null;
  /** Static curated hook-formula bank for slide 1 (may be "" / undefined). */
  hooks?: string;
  /** Present only on remixes: the specific trend's format to transplant. */
  format?: FormatBlueprint | null;
  /**
   * How much text a slide carries: "short" (one line), "long" (heading + a
   * two-part body) or "auto" (the model decides per slide). Short decks (1-3)
   * always write bodies regardless. See usesBody() — the single gate.
   */
  detail?: DetailLevel;
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
  "facts?|moves?|drills?|stretches?|recipes?|traits?|questions?|" +
  // Added once numbering started following the hook: "5 fixes", "5 truths" and
  // "5 changes" are as much a list count as "5 ways", but were unrecognised, so
  // a deck whose hook plainly promised five items came out unnumbered.
  "fixes|truths?|changes?|swaps?|tricks?|picks?|spots?|places?|products?|" +
  "apps?|tools?|items?|lies|rules?|upgrades?|costs?|fails?";
export function explicitListCount(text: string): number | null {
  // Up to three words may sit between the count and the noun — "3 chest
  // exercises", "5 boring gut health fixes" were missed by requiring adjacency,
  // which silently skipped the topic's stated count AND let a hook claiming a
  // different number pass validation.
  const m = text.match(
    new RegExp(`\\b(\\d{1,2})\\s+(?:\\w+\\s+){0,3}(?:${LIST_NOUNS})\\b`, "i"),
  );
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
  // NO CTA SLIDE on a real listicle (removed 2026-08-07). "follow for more X
  // tips" as its own slide reads as corny, and it spends the last slide — the
  // one people actually linger on — on a request instead of a payoff. Real decks
  // don't do it: the reference gut-health post is a hook plus five numbered
  // items and stops. So the last slide is now the final VALUE slide, and the
  // same slide count delivers one more item than it used to.
  //
  // Short decks (<= SHORT_DECK_MAX) are untouched above: their "cta" role is the
  // PAYOFF slot, not a call to action (see shortDeckPlan), and the role name is
  // the only thing they share. `SlideRole` still permits "cta" so every stored
  // deck keeps rendering.
  // A 3-slide deck is a SHORT deck, not a listicle: shortDeckPlan(3) asks for
  // "role cta = beat three, THE PAYOFF", so it keeps the original shape. Without
  // this guard it fell into the listicle branch, the prompt and the structure
  // disagreed about slide 3, and every 3-slide run burned a retry before
  // normalize() forced the roles back by position.
  if (count <= SHORT_DECK_MAX) {
    const reasonCount = count - 2;
    return {
      count,
      reasonCount,
      roles: ["title", ...Array<SlideRole>(reasonCount).fill("reason"), "cta"],
    };
  }
  const reasonCount = count - 1;
  return {
    count,
    reasonCount,
    roles: ["title", ...Array<SlideRole>(reasonCount).fill("reason")],
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
  "• VARY THE SHAPE ACROSS THE DECK — a machine's idea of punchy is every " +
  "slide as the same balanced two-clause sentence (\"X but Y\", \"X, not Y\", " +
  "\"X, so Y\"). At most TWO slides in the deck may use a contrast " +
  "construction; write the rest as blunt plain statements, and a fragment or " +
  "two is welcome (\"6 months of curls. same arms.\" counts as one caption, " +
  "no line break). Vary lengths too — some 4-6 words, some longer. Uneven is " +
  "human; matched is a machine.\n" +
  "• USE THE WORDS PEOPLE ACTUALLY SAY out loud in this niche. If nobody at a " +
  "gym would say it (\"arms are flat\"), don't write it (\"arms look the " +
  "same\").\n" +
  "• NEVER mention the post's own machinery. Banned in every caption: " +
  "\"slide\", \"slides\", \"swipe\", \"this post\", \"keep reading\". Write the " +
  "content, not a description of the format. \"5 slides for the only 3 chest " +
  "exercises i trust\" is a caption about a slideshow; the caption should be " +
  "about chest.\n" +
  "• ALL LOWERCASE. Write the way a person texts: no capital at the start of a " +
  "caption, lowercase \"i\", no Title Case. Capitals stay only for acronyms " +
  "(PSA, UK) and for a brand that is genuinely spelled that way. A capitalised " +
  "first letter is the loudest formality tell there is.\n" +
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
  "PLAIN BEATS CLEVER. A real creator types the obvious version of the line and " +
  "moves on: \"avoid toxic people\", \"plan your day the night before\", \"read a " +
  "money book every month\". Lines that read as crafted bars (\"if you don't read " +
  "one money book a month, you're losing the race\", \"money moves in rooms you " +
  "never get into by looking rich\") are a machine trying to be quotable, and " +
  "visible effort is the tell. At most ONE slide in the whole deck may carry an " +
  "edge; every other slide is a calm, plain statement. Never the conditional " +
  "threat (\"if you don't X, you're losing / falling behind / staying broke\"), " +
  "it is discarded mechanically. Do not lecture the viewer as \"you\" on every " +
  "slide: say what i did, what works, what they do. Never invent a number or a " +
  "quota just to sound specific; a real instruction said plainly is the target.\n" +
  "ONE LINE PER SLIDE. This is the rule people break most, so read it twice. A " +
  "caption is ONE short sentence — 2 to 8 words, 10 at the very most. Short is " +
  "not a problem: \"avoid toxic people\" is a complete caption. Never a " +
  "stacked list. Never a second sentence explaining the first. Never a line " +
  "break. If you find yourself writing two sentences, you have two ideas: keep " +
  "the sharper one and delete the other. The real examples above sometimes show " +
  "several lines stacked on one slide — do NOT copy that shape, read them for " +
  "VOICE only.\n" +
  "  Too long: \"fix google maps today / upload the front door / menu board / " +
  "best drink / best seat / people check this before walking over\".\n" +
  "  Right: \"fix your google maps photos before you post again\".\n" +
  "• No hashtags. NEVER use emojis — the caption font has no emoji glyphs, so any " +
  "emoji bakes onto the slide as an empty box. Be concrete, specific, and a little " +
  "contrarian.\n" +
  "NO AD SLIDE. Every middle slide is pure value delivering the topic. Never insert " +
  "a promo/product slide, and never restate the topic as if it were a product. " +
  "(The ONLY exception is when the user's topic explicitly asks you to plug " +
  "something — if it does, a PLUG section below tells you exactly what to do and " +
  "overrides this paragraph.)\n" +
  "For EVERY slide also return image_keywords: 3-5 terms for a stock-photo SEARCH " +
  "ENGINE. The FIRST keyword is the search query: 2-4 plain words naming the " +
  "literal visible subject — the exercise, object or place by its common name " +
  "(\"bench press\", \"incline dumbbell press\", \"espresso machine\"). Search " +
  "engines match captions people typed, so camera directions, moods and " +
  "adjectives return nothing: never \"side-view of lifter arching back\", " +
  "\"gym confusion\", \"fatigue shown on face\" — a searcher would type " +
  "\"bench press\". Remaining keywords are supporting visible objects or " +
  "settings (\"barbell\", \"dark gym\"). Never abstract concepts, text, or " +
  "emotions alone.";

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
    "⚠ The beats and caption above may mention the trend's OWN subject (its clothes, drink, place). That is NOISE — extract only each beat's psychological job. If any of the trend's subject words survive into your captions, the deck is wrong.",
  );
  return lines.join("\n");
}

// ── Blueprint subject-echo guard (2026-08-27) ────────────────────────────────
// Run 69: the auto-attached blueprint's hook beat read "Feeling of wearing
// baggy clothes" and the deck came back with a "checked progress only in baggy
// tees" slide — the trend's SUBJECT displaced part of the user's topic, even
// though formatBlock has said "NEVER its subject or wording" from day one.
// Prompt rules leak, so: any distinctive word from the blueprint's exemplar
// caption or beats that is absent from the topic/niche must not appear in the
// deck. Flagging only costs a retry, so the word filters lean permissive.

const ECHO_STOPWORDS = new Set(
  (
    "this that with when what where your yours their they them then than from " +
    "have has had been being will would could should about into over under " +
    "after before because while every some most more less very just like also " +
    "only even still never always people thing things really actually want " +
    "wants know knows make makes going doing done gets take takes body how " +
    "hook proof payoff slide slides beat beats caption captions reflection " +
    "relatable short long story stories experience experiences feeling " +
    "feelings feels feel emotion emotions reveal punchline value tips tip " +
    "list point points personal concrete specific topic subject creator " +
    "viewer viewers post format trend trends look looks looking wearing"
  ).split(/\s+/),
);

export function blueprintSubjectEcho(
  deck: { text?: string | null; body?: string | null }[],
  format: { exemplarCaption?: string | null; anatomy?: { beat: string }[] | null } | null | undefined,
  topic: string,
  niche: string,
): { word: string; slide: number }[] {
  if (!format) return [];
  const source = [
    format.exemplarCaption ?? "",
    ...(format.anatomy ?? []).map((b) => b.beat),
  ].join(" ");
  const allowed = `${topic} ${niche}`.toLowerCase();
  const words = [
    ...new Set(
      (source.toLowerCase().match(/[a-z']{4,}/g) ?? []).filter(
        (w) => !ECHO_STOPWORDS.has(w) && !allowed.includes(w),
      ),
    ),
  ];
  if (words.length === 0) return [];
  const hits: { word: string; slide: number }[] = [];
  deck.forEach((s, i) => {
    const text = `${s.text ?? ""} ${s.body ?? ""}`.toLowerCase();
    for (const w of words) {
      if (text.includes(w) && !hits.some((h) => h.word === w)) {
        hits.push({ word: w, slide: i + 1 });
      }
    }
  });
  return hits;
}

// Which body spec (if any) the listicle plan carries. Kept next to the plan so
// the schema (usesBody) and the instructions can't disagree about whether a
// deck writes bodies.
function bodyBlock(detail: DetailLevel | undefined): string {
  if (detail === "long") return `${DETAILED_LISTICLE_BODY}\n\n`;
  if (detail === "auto") return `${AUTO_LISTICLE_BODY}\n\n`;
  return "";
}

function buildUser(
  req: ListicleRequest,
  s: Structure,
  variant: number,
): string {
  const framework = frameworkBlock(s.count);
  // Hand-curated real posts + the captions we've already shipped and rejected.
  // These teach VOICE (see lib/generate/viralExamples.ts) — niche only picks
  // which examples are shown, it never becomes part of the subject.
  const voice = viralExamplesBlock(req.niche);
  // Conditional plug — see lib/generate/plugRequest.ts. Empty unless the user
  // actually asked, so the default no-ad-slide behaviour is untouched.
  const plug = plugBlock(detectPlug(req.description));
  return (
    (voice ? `${voice}\n\n` : "") +
    (plug ? `${plug}\n\n` : "") +
    (req.exemplars ? `${req.exemplars}\n\n` : "") +
    (registerBlock(req.register) ? `${registerBlock(req.register)}\n\n` : "") +
    // The hook bank teaches scroll-stopping OPENERS. A one-slide post has no
    // slide 2 to open a loop toward — the framework below fully replaces it, and
    // running both would hand the model contradictory instructions.
    (req.hooks && s.count > 1 ? `${req.hooks}\n\n` : "") +
    (req.format ? `${formatBlock(req.format)}\n\n` : "") +
    (framework ? `${framework}\n\n` : "") +
    // Niche is named ONLY when there's no topic to work from — there it's the
    // one signal we have. The moment the user gives a topic, the topic is the
    // whole subject and the niche is not mentioned at all: leaving it in let the
    // model average the two together (a landscaper's "cool cars" deck came back
    // as luxury car landscapes). Niche still routes trends and imagery upstream;
    // it just no longer whispers a second subject into the copy.
    (req.description
      ? `TOPIC — what this WHOLE slideshow must be about: ${req.description}\n` +
        `That topic is the entire subject. Do not widen it, and do not blend in ` +
        `the creator's trade or any other industry. COVER EVERY NAMED PART: when ` +
        `the topic lists components ("with diet and exercise") each one gets real ` +
        `coverage — a deck that covers exercise but never diet failed the topic — ` +
        `and when it asks a question ("what's most important") a slide must ` +
        `actually answer it.\n\n`
      : `Niche: ${req.niche}\n` +
        `TOPIC — what this WHOLE slideshow must be about: (no topic given — pick ` +
        `the single most scroll-stopping, specific angle for this niche and build ` +
        `the whole slideshow around it)\n\n`) +
    (req.exemplars
      ? "Match or beat the trending examples above in specificity and scroll-stopping " +
        "power (borrow the STYLE, not the words).\n\n"
      : "") +
    // 1-3 slides are their own formats, not shrunken listicles. 4+ keeps the
    // original wording verbatim.
    (s.count <= SHORT_DECK_MAX
      ? shortDeckPlan(s.count)
      : bodyBlock(req.detail) +
        `Build EXACTLY ${s.count} slides, in order:\n` +
        `1. role "title", number ${s.reasonCount}: the HOOK for the TOPIC above — ` +
        `scroll-stopping and specific, clearly about the topic (not a generic niche cliché). ` +
        `CHOOSE THE HOOK SHAPE THAT SUITS THIS TOPIC. A numbered list ("${s.reasonCount} ways to…") ` +
        `is only ONE of the shapes available to you and it is not the default — the hook formulas ` +
        `above are all fair game, and a curiosity gap, a callout, a before/after or a flat ` +
        `contrarian claim is often stronger. Do not reach for a count out of habit. ` +
        `IF you do state a list count in the hook it must be exactly ${s.reasonCount}, ` +
        `because that is how many value slides follow it.\n` +
        `   YOUR HOOK DECIDES THE DECK'S SHAPE. State a count and the value slides ` +
        `are numbered "1.", "2." to match it. State no count and they carry no ` +
        `numbers at all, which is what lets a curiosity gap, a callout or a ` +
        `before/after actually work — those shapes read as broken over a numbered ` +
        `list. Choose deliberately.\n` +
        `2. Slides 2–${s.count}: role "reason". Each delivers ONE concrete point of the topic. There is NO ad or product slide — every one of these is pure value. Do NOT write numbers into the caption text yourself — if your hook states a count they are numbered automatically, and if it does not they should carry none.\n` +
        `THERE IS NO CALL-TO-ACTION SLIDE. Do not end on "follow for more", "link in bio", "save this" or any variation — it reads as corny and wastes the slide people linger on. The LAST slide is your strongest remaining value slide, and it must land the topic, not ask for anything.\n`) +
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
  // The hook no longer HAS to be numbered (2026-08-07, Ernest). This used to
  // reject any 4+ deck whose hook didn't contain the digit, which is why every
  // deck opened "N ways to…" — hookBank.ts ships six other shapes (curiosity
  // gap, forbidden, stakes, callout, before→after, outcome promise), injects
  // them into every prompt, and the validator then threw away any hook that
  // used one. The model wasn't defaulting to lists; we were enforcing them.
  //
  // What still holds is CONSISTENCY: a hook that claims a count must claim the
  // right one, or "5 ways" renders over 4 slides. explicitListCount is reused
  // rather than a bare \d match so a real stat ("i ate 180g of protein") is not
  // mistaken for a list count.
  if (s.reasonCount < 2) return true;
  const claimed = explicitListCount(raw[0]?.text ?? "");
  return claimed == null || claimed === s.reasonCount;
}

// Caption length, enforced mechanically rather than merely asked for — the same
// reasoning as the AI-lingo scan, which exists because a run shipped "secret
// weapon" while that exact phrase was banned in its own prompt.
//
// Length is the rule a strong model breaks most, and for a subtle reason: the
// voice corpus in viralExamples.ts is transcribed from real decks, and real
// decks stack several short lines onto one slide. gpt-4o ignored that and wrote
// one-liners, so it never surfaced. A model that actually follows its examples
// copies the SHAPE and returns six-line captions, which bake as a wall of text.
//
// NEVER truncates — an "…" on a slide is a hard product failure. Overlong slides
// are named back to the model and the deck is rewritten, exactly like the lingo
// loop. `body` is untouched: on short (1-3 slide) decks it is a paragraph by
// design and carries the protocol.
// Lowered 14 → 10 on 2026-09-02: at 14 the model wrote 10-13-word two-clause
// sentences on every slide; real decks run 3-6 words ("avoid toxic people").
export const MAX_CAPTION_WORDS = 10;

export function overlongCaptions(
  deck: { text?: string }[],
  cap: number = MAX_CAPTION_WORDS,
): { slide: number; words: number }[] {
  const out: { slide: number; words: number }[] = [];
  deck.forEach((s, i) => {
    const text = (s.text ?? "").trim();
    if (!text) return;
    const words = text.split(/\s+/).filter(Boolean).length;
    // A line break means a stacked caption whatever the word count.
    if (words > cap || /\r?\n/.test(text)) {
      out.push({ slide: i + 1, words });
    }
  });
  return out;
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
function normalize(
  raw: ListicleSlide[],
  s: Structure,
  wantsBody: boolean,
): ListicleSlide[] {
  const out: ListicleSlide[] = [];
  for (let i = 0; i < s.count; i++) {
    const role = expectedRole(i, s);
    // Short decks carry NO numbers anywhere (see isValid). Critically this
    // includes the reason slide: layoutSlide bakes a reason's number inline
    // ("1. …"), which would turn a 3-slide turn like "nobody's watching" into
    // "1. nobody's watching" and destroy the mechanic.
    // NUMBERING FOLLOWS THE HOOK (2026-08-07). Every 4+ deck used to number its
    // value slides unconditionally, which quietly forced the hook's hand: with
    // "1." baked onto each slide, any hook that did NOT state a count read as
    // broken, so dropping the numbered-hook validator alone changed little.
    // Five of the six shapes in hookBank.ts (curiosity gap, forbidden, stakes,
    // before/after, outcome promise) only work over an UNNUMBERED deck.
    //
    // So the hook decides: claim a count and the slides are numbered to match;
    // claim none and nothing is numbered. The deck can no longer contradict its
    // own headline, and it needs no new control or schema field.
    const numbered =
      s.reasonCount >= 2 && explicitListCount(raw[0]?.text ?? "") != null;
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
    // Dropped unless the deck actually asked for bodies, so a default 4+ deck
    // renders exactly as it always has even if the model volunteers one.
    const body = wantsBody
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

async function callCopyModel(
  cm: CopyModel,
  system: string,
  user: string,
  wantsBody: boolean,
  attempt = 0,
): Promise<ListicleSlide[]> {
  let completion;
  try {
    completion = await cm.client.chat.completions.create({
      model: cm.model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "listicle",
          strict: true,
          schema: wantsBody ? SHORT_SCHEMA : SCHEMA,
        },
      },
    });
  } catch (err) {
    if (err instanceof OpenAI.APIError) throw describeApiError(err, cm);
    // Transient network error (socket reset, connection drop, etc.) — retry once
    if (isNetworkError(err) && attempt === 0) {
      await new Promise((r) => setTimeout(r, 1500));
      return callCopyModel(cm, system, user, wantsBody, 1);
    }
    if (isNetworkError(err)) {
      throw new Error(
        `Connection to ${cm.label} dropped twice. This is usually a transient network issue — please try again.`,
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
  cm: CopyModel,
  req: ListicleRequest,
  s: Structure,
  variant: number,
  diag?: RunLogger | null,
): Promise<ListicleSlide[]> {
  const system = SYSTEM;
  // A requested plug is a HARD requirement, not a preference: "plug my website
  // shredguide.ai" produced a deck that never said shredguide.ai, because the
  // standing no-ad-slide rule outranked the user. Checked mechanically below and
  // retried, for the same reason the AI-lingo check is mechanical.
  const plug = detectPlug(req.description);
  const wantsBody = usesBody(s.count, req.detail);
  let last: ListicleSlide[] = [];
  let lingo: { slide: number; tells: string[] }[] = [];
  let plugMissing = false;
  let plugInHook = false;
  let overlong: { slide: number; words: number }[] = [];
  let echoed: string | null = null;
  let sameShape: { slides: number[] } | null = null;
  let zingers: ReturnType<typeof scanZingers> = null;
  // Niche-measured caps when we have them (see nicheRegister.ts), else global.
  const caps = capsFor(req.register, MAX_CAPTION_WORDS);
  let bpEcho: { word: string; slide: number }[] = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    const user =
      buildUser(req, s, variant) +
      (attempt > 0
        ? `\n\nYour previous attempt was rejected. Return EXACTLY ${s.count} slides with roles in order: title, then ${s.reasonCount} reasons${s.count <= SHORT_DECK_MAX ? ", then cta" : " (there is NO cta slide)"}.${s.reasonCount >= 2 ? ` The hook does not have to contain a number, but if it states a list count that count must be ${s.reasonCount}.` : ""}` +
          (plugMissing && plug.target
            ? `\nCRITICAL: it never mentioned "${plug.target}". The user asked for that plug. Put "${plug.target}" — spelled exactly like that — on ONE middle slide.`
            : "") +
          (plugInHook && plug.target
            ? `\nCRITICAL: the hook (slide 1) named "${plug.target}". A hook that names the brand reads as an ad and kills reach. Rewrite the hook with NO brand words — open on the pain or payoff a stranger relates to — and keep the name on ONE middle slide only.`
            : "") +
          (lingo.length
            ? `\nIt also used phrasing that reads as machine-written. REMOVE these entirely and say the same thing the way a person would: ${lingo
                .map((l) => `slide ${l.slide}: ${l.tells.join(", ")}`)
                .join("; ")}.`
            : "") +
          (echoed
            ? `\nThe hook copied a formula example nearly word-for-word ("${echoed}"). The formulas are SHAPES, not scripts — rewrite the hook in completely fresh words that no example uses, keeping the same psychological shape.`
            : "") +
          (overlong.length
            ? `\nThese captions are TOO LONG: ${overlong
                .map((o) => `slide ${o.slide} (${o.words} words)`)
                .join(
                  ", ",
                )}. Rewrite each as ONE sentence of at most ${caps.wordCap} words with NO line breaks. Do not compress by abbreviating — pick the single sharpest idea in the caption and cut the rest.`
            : "") +
          (sameShape
            ? `\nDECK RHYTHM: slides ${sameShape.slides.join(", ")} are all the same balanced two-clause sentence ("X but Y", "X, not Y", "X, so Y"). A human deck is bursty — keep at most TWO contrast constructions, and make the rest blunt plain statements or fragments ("6 months of curls. same arms."), with genuinely varied lengths.`
            : "") +
          (zingers?.threats.length
            ? `\nTOO CLEVER: slide${zingers.threats.length > 1 ? "s" : ""} ${zingers.threats.join(", ")} ${zingers.threats.length > 1 ? "are" : "is"} a conditional threat ("if you don't X, you're losing Y"). That is a motivational poster, not a person. Rewrite as the plain version of the same advice, stated calmly, with no threat and no metaphor.`
            : "") +
          (zingers?.youHeavy
            ? `\nTOO MUCH "YOU": slides ${zingers.youSlides.join(", ")} all lecture the viewer directly. A real deck is "what i did" / "what they do" / "what works" — rewrite so at most ${caps.youCap(last.length)} slides address the viewer as "you".`
            : "") +
          (bpEcho.length
            ? `\nBLUEPRINT LEAK: your captions borrowed the trend blueprint's own subject words (${bpEcho
                .map((h) => `"${h.word}" on slide ${h.slide}`)
                .join(", ")}). The blueprint contributes STRUCTURE only — rewrite those slides purely about the TOPIC, with none of the trend's subject.`
            : "")
        : "");
    last = await callCopyModel(cm, system, user, wantsBody, 0);
    // Structure, voice, length AND the requested plug all have to pass. The
    // checks are mechanical because prompt rules alone demonstrably leak (a run
    // shipped "secret weapon" while that exact phrase was banned in its prompt).
    lingo = scanDeckForAiLingo(last);
    plugMissing = !mentionsTarget(last, plug.target);
    // The inverse guard: the brand must be on a middle slide but NOT the hook —
    // a branded hook is an ad, not a story (run 63 shipped "you need to try
    // newman's coffee" as slide 1 despite the prompt rule; rules leak).
    plugInHook = plug.requested && namesBrand(last[0]?.text ?? "", plug.target);
    overlong = overlongCaptions(last, caps.wordCap);
    // Deck-level rhythm (anti-AI-voice tell #5) — mechanical because the
    // judge's own "vary every slide" prompt rule demonstrably leaked (run 65).
    sameShape = scanDeckShape(last);
    // Zinger cadence (anti-AI-voice tell #6): the conditional threat and the
    // "you"-on-every-slide lecture. Run 75 shipped both straight through the
    // prompt rule, so it is enforced here like everything else.
    zingers = scanZingers(last, caps.youCap);
    bpEcho = blueprintSubjectEcho(last, req.format, req.description ?? "", req.niche);
    // A hook that echoes a bank formula word-for-word ("you weren't supposed
    // to find out about X") reads as AI on sight — the bank's own "never paste
    // one" rule leaks, so it is enforced mechanically like everything else.
    echoed = formulaEcho(last[0]?.text ?? "");
    const ok =
      isValid(last, s) &&
      lingo.length === 0 &&
      !plugMissing &&
      !plugInHook &&
      overlong.length === 0 &&
      !echoed &&
      !sameShape &&
      !zingers &&
      bpEcho.length === 0;
    if (diag) {
      await diag.text(
        `02_copy_prompt${attempt > 0 ? `_retry${attempt}` : ""}.txt`,
        `MODEL: ${cm.label}\nSTRUCTURE: count=${s.count} reasonCount=${s.reasonCount} (no plug slide — every middle slide is pure value)\nVALID ON THIS ATTEMPT: ${ok}\n\n===== SYSTEM =====\n${system}\n\n===== USER =====\n${user}\n`,
      );
      await diag.json(
        `03_copy_raw_response${attempt > 0 ? `_retry${attempt}` : ""}.json`,
        last,
      );
    }
    if (ok) return normalize(last, s, wantsBody);
  }
  return normalize(last, s, wantsBody);
}

export async function generateListicle(
  req: ListicleRequest,
  diag?: RunLogger | null,
): Promise<ListicleSlide[][]> {
  // Provider comes from GEN_PROVIDER — see lib/generate/copyModel.ts. Throws
  // (rather than falling back) when the selected provider has no key, so a
  // misconfigured A/B fails loudly instead of quietly measuring the default.
  const cm = copyModel({ timeoutMs: 90_000 });
  const s = listicleStructure(req.slideCount);
  const n = Math.min(Math.max(Math.floor(req.slideshowCount) || 1, 1), 5);

  return Promise.all(
    Array.from({ length: n }, (_, k) => generateOne(cm, req, s, k, diag)),
  );
}
