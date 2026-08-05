import OpenAI from "openai";
import sharp from "sharp";
import type { ListicleSlide, SlideRole } from "./listicle";
import type { SlidePos, Align } from "./layout";
import { cleanCaption } from "./cleanCaption";
import { viralExamplesBlock } from "./viralExamples";

// ─────────────────────────────────────────────────────────────────────────────
// SUPERCHARGE — the judge LLM.
//
// After the first (copy) LLM writes a deck AND the images are chosen, a stronger
// model reviews the FINISHED draft — every caption + the image actually chosen
// for each slide — against the same brief the first LLM had, and returns a list
// of edit OPERATIONS to make the deck genuinely viral-worthy (or approves it as
// is). The route applies those operations and logs each one.
//
// This module NEVER touches the hard-won copy prompts in listicle.ts /
// imageFirst.ts. It sits AROUND them: the judge critiques their output and edits
// it, it does not rewrite them. It also degrades gracefully — any failure returns
// a null verdict so a Supercharge run silently behaves like a normal generation
// (mirrors the graceful-degradation contract of liveImages.ts `judge()`).
// ─────────────────────────────────────────────────────────────────────────────

/** The judge model. Deliberately stronger than the copy model (gpt-4o). This is
 *  the ONE place to swap it — if OpenAI ships something newer, change it here. */
export const JUDGE_MODEL = "gpt-4.1";

const THUMB_W = 512; // the judge needs enough detail to spot caption/image mismatch

/** Every operation the judge can perform on the deck. Extensible: add a name
 *  here + a handler in `applyOperations` and it becomes available. */
export type JudgeOpName =
  | "rewrite_caption" // change a slide's heading text
  | "rewrite_body" // change a slide's body paragraph (short decks)
  | "set_keywords" // update a slide's image_keywords (metadata only)
  | "resource_image" // re-fetch a stock image for a slide (optionally new keywords)
  | "reassign_photo" // upload path: point a slide at a different uploaded photo
  | "swap_images" // swap the images between two slides
  | "reorder" // permute the slide order
  | "drop_slide" // remove a slide entirely
  | "reposition_caption" // move a slide's caption on the canvas
  | "add_slide" // insert a new value slide (e.g. to deliver a promised count)
  | "regenerate_deck"; // nuclear: rewrite the whole deck with extra guidance

/** One operation as emitted by the judge (params are a nullable superset; strict
 *  json_schema needs a fixed shape, so unused params are null). */
export interface JudgeOperation {
  op: JudgeOpName;
  /** target slide index (0-based) for per-slide ops; null otherwise. */
  slide: number | null;
  /** second slide for swap_images. */
  slideB: number | null;
  text: string | null;
  body: string | null;
  keywords: string[] | null;
  photoIndex: number | null;
  /** new order for `reorder` (a permutation of 0..n-1). */
  order: number[] | null;
  x: number | null;
  y: number | null;
  align: string | null;
  /** extra direction for `regenerate_deck`. */
  guidance: string | null;
  /** WHY the judge is doing this — surfaced in diagnostics. Always present. */
  reason: string;
}

export interface JudgeVerdict {
  approved: boolean;
  assessment: string;
  operations: JudgeOperation[];
}

/** The same brief the first LLM had, so the judge reasons from full context. */
export interface JudgeBrief {
  topic: string;
  niche: string;
  slideCount: number;
  /** trending-hook exemplars block (may be ""). */
  exemplars?: string;
  /** curated hook-formula bank (may be ""). */
  hooks?: string;
}

/** A working slide during/after judging. Extends ListicleSlide with an optional
 *  per-slide caption position (set only by `reposition_caption`). */
export type JudgedSlide = ListicleSlide & { pos?: SlidePos | null };

/** A record of one operation the applier actually ran, for diagnostics. */
export interface AppliedOp {
  op: JudgeOpName;
  slide: number | null;
  reason: string;
  /** human-readable "before → after". */
  detail: string;
  status: "applied" | "skipped";
  skipReason?: string;
}

/** Dependencies the applier needs from the route (image re-sourcing / full
 *  regeneration live behind these seams so this module stays decoupled). */
