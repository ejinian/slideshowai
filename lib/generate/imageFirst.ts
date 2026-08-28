import sharp from "sharp";
import { tryCopyModel } from "./copyModel";
import type { RunLogger } from "./diagnostics";
import {
  listicleStructure,
  explicitListCount,
  overlongCaptions,
  MAX_CAPTION_WORDS,
  type ListicleSlide,
  type SlideRole,
} from "./listicle";
import { scanDeckForAiLingo, scanDeckShape } from "./aiLingo";
import { formulaEcho } from "./hookBank";
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

// Image-first generation for USER-UPLOADED photos.
//
// The uploads ARE the content, so this inverts the library flow: one gpt-4o
// vision call SEES every photo, writes captions grounded in what's actually
// shown, assigns each slide its best photo, orders for the hook, and EXCLUDES
// photos that don't fit the story (or are low quality). Slides with no fitting
// photo get photoIndex = -1 so the caller can fill them from the stock library.
//
// Structure/roles mirror the listicle (title → reasons → one plug → cta) so
// everything downstream (compositing, editor, posting) is unchanged.

const THUMB_W = 512; // grounding needs more detail than library matching

export interface ImageFirstRequest {
  niche: string;
  description: string;
  slideCount: number;
  slideshowCount: number;
  exemplars?: string;
  /** Static curated hook-formula bank for slide 1 (may be "" / undefined). */
  hooks?: string;
  /** How much text a slide carries. See usesBody(). */
  detail?: DetailLevel;
}

export interface ImageFirstSlide extends ListicleSlide {
  /** index into the uploaded photos, or -1 = fill this slide from stock. */
  photoIndex: number;
}

export interface ImageFirstResult {
  slideshows: ImageFirstSlide[][];
  /** photo indices no variation used (unrelated / low quality). */
  excluded: number[];
}

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["slideshows"],
  properties: {
    slideshows: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["slides", "excluded_photos"],
        properties: {
          slides: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["role", "number", "text", "image_keywords", "photo_index"],
              properties: {
                role: { type: "string", enum: ["title", "reason", "plug", "cta"] },
                number: { type: ["integer", "null"] },
                text: { type: "string" },
                image_keywords: { type: "array", items: { type: "string" } },
                photo_index: { type: "integer" },
              },
            },
          },
          excluded_photos: { type: "array", items: { type: "integer" } },
        },
      },
    },
  },
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
  "You are a world-class TikTok Photo Mode strategist. You are handed the user's " +
  "OWN photos (numbered) and must build a scroll-stopping slideshow FROM them.\n" +
  "THE USER'S TOPIC DRIVES EVERY SLIDE. The whole slideshow must deliver on the " +
  "topic they gave — the hook and every caption. Never invent a different subject " +
  "just because the photos suggest one, and never confine the topic to one slide.\n" +
  "PROCESS:\n" +
  "1. Look at EVERY photo and understand what it actually shows.\n" +
  "2. Write the slideshow that delivers the user's TOPIC, then pick the photo that " +
  "best accompanies each caption.\n" +
  "3. SLIDE 1 IS THE HOOK: pick the single most scroll-stopping photo and write a " +
  "pattern-interrupt hook for it (bold/contrarian claim, curiosity gap, or callout). " +
  "If slide 1 is boring, nothing else matters.\n" +
  "4. Assign each slide exactly one photo via photo_index, and ORDER them for " +
  "maximum swipe-through. Never assign the same photo to two slides.\n" +
  "NEVER CONTRADICT WHAT A PHOTO SHOWS. Many photos contain readable data — view " +
  "counts, prices, dates, scores, follower numbers. Before pairing a caption with " +
  "a photo, READ those numbers and check the caption is consistent with them. A " +
  "caption about a disappointing result must not sit on a screenshot showing a " +
  "great one, and vice versa. If a beat needs 'the bad month' and only 'the good " +
  "month' is left, reorder the slides so each beat gets the photo that proves it.\n" +
  "CAPTIONS MUST NOT NARRATE THE PHOTO. The caption carries the idea; the photo is " +
  "just the backdrop. It only has to be COMPATIBLE with the image — it must never " +
  "describe what is literally happening in it. NEVER prefix a caption with a label " +
  "of the photo's contents (banned: \"mirror check-in:\", \"gym data:\", \"arm " +
  "flex:\", \"meal prep:\"). A mirror selfie does NOT require the word 'mirror'; a " +
  "treadmill photo does NOT require the words 'gym data'.\n" +
  "VOICE — sound like a real creator, not a brand: NO exclamation marks (none); no " +
  "Title Case headlines; ALL LOWERCASE — write the way a person texts, no capital " +
  "at the start of a caption, lowercase \"i\", capitals only for acronyms; ban clichés " +
  "and filler (\"you're probably making\", \"did you know\", \"game-changer\", " +
  "\"unlock\", \"elevate\", \"level up\"). BANNED FILLER OPENERS, which announce " +
  "that something vague is coming: \"it's all about X\", \"it all comes down to " +
  "X\", \"the key is X\", \"the secret is X\", \"X is your secret weapon\", \"X " +
  "seals the deal\", \"X is key\", \"X is a must\" — name the thing directly instead (not " +
  "\"it's all about body fat percentage\" but \"your body fat has to get to " +
  "10-15% before abs show\").\n" +
  "ONE LINE PER SLIDE. This is the rule people break most, so read it twice. A " +
  "caption is ONE short sentence — 6 to 12 words, 14 at the very most. Never a " +
  "stacked list, never a second sentence explaining the first, never a line break. " +
  "If you are writing two sentences you have two ideas: keep the sharper one and " +
  "delete the other. The real examples above sometimes stack several lines onto one " +
  "slide — do NOT copy that shape, read them for VOICE only.\n" +
  "No hashtags. NEVER use emojis — the caption font has no emoji glyphs, so any emoji " +
  "bakes onto the slide as an empty box. Be concrete and a little contrarian.\n" +
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
  "PUNCTUATION TELLS — these are how a viewer spots AI writing instantly:\n" +
  "• NEVER use an em dash (—) or en dash (–) in a caption. Type a comma, a full " +
  "stop, or start a new line, the way a person texts.\n" +
  "• NO EXPLAINER COLON: never write a label, a colon, then the explanation " +
  "(banned: \"the shift: niche content was the difference\", \"the result: more " +
  "followers\"). Say it directly. A colon is fine only when it IS the joke or " +
  "opens a list (\"everyone: stop chasing views\", \"reasons we're empty at 7am:\").\n" +
  "For every slide also return image_keywords: 3-5 stock-photo SEARCH terms — the " +
  "first is the query: 2-4 plain words naming the literal visible subject by its " +
  "common name (\"bench press\", not \"lifter mid-rep side view\"); the rest are " +
  "supporting visible objects. No moods, camera directions, or abstractions.";