export interface ApplyContext {
  /** the user's uploaded photos (for reassign_photo); [] on the stock path. */
  userBufs: Buffer[];
  /** re-source one stock background for a caption/keywords; null if unavailable. */
  resourceStockImage: (
    keywords: string[],
    caption: string,
  ) => Promise<Buffer | null>;
  /** nuclear: regenerate the whole deck with extra guidance; null on failure. */
  regenerateDeck: (
    guidance: string,
  ) => Promise<{ deck: ListicleSlide[]; images: (Buffer | undefined)[] } | null>;
}

// ── schema (strict) ──────────────────────────────────────────────────────────
const OP_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "op",
    "slide",
    "slide_b",
    "text",
    "body",
    "keywords",
    "photo_index",
    "order",
    "x",
    "y",
    "align",
    "guidance",
    "reason",
  ],
  properties: {
    op: {
      type: "string",
      enum: [
        "rewrite_caption",
        "rewrite_body",
        "set_keywords",
        "resource_image",
        "reassign_photo",
        "swap_images",
        "reorder",
        "drop_slide",
        "reposition_caption",
        "add_slide",
        "regenerate_deck",
      ],
    },
    slide: { type: ["integer", "null"] },
    slide_b: { type: ["integer", "null"] },
    text: { type: ["string", "null"] },
    body: { type: ["string", "null"] },
    keywords: { type: ["array", "null"], items: { type: "string" } },
    photo_index: { type: ["integer", "null"] },
    order: { type: ["array", "null"], items: { type: "integer" } },
    x: { type: ["number", "null"] },
    y: { type: ["number", "null"] },
    align: { type: ["string", "null"] },
    guidance: { type: ["string", "null"] },
    reason: { type: "string" },
  },
} as const;

const VERDICT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["approved", "assessment", "operations"],
  properties: {
    approved: { type: "boolean" },
    assessment: { type: "string" },
    operations: { type: "array", items: OP_SCHEMA },
  },
} as const;

const SYSTEM =
  "You are a top-0.1% TikTok creator who has personally written thousands of " +
  "photo-slideshow hooks that went viral. You edit like a real creator, NOT like " +
  "a brand or a marketer — you have an ear for the exact way a caption has to be " +
  "phrased to stop a thumb. A junior team has produced a DRAFT slideshow: you see " +
  "every slide's caption (and any body paragraph) AND the exact image chosen for " +
  "that slide. Make it something you would actually post from your own account, " +
  "then stop.\n" +
  "WHY POSTS SPREAD — a slideshow travels for exactly one reason: VALUE. Someone " +
  "finishes it knowing something they can ACT ON. The test for every slide: could " +
  "a stranger DO something differently after reading this? A dose, a number, a " +
  "frequency, a named thing, a followable instruction usually separates a viral " +
  "slide from a forgettable one — but specificity is JUDGEMENT, not a quota: a " +
  "mindset slide can be concrete with no digits. Kill captions that are true, " +
  "useless and forgettable (\"consistency is what matters\", \"focus on nutrition\").\n" +
  "IMAGE FIT — the photo must be COMPATIBLE with its caption and not fight it. " +
  "Flag: a photo that contradicts the caption, an image with baked-in text that " +
  "collides with our overlay, two slides that are obviously the same photoshoot, " +
  "or a caption that names a specific subject the photo does not show.\n" +
  "HOOK CRAFT — slide 1 decides everything; a flat hook kills the whole post. When " +
  "the hook (or the CTA, or a limp middle slide) reads generic, rewrite it into a " +
  "proven creator shape. Pick whichever fits the topic; never sound like a 2015 " +
  "YouTube thumbnail:\n" +
  "• SELF-DIAGNOSIS (the highest performer) — make the viewer feel personally " +
  "called out or seen: \"you don't hate coffee, you hate the 4 drinks you've " +
  "tried\"; \"for everyone who orders coffee to fit in and then pours half of it out\".\n" +
  "• INSIDER / AUTHORITY — talk like someone on the inside: \"what baristas order " +
  "when they don't actually want to taste coffee\"; \"5 drinks I'd hand you if you " +
  "told me you hate coffee\".\n" +
  "• HOT TAKE / REFRAME — a confident, slightly contrarian line: \"black coffee is " +
  "not a personality\"; \"you were never supposed to start with black coffee\".\n" +
  "• RESULT-FIRST / PROMISE — lead with the payoff: \"5 coffees that taste like " +
  "dessert and still get you through a meeting\"; \"5 orders that turned me into a " +
  "coffee person in one week\".\n" +
  "Those examples are coffee — adapt the SHAPE to whatever this deck is actually " +
  "about. Understatement and specificity read as confident; hype reads as an ad.\n" +
  "VOICE — same rules the draft was written under: no exclamation marks, no Title " +
  "Case, no em/en dashes, no explainer-colon labels, no clichés (\"game-changer\", " +
  "\"unlock\", \"level up\"), no emojis, short lines. If a caption breaks these, " +
  "rewrite it.\n" +
  "AI-TELL STRUCTURES — these read as machine-written even when grammatical and " +
  "true. Rewrite ANY caption that uses one:\n" +
  "• Evaluative tail clause — a comma then generic praise: \"adds a chocolatey " +
  "twist, perfect for a creamy finish\". Cut the tail or swap it for a concrete " +
  "consequence.\n" +
  "• Abstract sensory / menu-copy nouns — \"espresso's sharpness\", \"a creamy " +
  "finish\", \"that sweet hit\". Say it like a person would out loud: \"it's not " +
  "bitter\", not \"layers sweetness over espresso's sharpness\".\n" +
  "• Twee personification — giving a thing a cutesy persona: \"peppermint mocha " +
  "is the refreshing buddy to your standard brew\". Drop it.\n" +
  "• Over-balanced parallelism — too-tidy \"X over Y\" symmetry (\"layers " +
  "sweetness over espresso's sharpness\"). Real people are blunter and messier.\n" +
  "A caption being true and on-topic does NOT excuse these — fix it anyway.\n" +
  "SOUND HUMAN — this is the whole game, and it is mostly about STRUCTURE, not " +
  "vocabulary. A deck can be true, useful and clean and STILL read as AI because " +
  "every line is built the same way. Readers (and AI detectors) clock the same " +
  "three things: uniform structure, smooth/predictable phrasing, and everything " +
  "over-explained. Fight all three:\n" +
  "• VARY EVERY SLIDE — the single biggest tell. No two captions may share the " +
  "same shape, length, or opening word. If the reasons are a list of identical " +
  "\"[thing], [clause]\" lines, that ALONE reads as AI no matter how good the words " +
  "are. Break the pattern deliberately: make one a blunt fragment, one a full " +
  "sentence, one a short opinion or aside. Uneven is human; matched is a machine.\n" +
  "• STOP EXPLAINING — AI justifies every pick (\"for people who want…\", \"for " +
  "when you want…\", \"if you want something…\"). A real creator just says it. " +
  "\"caramel macchiato, you barely taste the espresso\" beats \"caramel macchiato, " +
  "the go-to for people who don't want to taste the espresso\".\n" +
  "• LAND ONE REAL, SPECIFIC LINE — the fastest proof a human wrote it is a " +
  "concrete take, opinion or comparison a model wouldn't default to: \"the lavender " +
  "one is basically dessert\", \"tastes like a liquid cinnamon roll\", \"honestly " +
  "the only one I reorder\". At least one slide should carry that texture.\n" +
  "• PICK THE SHARPER WORD — reach for the specific real word, not the smoothest " +
  "most-expected one. Smooth and perfectly balanced = predictable = AI; a little " +
  "friction reads as a person.\n" +
  "• READ IT LIKE A TEXT to a friend who asked for the list — not a menu, not a " +
  "brand caption. If a line sounds like packaging copy, rewrite it until it sounds " +
  "like a person typing fast.\n" +
  "REASON slides may begin with their list number (\"1. ...\"). Keep that number " +
  "when you rewrite a reason. The hook's list count MUST equal the number of value " +
  "(reason) slides — never change it to a number the deck does not actually " +
  "deliver. If you REORDER or DROP slides, fix the hook's count with rewrite_caption too.\n" +
  "OPERATIONS — you return a list of edits. Use the MINIMUM needed. If the draft " +
  "is already excellent, return approved=true with an empty operations list. " +
  "Available operations (slide indices are 0-based):\n" +
  "• rewrite_caption {slide, text} — replace a heading.\n" +
  "• rewrite_body {slide, body} — replace a body paragraph.\n" +
  "• set_keywords {slide, keywords} — fix the image search terms (metadata only).\n" +
  "• resource_image {slide, keywords} — fetch a NEW stock photo for the slide " +
  "using these keywords (use when the current image does not fit).\n" +
  "• reassign_photo {slide, photo_index} — point the slide at a different UPLOADED " +
  "photo (upload decks only).\n" +
  "• swap_images {slide, slide_b} — swap the two slides' images.\n" +
  "• reorder {order} — new slide order as a full permutation of indices.\n" +
  "• drop_slide {slide} — remove a weak middle slide (never the hook or the CTA).\n" +
  "• add_slide {slide, text, keywords} — insert a NEW value slide right after index " +
  "`slide` (use when the deck is missing a promised item — e.g. the hook says 5 but " +
  "only 4 exist). `text` is the caption; `keywords` fetch its stock image.\n" +
  "• reposition_caption {slide, x, y, align} — move the caption (x,y are 0..1, " +
  "align is left|center|right).\n" +
  "• regenerate_deck {guidance} — LAST RESORT when the whole draft is off; the deck " +
  "is rewritten from scratch with your guidance.\n" +
  "Every operation MUST include a short `reason`. For unused params, pass null. " +
  "Do not invent slides; operate only on the ones shown.";