// The listicle shape is NOT universal — it only describes decks of 4+. Appending
// it unconditionally contradicted the short-deck framework in the user message
// ("It is NOT a shrunken listicle"), and the model split the difference: a
// 3-slide deck built like a listicle with the numbers filed off.
const LISTICLE_STRUCTURE =
  "\nSTRUCTURE (listicle): a numbered TITLE hook, then numbered REASON slides that " +
  "each deliver one concrete point of the topic, and a CTA last. There is NO ad or " +
  "product slide — every middle slide is pure value, UNLESS the user's topic " +
  "explicitly asks for a plug, in which case the PLUG section in the user message " +
  "overrides this.";

function systemFor(count: number): string {
  return count > SHORT_DECK_MAX ? SYSTEM + LISTICLE_STRUCTURE : SYSTEM;
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
  req: ImageFirstRequest,
  count: number,
  reasonCount: number,
  nPhotos: number,
  keepPhotoOrder = false,
  photosArePool = false,
): string {
  const framework = frameworkBlock(count);
  // See lib/generate/viralExamples.ts — voice reference, not templates.
  const voice = viralExamplesBlock(req.niche);
  // Conditional plug — see lib/generate/plugRequest.ts. Empty unless asked for.
  const plug = plugBlock(detectPlug(req.description));
  // The user locked the order. This has to be said, not just enforced after the
  // fact: the standing instruction is to reorder for the hook, so without this
  // the model writes each caption for a photo it will not be given.
  const order = keepPhotoOrder
    ? "PHOTO ORDER IS LOCKED BY THE USER. Slide 1 uses Photo 0, slide 2 uses " +
      "Photo 1, and so on in order — you may NOT resequence them, not even to " +
      "put a stronger image on the hook. Set photo_index to the slide's own " +
      "position and write each caption to fit the photo it actually lands on. " +
      "Photo 0 is the hook whether or not you would have chosen it, so make its " +
      "caption carry the scroll-stop instead.\n"
    : "";
  return (
    (order ? `${order}\n` : "") +
    (voice ? `${voice}\n\n` : "") +
    (plug ? `${plug}\n\n` : "") +
    (req.exemplars ? `${req.exemplars}\n\n` : "") +
    // A one-slide post has no slide 2 to open a loop toward — its framework
    // replaces the hook bank rather than competing with it.
    (req.hooks && count > 1 ? `${req.hooks}\n\n` : "") +
    (framework ? `${framework}\n\n` : "") +
    // Same rule as listicle.ts: a stated topic owns the subject outright, so the
    // niche isn't mentioned at all. It's only named when there's nothing else.
    (req.description
      ? `TOPIC — what this WHOLE slideshow must be about: ${req.description}\n` +
        `That topic is the entire subject. Do not widen it, and do not blend in ` +
        `the creator's trade or any other industry. COVER EVERY NAMED PART: when ` +
        `the topic lists components ("with diet and exercise") each one gets real ` +
        `coverage — a deck that covers exercise but never diet failed the topic — ` +
        `and when it asks a question ("what's most important") a slide must ` +
        `actually answer it.\n`
      : `Niche: ${req.niche}\n` +
        `TOPIC — what this WHOLE slideshow must be about: (no topic given — pick ` +
        `the most scroll-stopping angle these photos genuinely support)\n`) +
    `You have ${nPhotos} photos, numbered 0..${nPhotos - 1} (shown below).\n\n` +
    `Build ${req.slideshowCount} DISTINCT slideshow variation(s). Each variation:\n` +
    // 1-3 slides are their own formats; 4+ keeps the original wording.
    (count <= SHORT_DECK_MAX
      ? shortDeckPlan(count)
          .split("\n")
          .filter(Boolean)
          .map((l) => (/^Build EXACTLY/.test(l) ? `- ${l}` : `  ${l}`))
          .join("\n") + "\n"
      : bodyBlock(req.detail) +
        `- EXACTLY ${count} slides in order: slide 1 role "title" — the hook, in ` +
        `whatever SHAPE suits the topic. A numbered list is one option, not the ` +
        `default; if it states a list count that count must be ${reasonCount}. ` +
        `The hook decides the deck: state a count and the value slides are ` +
        `numbered to match, state none and they carry no numbers. ` +
        `Slides 2–${count} role "reason" ` +
        `— do not write numbers into the caption text yourself; they are added ` +
        `automatically when the hook states a count. There is NO call-to-action slide — never end on ` +
        `"follow for more" or "link in bio"; the last slide is your strongest ` +
        `remaining value slide.\n`) +
    (photosArePool
      ? `- These photos come from the creator's COLLECTION — a pool, not a hand-staged ` +
        `set. Prefer them, but if NO photo genuinely fits a slide's caption (a ` +
        `nutrition slide when the pool has no food photo anywhere), set photo_index ` +
        `-1 — a stock photo matched to that caption fills the slide. NEVER force an ` +
        `unrelated photo onto a caption; a wrong photo is worse than a stock one.\n`
      : `- Assign EVERY slide a real photo_index. You have ${nPhotos} photos for ${count} ` +
        `slides, so a real photo exists for every slide — only use -1 if you genuinely ` +
        `have fewer photos than slides.\n` +
        `- excluded_photos is for leftovers only. NEVER exclude so many that fewer than ` +
        `${count} photos remain.\n`) +
    (req.slideshowCount > 1
      ? "Make each variation a genuinely different hook angle and photo order.\n"
      : "")
  );
}