async function thumb(buf: Buffer | undefined): Promise<string | null> {
  if (!buf) return null;
  try {
    const o = await sharp(buf)
      .resize({ width: THUMB_W, withoutEnlargement: true })
      .jpeg({ quality: 68 })
      .toBuffer();
    return `data:image/jpeg;base64,${o.toString("base64")}`;
  } catch {
    return null;
  }
}

/** Build the exact user message shown to the judge (text portion returned too so
 *  the caller can dump it to diagnostics). */
function buildJudgeText(deck: ListicleSlide[], brief: JudgeBrief): string {
  const lines: string[] = [];
  // The judge had NO voice reference at all — it was the one component whose
  // whole job is catching AI voice, judging against rules only.
  const voice = viralExamplesBlock(brief.niche);
  if (voice) lines.push(voice, "");
  if (brief.exemplars) lines.push(brief.exemplars, "");
  if (brief.hooks) lines.push(brief.hooks, "");
  // The judge is told the niche only when there's no topic — otherwise it scored
  // drift toward the niche as on-brief (see the note in listicle.ts).
  if (!brief.topic) lines.push(`Niche: ${brief.niche}`);
  lines.push(
    `TOPIC the whole deck must deliver: ${brief.topic || "(none given)"}`,
    ...(brief.topic
      ? [
          "That topic is the entire subject — mark any slide that drifts into " +
            "another industry as off-brief.",
        ]
      : []),
    `The deck has ${deck.length} slide(s). Review the draft below (each slide's ` +
      `caption + its chosen image follow).`,
    "",
    "Return your verdict: approved + a one-paragraph assessment + the minimal " +
      "operations to make this deck genuinely worth posting.",
  );
  return lines.join("\n");
}

/**
 * Review a finished draft deck. Returns a verdict (or null on any failure) plus
 * the text prompt used, for diagnostics. NEVER throws.
 */