async function thumbnails(buffers: Buffer[]): Promise<(string | null)[]> {
  return Promise.all(
    buffers.map(async (b) => {
      try {
        const out = await sharp(b)
          .resize({ width: THUMB_W, withoutEnlargement: true })
          .jpeg({ quality: 70 })
          .toBuffer();
        return `data:image/jpeg;base64,${out.toString("base64")}`;
      } catch {
        return null;
      }
    }),
  );
}

// No `plug` role: every middle slide is pure value. (SlideRole still allows
// "plug" so previously-stored slideshows keep rendering.)
function expectedRole(i: number, count: number): SlideRole {
  if (i === 0) return "title";
  // Only SHORT decks still end on the "cta" role, where it is the payoff slot
  // rather than a call to action. A real listicle ends on a value slide — see
  // listicleStructure().
  if (i === count - 1 && count <= SHORT_DECK_MAX) return "cta";
  return "reason";
}

interface RawSlide {
  body?: string | null;
  role?: SlideRole;
  number?: number | null;
  text?: string;
  image_keywords?: string[];
  photo_index?: number;
}

// See the pool-fit audit in generateImageFirst for how this is used.
// Tightened 2026-08-27 (run 71): the first version kept a physique photo under
// "lifting heavier isn't enough if your diet is inconsistent" because the
// caption also mentioned lifting — Christian's rule is that a caption whose
// POINT involves food gets a food image, full stop.
export const POOL_AUDIT_SYSTEM =
  "You audit photo choices for a creator's TikTok slideshow. The photos are " +
  "the creator's own; the captions carry advice.\n" +
  "• KEEP the creator's photo when the caption is purely about training, " +
  "physique, effort, habits, or results the body itself evidences — the " +
  "photo is proof, not illustration, and it does not need to depict the " +
  "caption's action.\n" +
  "• FAIL the pairing whenever the caption's point involves a concrete " +
  "subject the photo does not show: food, meals, diet, nutrition, " +
  "supplements, sleep, a product, a place, an object. This INCLUDES captions " +
  "that mention training alongside it — 'lifting heavier isn't enough if " +
  "your diet is inconsistent' is a DIET slide and fails over a gym flex " +
  "photo; 'training without enough food is just expensive cardio' is a FOOD " +
  "slide. If the caption names food or eating at all and the photo shows " +
  "none, fail it.\n" +
  "• Exception — slide 0 only: a hook that states the deck's OVERALL promise " +
  "('skip gym or diet and wonder why nothing changes') may keep the " +
  "creator's strongest photo; it is the face of the deck.\n" +
  "A failed slide gets a stock photo matched to its caption instead, so " +
  "failing is cheap and a wrong pairing is expensive.";