export async function judgeDeck(args: {
  deck: ListicleSlide[];
  images: (Buffer | undefined)[];
  brief: JudgeBrief;
}): Promise<{ verdict: JudgeVerdict | null; prompt: string }> {
  const { deck, images, brief } = args;
  const promptText = buildJudgeText(deck, brief);
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || apiKey.includes("REPLACE_ME")) {
    return { verdict: null, prompt: promptText };
  }

  try {
    const thumbs = await Promise.all(images.map((b) => thumb(b)));
    const content: Array<
      | { type: "text"; text: string }
      | { type: "image_url"; image_url: { url: string; detail: "low" } }
    > = [{ type: "text", text: promptText }];
    deck.forEach((s, i) => {
      content.push({
        type: "text",
        text:
          `\nSlide ${i} — role ${s.role}: "${s.text}"` +
          (s.body ? `\n  body: "${s.body}"` : "") +
          (s.imageKeywords?.length
            ? `\n  image_keywords: ${s.imageKeywords.join(", ")}`
            : "") +
          (thumbs[i] ? `\n  image:` : `\n  image: (none)`),
      });
      if (thumbs[i]) {
        content.push({
          type: "image_url",
          image_url: { url: thumbs[i] as string, detail: "low" },
        });
      }
    });

    const openai = new OpenAI({ apiKey, timeout: 60_000, maxRetries: 0 });
    const completion = await openai.chat.completions.create({
      model: JUDGE_MODEL,
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content },
      ],
      response_format: {
        type: "json_schema",
        json_schema: { name: "verdict", strict: true, schema: VERDICT_SCHEMA },
      },
    });
    const parsed = JSON.parse(
      completion.choices[0]?.message?.content ?? "{}",
    ) as {
      approved?: boolean;
      assessment?: string;
      operations?: Array<Record<string, unknown>>;
    };
    const operations: JudgeOperation[] = (parsed.operations ?? []).map((o) => ({
      op: String(o.op) as JudgeOpName,
      slide: numOrNull(o.slide),
      slideB: numOrNull(o.slide_b),
      text: strOrNull(o.text),
      body: strOrNull(o.body),
      keywords: Array.isArray(o.keywords)
        ? (o.keywords as unknown[]).map((k) => String(k)).filter(Boolean)
        : null,
      photoIndex: numOrNull(o.photo_index),
      order: Array.isArray(o.order)
        ? (o.order as unknown[])
            .map((n) => Number(n))
            .filter((n) => Number.isInteger(n))
        : null,
      x: numOrNull(o.x),
      y: numOrNull(o.y),
      align: strOrNull(o.align),
      guidance: strOrNull(o.guidance),
      reason: strOrNull(o.reason) ?? "",
    }));
    return {
      verdict: {
        approved: parsed.approved ?? operations.length === 0,
        assessment: parsed.assessment ?? "",
        operations,
      },
      prompt: promptText,
    };
  } catch {
    return { verdict: null, prompt: promptText };
  }
}

function numOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}
function strOrNull(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

// ── applying operations ──────────────────────────────────────────────────────

const NUM_PREFIX = /^\s*(\d+)\.\s+/;

/** Reasons are numbered "1. ", "2. " inline. After reorder/drop, renumber them
 *  in place — but only if they were numbered to begin with (short decks aren't). */
function renumberReasons(deck: JudgedSlide[]): void {
  const reasons = deck.filter((s) => s.role === "reason");
  const numbered = reasons.length > 0 && NUM_PREFIX.test(reasons[0].text);
  if (!numbered) return;
  let n = 0;
  for (const s of deck) {
    if (s.role !== "reason") continue;
    n += 1;
    s.text = `${n}. ${s.text.replace(NUM_PREFIX, "")}`;
  }
}

function clamp01(v: number): number {
  return Math.min(Math.max(v, 0), 1);
}

/**
 * Apply the judge's operations in order. Returns the revised deck, the revised
 * per-slide images, and a log of what actually happened (for diagnostics). Never
 * throws — a bad op is logged as skipped and the rest proceed.
 */
export async function applyOperations(
  inputDeck: ListicleSlide[],
  inputImages: (Buffer | undefined)[],
  ops: JudgeOperation[],
  ctx: ApplyContext,
): Promise<{
  deck: JudgedSlide[];
  images: (Buffer | undefined)[];
  applied: AppliedOp[];
}> {
  let deck: JudgedSlide[] = inputDeck.map((s) => ({ ...s }));
  let images: (Buffer | undefined)[] = [...inputImages];
  const applied: AppliedOp[] = [];

  const log = (
    op: JudgeOpName,
    slide: number | null,
    reason: string,
    detail: string,
    status: "applied" | "skipped" = "applied",
    skipReason?: string,
  ) => applied.push({ op, slide, reason, detail, status, skipReason });

  const inRange = (i: number | null): i is number =>
    typeof i === "number" && i >= 0 && i < deck.length;

  for (const op of ops) {
    const reason = op.reason || "";
    switch (op.op) {
      case "rewrite_caption": {
        if (!inRange(op.slide) || !op.text) {
          log(op.op, op.slide, reason, "", "skipped", "bad slide index or empty text");
          break;
        }
        const before = deck[op.slide].text;
        // Preserve the reason's leading list number if the judge dropped it.
        const num = before.match(NUM_PREFIX);
        let next = cleanCaption(op.text);
        if (num && !NUM_PREFIX.test(next)) next = `${num[1]}. ${next}`;
        deck[op.slide].text = next || before;
        log(op.op, op.slide, reason, `"${before}" → "${deck[op.slide].text}"`);
        break;
      }
      case "rewrite_body": {
        if (!inRange(op.slide)) {
          log(op.op, op.slide, reason, "", "skipped", "bad slide index");
          break;
        }
        const before = deck[op.slide].body ?? "";
        const next = op.body ? cleanCaption(op.body) : null;
        deck[op.slide].body = next || null;
        log(op.op, op.slide, reason, `"${before}" → "${deck[op.slide].body ?? ""}"`);
        break;
      }
      case "set_keywords": {
        if (!inRange(op.slide) || !op.keywords?.length) {
          log(op.op, op.slide, reason, "", "skipped", "bad slide index or no keywords");
          break;
        }
        const before = (deck[op.slide].imageKeywords ?? []).join(", ");
        deck[op.slide].imageKeywords = op.keywords.slice(0, 5);
        log(op.op, op.slide, reason, `[${before}] → [${op.keywords.slice(0, 5).join(", ")}]`);
        break;
      }
      case "resource_image": {
        if (!inRange(op.slide)) {
          log(op.op, op.slide, reason, "", "skipped", "bad slide index");
          break;
        }
        const kw =
          op.keywords?.length ? op.keywords.slice(0, 5) : deck[op.slide].imageKeywords ?? [];
        const fresh = await ctx.resourceStockImage(kw, deck[op.slide].text);
        if (!fresh) {
          log(op.op, op.slide, reason, `keywords [${kw.join(", ")}]`, "skipped", "no stock image found");
          break;
        }
        if (op.keywords?.length) deck[op.slide].imageKeywords = kw;
        images[op.slide] = fresh;
        log(op.op, op.slide, reason, `re-sourced image with [${kw.join(", ")}]`);
        break;
      }
      case "reassign_photo": {
        if (!inRange(op.slide)) {
          log(op.op, op.slide, reason, "", "skipped", "bad slide index");
          break;
        }
        const p = op.photoIndex;
        if (typeof p !== "number" || p < 0 || p >= ctx.userBufs.length) {
          log(op.op, op.slide, reason, `photo ${p}`, "skipped", "no such uploaded photo");
          break;
        }
        images[op.slide] = ctx.userBufs[p];
        log(op.op, op.slide, reason, `slide ${op.slide} → uploaded photo ${p}`);
        break;
      }
      case "swap_images": {
        if (!inRange(op.slide) || !inRange(op.slideB) || op.slide === op.slideB) {
          log(op.op, op.slide, reason, "", "skipped", "bad slide indices");
          break;
        }
        [images[op.slide], images[op.slideB]] = [images[op.slideB], images[op.slide]];
        log(op.op, op.slide, reason, `swapped images of slides ${op.slide} and ${op.slideB}`);
        break;
      }
      case "reorder": {
        const order = op.order ?? [];
        const valid =
          order.length === deck.length &&
          new Set(order).size === deck.length &&
          order.every((i) => i >= 0 && i < deck.length);
        if (!valid) {
          log(op.op, null, reason, `order=[${order.join(", ")}]`, "skipped", "not a valid permutation");
          break;
        }
        deck = order.map((i) => deck[i]);
        images = order.map((i) => images[i]);
        renumberReasons(deck);
        log(op.op, null, reason, `new order [${order.join(", ")}]`);
        break;
      }
      case "drop_slide": {
        if (!inRange(op.slide)) {
          log(op.op, op.slide, reason, "", "skipped", "bad slide index");
          break;
        }
        const role = deck[op.slide].role;
        if (role === "title" || role === "cta") {
          log(op.op, op.slide, reason, `role ${role}`, "skipped", "cannot drop the hook or CTA");
          break;
        }
        if (deck.length <= 3) {
          log(op.op, op.slide, reason, "", "skipped", "deck already at minimum length");
          break;
        }
        const dropped = deck[op.slide].text;
        deck.splice(op.slide, 1);
        images.splice(op.slide, 1);
        renumberReasons(deck);
        log(op.op, op.slide, reason, `dropped "${dropped}"`);
        break;
      }
      case "reposition_caption": {
        if (!inRange(op.slide)) {
          log(op.op, op.slide, reason, "", "skipped", "bad slide index");
          break;
        }
        const align: Align =
          op.align === "left" || op.align === "right" ? op.align : "center";
        const pos: SlidePos = {
          x: op.x != null ? clamp01(op.x) : 0.5,
          y: op.y != null ? clamp01(op.y) : 0.58,
          align,
        };
        deck[op.slide].pos = pos;
        log(op.op, op.slide, reason, `pos → (${pos.x.toFixed(2)}, ${pos.y.toFixed(2)}, ${align})`);
        break;
      }
      case "add_slide": {
        const text = op.text ? cleanCaption(op.text) : "";
        if (!text) {
          log(op.op, op.slide, reason, "", "skipped", "empty text");
          break;
        }
        if (deck.length >= 10) {
          log(op.op, op.slide, reason, "", "skipped", "deck already at max length (10)");
          break;
        }
        // Insert after `slide`, but never past the CTA — new value slides stay
        // before it. Falls back to just-before-CTA (or end) if slide is unset.
        const ctaIdx = deck.findIndex((s) => s.role === "cta");
        let at = inRange(op.slide) ? op.slide + 1 : ctaIdx >= 0 ? ctaIdx : deck.length;
        if (ctaIdx >= 0 && at > ctaIdx) at = ctaIdx;
        const kw = op.keywords?.length ? op.keywords.slice(0, 5) : [];
        const img = await ctx.resourceStockImage(kw, text);
        // If sourcing fails (no PEXELS key), reuse a neighbour so the new slide
        // still composites instead of crashing the run with a missing image.
        const fallbackImg = images[Math.max(0, at - 1)] ?? images[0];
        deck.splice(at, 0, {
          role: "reason",
          number: null,
          text,
          imageKeywords: kw,
          body: null,
        });
        images.splice(at, 0, img ?? fallbackImg);
        renumberReasons(deck);
        log(
          op.op,
          at,
          reason,
          `inserted reason "${text}"${img ? "" : " (no stock image — reused a neighbour)"}`,
        );
        break;
      }
      case "regenerate_deck": {
        const fresh = await ctx.regenerateDeck(op.guidance ?? "");
        if (!fresh) {
          log(op.op, null, reason, op.guidance ?? "", "skipped", "regeneration unavailable/failed");
          break;
        }
        deck = fresh.deck.map((s) => ({ ...s }));
        images = [...fresh.images];
        log(op.op, null, reason, `whole deck regenerated with guidance: "${op.guidance ?? ""}"`);
        break;
      }
      default:
        log(op.op, op.slide, reason, "", "skipped", "unknown operation");
    }
  }

  // Backstop for the recurring count bug: the hook's leading list count must
  // equal the number of reason slides. The judge is told this, but if it drifts
  // (bumped the hook to "5" without a matching add_slide), fix the number here so
  // the deck never promises N and delivers M. Scoped to a small leading integer
  // so it can't mangle a hook whose first number is a real stat ("burn 500 …").
  const reasonCount = deck.filter((s) => s.role === "reason").length;
  if (reasonCount >= 2) {
    const titleIdx = deck.findIndex((s) => s.role === "title");
    if (titleIdx >= 0) {
      const before = deck[titleIdx].text;
      const m = before.match(/^(\D*?)(\d+)\b/);
      if (m) {
        const n = parseInt(m[2], 10);
        if (n >= 2 && n <= 10 && n !== reasonCount) {
          deck[titleIdx].text = before.replace(/^(\D*?)\d+\b/, `$1${reasonCount}`);
          log(
            "rewrite_caption",
            titleIdx,
            "auto: hook count must equal the number of value slides",
            `"${before}" → "${deck[titleIdx].text}"`,
          );
        }
      }
    }
  }

  return { deck, images, applied };
}

/** Convenience: an op is a no-op if the judge approved with nothing to do. */
export function hasWork(verdict: JudgeVerdict | null): boolean {
  return !!verdict && verdict.operations.length > 0;
}

// Re-exported for the route's typing convenience.
export type { SlideRole };