// Enforce role/number by position (keep the model's text + photo choice), and
// sanitize photo_index: in range or -1, with no repeats within the slideshow.
function normalize(
  raw: RawSlide[],
  count: number,
  reasonCount: number,
  nPhotos: number,
  keepPhotoOrder = false,
  wantsBody: boolean,
  /** Collection-pool photos: a -1 stays -1 (stock fills it) instead of being
   *  backfilled with an unused pool photo the model judged unfitting. */
  allowStockGaps = false,
): ImageFirstSlide[] {
  const used = new Set<number>();
  const out: ImageFirstSlide[] = [];
  for (let i = 0; i < count; i++) {
    const role = expectedRole(i, count);
    // Short decks (1-3) carry NO numbers: no headline count, and no inline "1."
    // on the middle slide — layoutSlide bakes that prefix, which would wreck a
    // three-beat turn.
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
      reasonCount >= 2 && explicitListCount(raw[0]?.text ?? "") != null;
    const number =
      role === "title"
        ? numbered
          ? reasonCount
          : null
        : role === "cta"
          ? null
          : numbered
            ? i
            : null;
    const text =
      (raw[i]?.text ?? "").trim() ||
      (role === "title"
        ? numbered
          ? `${reasonCount} things to know`
          : "here's the one thing nobody tells you"
        : role === "cta"
          ? "Try it free → link in bio"
          : `Reason ${number ?? ""}`.trim());
    // Locked order: slide i takes photo i, full stop. The model is told this in
    // the prompt, but the prompt is a request and this is the guarantee — its
    // standing instruction is to reorder for the hook, so it drifts.
    let photoIndex = keepPhotoOrder ? (i < nPhotos ? i : -1) : (raw[i]?.photo_index ?? -1);
    if (
      !Number.isInteger(photoIndex) ||
      photoIndex < 0 ||
      photoIndex >= nPhotos ||
      used.has(photoIndex)
    ) {
      photoIndex = -1; // out of range / duplicate → stock fill
    }
    if (photoIndex >= 0) used.add(photoIndex);
    out.push({
      role,
      number,
      text,
      body: wantsBody
        ? (raw[i]?.body ?? "").toString().trim() || null
        : null,
      imageKeywords: (raw[i]?.image_keywords ?? [])
        .map((k) => String(k).trim())
        .filter(Boolean)
        .slice(0, 5),
      photoIndex,
    });
  }

  // Backfill: in an Upload run the user expects THEIR photos, never stock. If
  // the model left a slide at -1 (or over-excluded) while unused uploads remain,
  // hand it the next unused one. Stock can only appear when uploads < slides.
  // EXCEPT collection pools (2026-08-27, Christian): the pool photo the model
  // rejected for a caption really doesn't fit it (a gym selfie under a
  // nutrition slide), so the gap goes to caption-matched stock instead.
  if (!allowStockGaps) {
    const spare = Array.from({ length: nPhotos }, (_, i) => i).filter(
      (i) => !used.has(i),
    );
    for (const slide of out) {
      if (slide.photoIndex < 0 && spare.length > 0) {
        const next = spare.shift() as number;
        slide.photoIndex = next;
        used.add(next);
      }
    }
  }
  return out;
}

/**
 * Generate image-first slideshows from the user's uploaded photos. Returns null
 * on any vision failure so the caller can fall back to copy-first + positional
 * uploads (the pre-existing behavior).
 */
export async function generateImageFirst(
  req: ImageFirstRequest,
  photos: Buffer[],
  diag?: RunLogger | null,
  /** The user arranged the photos and locked the order: slide N takes photo N,
   *  and the model must write to the photo it is given instead of resequencing
   *  for the hook. Enforced in normalize(), not just asked for in the prompt. */
  keepPhotoOrder = false,
  /** Photos came from a collection pool: unfitting slides may stay -1 for a
   *  caption-matched stock fill instead of being backfilled from the pool. */
  photosArePool = false,
): Promise<ImageFirstResult | null> {
  // Same provider seam as the stock path (lib/generate/copyModel.ts), so an A/B
  // covers uploads too — they are the PRIMARY flow, and testing voice on stock
  // only would measure the smaller half.
  //
  // ⚠️ This call is VISION. Whatever GEN_PROVIDER points at must actually see
  // images; if it can't, this returns null and the route falls back to
  // copy-first + positional assignment, which still produces a deck but is a
  // real quality drop. That fallback is silent by design, so on the first
  // upload run with a new provider CHECK `04_*` in the diagnostics folder —
  // a run that fell back has no vision decisions in it.
  const cm = tryCopyModel({ timeoutMs: 60_000 });
  if (!cm || photos.length === 0) return null;

  const thumbs = await thumbnails(photos);
  const usable = thumbs
    .map((t, i) => ({ t, i }))
    .filter((x): x is { t: string; i: number } => x.t !== null);
  if (usable.length === 0) return null;

  const s = listicleStructure(req.slideCount);
  const wantsBody = usesBody(s.count, req.detail);
  const n = Math.min(Math.max(Math.floor(req.slideshowCount) || 1, 1), 5);

  const content: Array<
    | { type: "text"; text: string }
    | { type: "image_url"; image_url: { url: string; detail: "low" } }
  > = [
    {
      type: "text",
      text: buildUser(
        { ...req, slideshowCount: n },
        s.count,
        s.reasonCount,
        usable.length,
        keepPhotoOrder,
        photosArePool,
      ),
    },
    { type: "text", text: "Your photos:" },
  ];
  usable.forEach((u, idx) => {
    content.push({ type: "text", text: `Photo ${idx}:` });
    content.push({ type: "image_url", image_url: { url: u.t, detail: "low" } });
  });

  // Dump the exact instructions the vision model got (image data omitted — the
  // photos themselves are saved separately as uploads/upload_N.*).
  if (diag) {
    await diag.text(
      "02_imagefirst_prompt.txt",
      `MODEL: ${cm.label} (vision)\nSTRUCTURE: count=${s.count} reasonCount=${s.reasonCount} (no plug slide — every middle slide is pure value)\nPHOTOS SHOWN: ${usable.length} (model index -> original upload index: ${usable
        .map((u, idx) => `${idx}->${u.i}`)
        .join(", ")})\n\n===== SYSTEM =====\n${systemFor(s.count)}\n\n===== USER =====\n${
        content.find((c) => c.type === "text")?.type === "text"
          ? (content[0] as { text: string }).text
          : ""
      }\n`,
    );
  }

  let parsed: {
    slideshows?: { slides?: RawSlide[]; excluded_photos?: number[] }[];
  };
  let lastLingo: { slide: number; tells: string[] }[] = [];
  // A requested plug is a hard requirement — see the same guard in listicle.ts.
  const plug = detectPlug(req.description);
  let plugMissing = false;
  let plugInHook = false;
  let overlong: { slide: number; words: number }[] = [];
  let sameShape: { slides: number[] } | null = null;
  let echoed: string | null = null;
  try {
    // One voice retry, mirroring the stock path. The prompt ban leaks (a run
    // shipped "secret weapon" while that phrase was banned in its own prompt),
    // so the check is mechanical and the model is told exactly what to remove.
    let rawText = "{}";
    for (let attempt = 0; attempt < 2; attempt++) {
      const msgs = [
        { role: "system" as const, content: systemFor(s.count) },
        { role: "user" as const, content },
      ];
      if (
        attempt > 0 &&
        (lastLingo.length || plugMissing || plugInHook || overlong.length || echoed || sameShape)
      ) {
        const notes = [
          plugMissing && plug.target
            ? `CRITICAL: your previous attempt never mentioned "${plug.target}". The user asked for that plug. Put "${plug.target}" — spelled exactly like that — on ONE middle slide.`
            : "",
          plugInHook && plug.target
            ? `CRITICAL: the hook (slide 1) named "${plug.target}". A hook that names the brand reads as an ad and kills reach. Rewrite the hook with NO brand words — open on the pain or payoff a stranger relates to — and keep the name on ONE middle slide only.`
            : "",
          lastLingo.length
            ? "Your previous attempt used phrasing that reads as machine-written. " +
              "Rewrite those slides so they say the same thing the way a person " +
              "actually talks, and REMOVE these entirely: " +
              lastLingo.map((l) => `slide ${l.slide}: ${l.tells.join(", ")}`).join("; ") +
              "."
            : "",
          echoed
            ? `The hook copied a formula example nearly word-for-word ("${echoed}"). The formulas are SHAPES, not scripts — rewrite the hook in completely fresh words, keeping the shape.`
            : "",
          overlong.length
            ? "These captions are TOO LONG: " +
              overlong.map((o) => `slide ${o.slide} (${o.words} words)`).join(", ") +
              `. Rewrite each as ONE sentence of at most ${MAX_CAPTION_WORDS} words with NO line breaks. Do not abbreviate to fit — pick the single sharpest idea and cut the rest.`
            : "",
          sameShape
            ? `DECK RHYTHM: slides ${sameShape.slides.join(", ")} are all the same balanced two-clause sentence ("X but Y", "X, not Y", "X, so Y"). A human deck is bursty — keep at most TWO contrast constructions, and make the rest blunt plain statements or fragments, with genuinely varied lengths.`
            : "",
        ].filter(Boolean);
        msgs.push({
          role: "user" as const,
          content: [
            {
              type: "text" as const,
              text:
                notes.join(" ") +
                " Keep every other slide, the photo assignment and the structure identical.",
            },
          ],
        });
      }
      const completion = await cm.client.chat.completions.create({
        model: cm.model,
        messages: msgs,
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "image_first",
            strict: true,
            schema: wantsBody ? SHORT_SCHEMA : SCHEMA,
          },
        },
      });
      rawText = completion.choices[0]?.message?.content ?? "{}";
      try {
        const peek = JSON.parse(rawText) as {
          slideshows?: { slides?: { text?: string; body?: string | null }[] }[];
        };
        const peeked = peek.slideshows?.[0]?.slides ?? [];
        lastLingo = scanDeckForAiLingo(peeked);
        plugMissing = !mentionsTarget(peeked, plug.target);
        // Same inverse guard as listicle.ts: brand on a middle slide, never
        // the hook — a branded hook reads as an ad.
        plugInHook =
          plug.requested && namesBrand(peeked[0]?.text ?? "", plug.target);
        overlong = overlongCaptions(peeked);
        echoed = formulaEcho(peeked[0]?.text ?? "");
        sameShape = scanDeckShape(peeked);
      } catch {
        lastLingo = [];
        plugMissing = false;
        plugInHook = false;
        overlong = [];
        echoed = null;
        sameShape = null;
      }
      if (
        lastLingo.length === 0 &&
        !plugMissing &&
        !plugInHook &&
        overlong.length === 0 &&
        !echoed &&
        !sameShape
      )
        break;
      if (diag) {
        await diag.text(
          `03b_ai_lingo_retry${attempt}.txt`,
          lastLingo.map((l) => `slide ${l.slide}: ${l.tells.join(", ")}`).join("\n"),
        );
      }
    }
    if (diag) await diag.text("03_imagefirst_raw_response.json", rawText);
    parsed = JSON.parse(rawText);
  } catch (e) {
    if (diag) {
      await diag.text(
        "03_imagefirst_raw_response.json",
        `VISION CALL FAILED — falling back to copy-first + positional.\n${e instanceof Error ? e.message : String(e)}`,
      );
    }
    return null;
  }

  const rawShows = parsed.slideshows ?? [];
  if (rawShows.length === 0) return null;

  // The model indexes photos by their position in `usable`; map back to the
  // caller's original photo indices.
  const toOriginal = (p: number) => (p >= 0 && p < usable.length ? usable[p].i : -1);

  const slideshows: ImageFirstSlide[][] = [];
  for (let k = 0; k < n; k++) {
    const src = rawShows[k] ?? rawShows[rawShows.length - 1];
    const norm = normalize(
      src.slides ?? [],
      s.count,
      s.reasonCount,
      usable.length,
      keepPhotoOrder,
      wantsBody,
      photosArePool,
    );
    slideshows.push(
      norm.map((sl) => ({ ...sl, photoIndex: toOriginal(sl.photoIndex) })),
    );
  }

  // ── Pool-fit audit (2026-08-27) ────────────────────────────────────────────
  // The pool prompt says "set photo_index -1 when nothing fits" and run 70
  // proved it leaks: "80 percent of your cut is chicken, rice, potatoes"
  // shipped over a back-flex photo. Mechanical per-slide backstop, the same
  // pattern as verifyPicks in liveImages: each assigned (caption, photo) pair
  // is audited in isolation, and a fail demotes the slide to -1 → the
  // caption-matched stock/AI gap fill. The bar is deliberately LAXER than the
  // stock judge's: these are the creator's own photos, and a physique shot
  // under training advice is the format working as intended (photo = proof,
  // not illustration). Fails open — an audit error keeps every photo.
  if (photosArePool) {
    const entries: { k: number; i: number; caption: string; thumb: string }[] = [];
    slideshows.forEach((show, k) =>
      show.forEach((sl, i) => {
        const t = sl.photoIndex >= 0 ? thumbs[sl.photoIndex] : null;
        if (t) entries.push({ k, i, caption: sl.text, thumb: t });
      }),
    );
    if (entries.length > 0) {
      try {
        const auditContent: Array<
          | { type: "text"; text: string }
          | { type: "image_url"; image_url: { url: string; detail: "low" } }
        > = [];
        entries.forEach((e, j) => {
          auditContent.push({
            type: "text",
            text: `Slide ${j} — caption: "${e.caption}". Its photo:`,
          });
          auditContent.push({
            type: "image_url",
            image_url: { url: e.thumb, detail: "low" },
          });
        });
        auditContent.push({
          type: "text",
          text: `Return verdicts: one boolean per slide in order (0..${entries.length - 1}); true = keep the photo.`,
        });
        const audit = await cm.client.chat.completions.create({
          model: cm.model,
          messages: [
            { role: "system", content: POOL_AUDIT_SYSTEM },
            { role: "user", content: auditContent },
          ],
          response_format: {
            type: "json_schema",
            json_schema: {
              name: "pool_audit",
              strict: true,
              schema: {
                type: "object",
                additionalProperties: false,
                required: ["verdicts"],
                properties: {
                  verdicts: { type: "array", items: { type: "boolean" } },
                },
              },
            },
          },
        });
        const verdicts = (
          JSON.parse(audit.choices[0]?.message?.content ?? "{}") as {
            verdicts?: boolean[];
          }
        ).verdicts;
        const demoted: { slide: number; caption: string }[] = [];
        entries.forEach((e, j) => {
          if (verdicts?.[j] === false) {
            slideshows[e.k][e.i].photoIndex = -1;
            demoted.push({ slide: e.i + 1, caption: e.caption });
          }
        });
        if (diag) {
          await diag.json("03c_pool_audit.json", {
            note:
              "Pool-fit audit — false demotes the slide to -1 (caption-matched " +
              "stock/AI fill). Physique shots under advice captions are kept by design.",
            audited: entries.length,
            demoted,
          });
        }
      } catch {
        // fail open — every assignment stands
      }
    }
  }

  const usedOriginals = new Set(
    slideshows.flat().map((sl) => sl.photoIndex).filter((p) => p >= 0),
  );
  const excluded = photos.map((_, i) => i).filter((i) => !usedOriginals.has(i));

  return { slideshows, excluded };
}
