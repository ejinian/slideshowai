import { NextResponse } from "next/server";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { createClient } from "@/utils/supabase/server";
import { createAdminClient } from "@/utils/supabase/admin";
import { isAdminEmail } from "@/lib/admins";
import {
  costOf,
  spendCredits,
  refundCredits,
  claimGenerationSlot,
  type Reservation,
} from "@/lib/billing/usage";
import {
  generateListicle,
  explicitListCount,
  type FormatBlueprint,
  type ListicleSlide,
  type ListicleRequest,
} from "@/lib/generate/listicle";
import { generateImageFirst } from "@/lib/generate/imageFirst";
import {
  judgeDeck,
  applyOperations,
  JUDGE_MODEL,
  type JudgedSlide,
  type AppliedOp,
} from "@/lib/generate/judge";
import { fetchTrendExemplars, exemplarsBlock } from "@/lib/generate/trendExemplars";
import { hookBankBlock } from "@/lib/generate/hookBank";
import { SHORT_DECK_MAX } from "@/lib/generate/captionFrameworks";
import { selectLiveBackgrounds } from "@/lib/generate/liveImages";
import { createRun, type RunLogger } from "@/lib/generate/diagnostics";
import { resolveNiche } from "@/lib/generate/nicheDetect";
import sharp from "sharp";
import { compositeSlide, prepareBackground } from "@/lib/generate/composite";
import {
  probeCaptionContrast,
  CONTRAST_FLOOR,
  type ContrastProbe,
} from "@/lib/generate/contrast";
import { selectBackgrounds } from "@/lib/generate/imageSelection";
import { DEFAULT_POS, type SlidePos } from "@/lib/generate/layout";
import { GYM_IMAGES } from "@/lib/library-images";
import { cleanCaption } from "@/lib/generate/cleanCaption";
import { scanDeckForAiLingo } from "@/lib/generate/aiLingo";
import { uploadWithRetry } from "@/lib/storage/upload";

// Sharp needs the Node.js runtime (not edge). Next auto-externalizes `sharp`.
export const runtime = "nodejs";
export const maxDuration = 120;

const SIGNED_URL_TTL = 60 * 60; // 1 hour

// Most photos a single deck can consume. Collections lift the cap on how many
// images you can STORE and reuse, but a slideshow is still 3-10 slides (the
// slideCount clamp below, and one slide per photo in upload mode), so a bigger
// pick would silently go unused. The composer says so rather than truncating
// behind the user's back.
const MAX_COLLECTION_PICK = 10;

type BackgroundMode = "collection" | "single";

interface GenerateBody {
  niche?: string;
  slideCount?: number;
  slideshowCount?: number;
  prompt?: string; // the "angle / product" box — used as the plug
  layout?: string;
  backgroundMode?: BackgroundMode;
  collection?: string;
  style?: string;
  model?: string;
  singleImage?: string; // optional data URL for "single" mode (legacy)
  /** Optional user photos (data URLs) — used for the first slides, the
   *  library fills the rest. Composer step 3. */
  userImages?: string[];
  /** Photos chosen from one of the user's own collections. Preferred over
   *  `userImages`: the bytes already live in the `collections` bucket, so the
   *  client sends ids instead of megabytes of base64. That's what lifts the
   *  10-photo cap and the ~4.5MB request-body ceiling data URLs ran into.
   *  NOTE: distinct from `collection`, which is a NICHE slug for stock. */
  collectionImageIds?: string[];
  /** "Remix this trend" only: the trend's format recipe (untrusted client
   *  input — sanitized by cleanFormat before it reaches the model prompt). */
  format?: FormatBlueprint;
  /** "Let AI decide" provenance — DIAGNOSTICS ONLY. Never reaches the model or
   *  any generation logic; it exists so a dump can tell whether a bad deck came
   *  from the PLANNER's direction or the GENERATOR's execution. */
  aiPlan?: AiPlanDiag;
  /** Supercharge: run the judge LLM pass over the finished draft and STREAM
   *  stage events back. Off = the normal single-shot JSON response, unchanged. */
  supercharge?: boolean;
  /** The user arranged their photos and wants that exact order: slide N gets
   *  photo N, and the vision model may not resequence for the hook. */
  keepPhotoOrder?: boolean;
}

/** What /api/suggest decided, plus what the user actually typed. */
interface AiPlanDiag {
  userPrompt?: string;
  angle?: string;
  rationale?: string;
  suggestions?: number;
  niche?: string;
  slides?: number;
  layout?: string;
  goal?: string;
}

// Clamp the AI-plan record to sane strings/lengths. Untrusted client input, but
// it is only ever written to a local diagnostics file — never to a prompt.
function cleanAiPlan(p: AiPlanDiag | undefined): AiPlanDiag | null {
  if (!p || typeof p !== "object") return null;
  const str = (v: unknown, max: number) =>
    typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined;
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
  return {
    userPrompt: str(p.userPrompt, 600),
    angle: str(p.angle, 200),
    rationale: str(p.rationale, 400),
    suggestions: num(p.suggestions),
    niche: str(p.niche, 40),
    slides: num(p.slides),
    layout: str(p.layout, 40),
    goal: str(p.goal, 40),
  };
}

// Clamp the remix blueprint to sane shapes/lengths; returns null when there's
// nothing usable so plain generations carry no format section at all.
function cleanFormat(f: FormatBlueprint | undefined): FormatBlueprint | null {
  if (!f || typeof f !== "object") return null;
  const str = (v: unknown, max: number) =>
    typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null;
  const anatomy = Array.isArray(f.anatomy)
    ? f.anatomy
        .slice(0, 6)
        .map((b) => ({
          slides: str(b?.slides, 12) ?? "",
          beat: str(b?.beat, 120) ?? "",
        }))
        .filter((b) => b.slides && b.beat)
    : [];
  const out: FormatBlueprint = {
    hookType: str(f.hookType, 40),
    exemplarCaption: str(f.exemplarCaption, 300),
    anatomy: anatomy.length > 0 ? anatomy : null,
  };
  return out.hookType || out.exemplarCaption || out.anatomy ? out : null;
}

function collectionImagePaths(): string[] {
  return GYM_IMAGES.map((p) =>
    path.join(process.cwd(), "public", p.replace(/^\//, "")),
  );
}

// Stock backgrounds via live Pexels (the caption-accurate path). Per slide: use
// the vision-approved Pexels photo, else the best Pexels result / a bundled local
// photo. Returns null when live sourcing is unavailable (no PEXELS_API_KEY) so
// the caller uses the frozen library.
async function buildStockBackgrounds(
  content: ListicleSlide[][],
  niche: string,
  collection: string | undefined,
  diag?: RunLogger | null,
  /** The user's prompt — the deck's real subject, so the vision judge can reject
   *  photos that match a caption's words but not the topic. */
  topic?: string,
): Promise<Buffer[][] | null> {
  const live = await selectLiveBackgrounds(
    content.map((slides) =>
      slides.map((s) => ({ caption: s.text, keywords: s.imageKeywords ?? [] })),
    ),
    niche,
    collection,
    diag,
    topic,
  );
  if (!live) return null;

  let localFallback: Buffer | null = null;
  const readLocal = async () => {
    if (!localFallback) {
      const paths = collectionImagePaths();
      localFallback = await readFile(
        paths[Math.floor(Math.random() * paths.length)],
      );
    }
    return localFallback;
  };

  return Promise.all(
    content.map((slides, ss) =>
      Promise.all(
        slides.map(async (_s, i) => {
          const r = live[ss][i];
          return r.approved ?? r.fallback ?? (await readLocal());
        }),
      ),
    ),
  );
}

// ── Supercharge plumbing ─────────────────────────────────────────────────────

/** A progress event the pipeline emits; streamed to the client in Supercharge
 *  mode, ignored (no-op) otherwise. */
interface StageEvent {
  stage: string;
  label?: string;
  count?: number;
}
type EmitStage = (e: StageEvent) => void;

interface JudgeSummary {
  model: string;
  decks: { approved: boolean; assessment: string; applied: AppliedOp[] }[];
}

interface PipelineResult {
  slideshows: unknown[];
  excludedPhotos: number;
  judge?: JudgeSummary;
}

/** Pipeline failure carrying the HTTP status the normal path should return. */
class PipelineError extends Error {
  status: number;
  code?: string;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function errorResponse(e: unknown): NextResponse {
  if (e instanceof PipelineError) {
    return NextResponse.json({ error: e.message, code: e.code }, { status: e.status });
  }
  const message = e instanceof Error ? e.message : "Failed to build slideshow.";
  return NextResponse.json({ error: message }, { status: 500 });
}

/** Run the pipeline as an NDJSON stream: one JSON object per line —
 *  {type:"stage",...} while it works, then {type:"result",...} or
 *  {type:"error",...}. See lib/generate/judge.ts for the judge itself. */
function streamPipeline(
  run: (emit: EmitStage) => Promise<PipelineResult>,
  /** Hand the credit reservation back — this path never surfaces a non-200. */
  onFailure: () => Promise<void>,
): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) =>
        controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
      try {
        const out = await run((e) => send({ type: "stage", ...e }));
        send({ type: "result", ...out });
      } catch (e) {
        await onFailure();
        const message = e instanceof Error ? e.message : "Generation failed.";
        const code = e instanceof PipelineError ? e.code : undefined;
        send({ type: "error", error: message, code });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      // Disable proxy buffering so stage events arrive as they happen.
      "X-Accel-Buffering": "no",
    },
  });
}

/** Emoji-clean + bake the inline list number into a caption. The single choke
 *  point both intake paths (and the judge's regenerate) funnel through, so the
 *  stored caption, the editor overlay and the bake always agree. */
function bakeCaption(s: ListicleSlide): ListicleSlide {
  const cleaned = cleanCaption(s.text);
  const body = s.body ? cleanCaption(s.body) || null : null;
  // Bake the list number INTO the caption and clear `number`. layoutSlide used
  // to prepend "1. " at render time, which made it the one part of a caption the
  // user could not edit. Stored decks that still carry a number keep rendering
  // through layoutSlide's prefix path, so nothing existing changes.
  const numbered =
    (s.role === "reason" || s.role === "plug") &&
    s.number != null &&
    !/^\s*\d+\s*[.):]/.test(cleaned);
  return {
    ...s,
    text: numbered ? `${s.number}. ${cleaned}` : cleaned || s.text,
    number: numbered ? null : s.number,
    body,
  };
}

/** Caption position for a slide — DEFAULT_POS everywhere except slides the judge
 *  explicitly repositioned (reposition_caption attaches `pos`). */
function posFor(slide: ListicleSlide): SlidePos {
  return (slide as JudgedSlide).pos ?? DEFAULT_POS;
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // AUTH IS THE GATE. Without this the whole pipeline — gpt-4o copy, the vision
  // judge, Pexels, sharp — ran for anonymous callers with no rate limit, no
  // quota and no charge. The UI never hit that path (AuthGate + the dashboard
  // redirect), so the guest branch was unreachable code AND an open spend
  // endpoint; it has been removed along with this check going in.
  if (!user) {
    return NextResponse.json(
      { error: "Sign in to generate slideshows.", code: "unauthorized" },
      { status: 401 },
    );
  }

  let body: GenerateBody;
  try {
    body = (await request.json()) as GenerateBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  // User-uploaded photos (Composer step 3). When present they ARE the content:
  // we generate image-first — the model SEES them, writes grounded captions,
  // orders for the hook, and excludes ones that don't fit the story.
  // Hoisted above slideCount because in Upload mode the photos decide the deck
  // size (below). Pure function of `body`, so the position doesn't matter.
  let userBufs: Buffer[] = (body.userImages ?? [])
    .slice(0, 10)
    .filter((u) => typeof u === "string" && u.startsWith("data:"))
    .map((u) => Buffer.from(u.split(",")[1] ?? "", "base64"))
    .filter((b) => b.length > 0);

  // Photos picked from one of the user's collections. RLS scopes the lookup to
  // the caller, so a foreign id simply returns nothing — no extra authz here.
  // The DB order is NOT used: `collectionImageIds` carries the user's chosen
  // order, and slide 1 is the hook, so which photo leads matters.
  const pickedIds = (body.collectionImageIds ?? []).filter(
    (id): id is string => typeof id === "string" && id.length > 0,
  );
  if (user && pickedIds.length > 0) {
    const { data: rows } = await supabase
      .from("collection_images")
      .select("id, storage_path")
      .in("id", pickedIds.slice(0, MAX_COLLECTION_PICK));
    const pathById = new Map(
      (rows ?? []).map((r) => [r.id as string, r.storage_path as string]),
    );
    const ordered = pickedIds
      .slice(0, MAX_COLLECTION_PICK)
      .map((id) => pathById.get(id))
      .filter((p): p is string => !!p);

    const downloaded = await Promise.all(
      ordered.map(async (path): Promise<Buffer | null> => {
        const { data, error } = await supabase.storage
          .from("collections")
          .download(path);
        if (error || !data) return null;
        return Buffer.from(new Uint8Array(await data.arrayBuffer()));
      }),
    );
    const bufs: Buffer[] = downloaded.filter(
      (b): b is NonNullable<typeof b> => b !== null && b.length > 0,
    );
    // A collection pick REPLACES any inline uploads — the composer sends one
    // or the other, and silently blending them would reorder the deck.
    if (bufs.length > 0) userBufs = bufs;
  }

  // Honor a count stated in the prompt ("3 exercises" → 3 value slides = 5 total)
  // over the slide dropdown, so the headline number never contradicts the topic.
  const promptCount = explicitListCount(body.prompt || "");
  // UPLOAD MODE: one slide per photo, always. The dropdown asking for 10 slides
  // when 6 photos were uploaded just produced 4 stock-filled slides in a deck the
  // user expected to be entirely their own photos. The photos are the hard
  // constraint, so they beat BOTH the dropdown and a count stated in the prompt.
  const slideCount =
    userBufs.length > 0
      ? Math.min(userBufs.length, 10)
      : promptCount != null
        ? Math.min(Math.max(promptCount + 2, 3), 10)
        : Math.min(Math.max(Number(body.slideCount) || 6, 3), 10);
  const slideshowCount = Math.min(
    Math.max(Number(body.slideshowCount) || 1, 1),
    5,
  );
  const mode: BackgroundMode = body.backgroundMode ?? "collection";

  const supercharge = body.supercharge === true;

  // ── Billing: RESERVE → run → refund on failure ─────────────────────────────
  // Both steps are atomic in Postgres (see 20260806120000_billing_atomic.sql).
  // The old flow read a snapshot, compared in JS, then wrote an absolute value,
  // so N parallel requests all passed the same check and all wrote the same
  // number — N decks for one charge. It also charged only AFTER persistence, so
  // any failure after the OpenAI spend was a free generation.
  //
  // Supercharge is priced here too: it buys a gpt-4.1 vision judge per deck and
  // can trigger a full regenerate, so it costs double.
  // Founder/admin accounts skip metering entirely (see lib/admins).
  const isAdmin = isAdminEmail(user.email);
  const admin = createAdminClient();
  const cost = costOf({ slideshowCount, supercharge });
  let reservation: Reservation | null = null;

  if (!isAdmin) {
    // A guard that ERRORED tells us nothing about the user, so it must not be
    // reported as a policy decision. Both still block the run — they just say
    // what actually happened. (Reporting a dead RPC as "you're generating too
    // fast" is what sent a real user chasing a rate limit that never existed.)
    const guardFailed = (detail: string) =>
      NextResponse.json(
        {
          error:
            "Something went wrong on our end starting this generation. Nothing was charged. Try again in a moment.",
          code: "billing_unavailable",
          detail,
        },
        { status: 500 },
      );

    // Compare-and-swap, not a check: only one concurrent request wins the slot.
    const slot = await claimGenerationSlot(admin, user.id);
    if (!slot.ok) {
      if (slot.reason === "error") return guardFailed(slot.detail);
      return NextResponse.json(
        {
          error:
            "You're generating too fast — give it a few seconds and try again.",
          code: "rate_limited",
        },
        { status: 429 },
      );
    }

    const spend = await spendCredits(admin, user.id, cost);
    if (!spend.ok) {
      if (spend.reason === "error") return guardFailed(spend.detail);
      return NextResponse.json(
        {
          error: supercharge
            ? "Not enough credits — Supercharge costs 2 per slideshow. Upgrade your plan or add credits."
            : "You've reached your plan's slideshow limit for this month. Upgrade your plan or add credits to keep generating.",
          code: "quota_exceeded",
        },
        { status: 402 },
      );
    }
    reservation = spend.value;
  }

  /** Hand the reservation back — the run failed, so it was never delivered. */
  const refund = async () => {
    if (reservation) {
      await refundCredits(admin, user.id, reservation).catch(() => {});
      reservation = null;
    }
  };

  // The whole pipeline (copy → images → optional judge → composite → persist)
  // runs inside this closure so the Supercharge path can STREAM stage events
  // while it works; the normal path just awaits the returned result. `emit` is a
  // no-op when not streaming. Errors throw PipelineError, mapped to a status by
  // the caller (or surfaced as a stream error event).
  const runPipeline = async (emit: EmitStage): Promise<PipelineResult> => {
  // Niche is no longer a user choice — derive it from the prompt so trend
  // exemplars + the aesthetic image pool still have a signal. "Let AI decide"
  // sends an explicit slug (body.collection) which always wins; manual mode
  // sends neither, so it's inferred here. Soft input: a wrong guess only means
  // less-targeted trends, never a broken deck. See lib/generate/nicheDetect.ts.
  const { slug: nicheSlug, label: nicheLabel } = resolveNiche(
    body.collection,
    body.prompt,
  );

  // Freshest real trending hooks for this niche, fed into every generation path
  // so copy mirrors what's actually going viral now (one fast indexed read).
  const exemplars = exemplarsBlock(
    await fetchTrendExemplars(supabase, nicheSlug, 8),
  );

  // Static curated hook formulas for slide 1, fed into every generation path
  // alongside the live trend exemplars. A soft style input (slide 1 only, never
  // overrides the topic) — see lib/generate/hookBank.ts.
  // Short decks carry no headline count, so the bank must not demand one.
  const hooks = hookBankBlock(slideCount > SHORT_DECK_MAX);

  // Forensic dump for this run (local dev only) — see lib/generate/diagnostics.
  const diag = await createRun(userBufs.length > 0 ? "upload" : "stock");
  if (diag) {
    await diag.json("01_request.json", {
      prompt: body.prompt,
      niche: nicheLabel,
      nicheDerived: !body.collection,
      collection: nicheSlug,
      layout: body.layout,
      slideCountRequested: Number(body.slideCount) || null,
      slideCountResolved: slideCount,
      slideCountDrivenBy:
        userBufs.length > 0
          ? "upload count (photos always decide the deck size)"
          : promptCount != null
            ? "explicit count in the prompt"
            : "slides dropdown",
      explicitListCountFromPrompt: promptCount,
      backgroundMode: mode,
      uploadedPhotos: userBufs.length,
      uploadedSizesKB: userBufs.map((b) => Math.round(b.length / 1024)),
      trendExemplarsInjected: exemplars.length > 0,
      hookBankInjected: hooks.length > 0,
    });
    if (exemplars) await diag.text("01b_trend_exemplars.txt", exemplars);
    if (hooks) await diag.text("01d_hook_bank.txt", hooks);
    // "Let AI decide" provenance: the planner's choices + what the user really
    // typed. Without this the dump's `prompt` is the AI's brief and looks
    // exactly like something a human wrote.
    const planned = cleanAiPlan(body.aiPlan);
    if (planned) {
      await diag.json("01c_ai_plan.json", {
        note: "Mode = Let AI decide. `userPrompt` is what the user actually typed (may be empty — photos alone drove this). Everything else was chosen by /api/suggest, NOT by the user.",
        ...planned,
      });
    }
    await Promise.all(
      userBufs.map((b, i) => diag.image(`uploads/upload_${i}`, b)),
    );
  }

  // 1) Copy. photoAssign[ss][i] = uploaded-photo index for that slide, or -1
  //    (fill from stock); null when there are no uploads or vision fell back.
  emit({ stage: "generating", label: "Writing the deck" });
  // Hoisted out of the try so the judge's regenerate_deck op can reuse it.
  const baseReq: ListicleRequest = {
    niche: nicheLabel,
    description: body.prompt || "",
    slideCount,
    slideshowCount,
    exemplars,
    hooks,
    format: cleanFormat(body.format),
  };
  let content: ListicleSlide[][];
  let photoAssign: number[][] | null = null;
  let excludedPhotos = 0;
  try {
    const req = baseReq;
    const imgFirst =
      userBufs.length > 0
        ? await generateImageFirst(req, userBufs, diag, body.keepPhotoOrder === true)
        : null;
    if (imgFirst) {
      content = imgFirst.slideshows;
      photoAssign = imgFirst.slideshows.map((sl) => sl.map((s) => s.photoIndex));
      excludedPhotos = imgFirst.excluded.length;
      if (diag) {
        await diag.json("04_photo_assignment.json", {
          note: "photoIndex refers to uploads/upload_<N>. -1 = no upload fit, filled from stock.",
          excludedUploads: imgFirst.excluded,
          perSlide: imgFirst.slideshows[0]?.map((s, i) => ({
            slide: i + 1,
            role: s.role,
            caption: s.text,
            photoIndex: s.photoIndex,
            image: s.photoIndex >= 0 ? `uploads/upload_${s.photoIndex}` : "STOCK FILL",
          })),
        });
      }
    } else {
      content = await generateListicle(req, diag);
      if (diag && userBufs.length > 0) {
        await diag.text(
          "03b_FALLBACK.txt",
          "Image-first vision FAILED — fell back to copy-first + positional upload assignment.",
        );
      }
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : "Generation failed.";
    const status = message.includes("OPENAI_API_KEY")
      ? 400
      : message.includes("quota")
        ? 429
        : 502;
    throw new PipelineError(message, status);
  }

  // Captions are baked by resvg with ONLY the TikTok Sans TTFs loaded
  // (composite.ts sets loadSystemFonts:false), and that family has no emoji
  // glyphs — so any emoji the copy model emits renders as a TOFU BOX on the
  // finished slide. Strip them here, the single choke point both intake paths
  // funnel through, so the stored caption, the editor overlay and the bake all
  // agree. (Digits are untouched: they're Emoji but not Emoji_Presentation.)
  content = content.map((slides) => slides.map(bakeCaption));

  emit({ stage: "illustrating", label: "Sourcing images" });

  // 2) Backgrounds. Image-first uploads drive their own slides via photoAssign;
  //    any -1 slot (or a positional-fallback gap) is filled from the caption-
  //    matched stock library. No uploads → the full library selection path
  //    (lib/generate/imageSelection.ts: vision → LLM text → keyword → random).
  const needsStock =
    userBufs.length === 0
      ? true
      : photoAssign
        ? photoAssign.some((row) => row.some((p) => p < 0))
        : userBufs.length < slideCount; // vision fell back → positional + fill
  let backgrounds: Buffer[] = [];
  let matched: Buffer[][] | null = null;
  try {
    if (userBufs.length > 0 && !needsStock) {
      // Every slide is covered by an uploaded photo — nothing to fetch.
    } else if (
      userBufs.length === 0 &&
      mode === "single" &&
      body.singleImage?.startsWith("data:")
    ) {
      backgrounds = [Buffer.from(body.singleImage.split(",")[1] ?? "", "base64")];
    } else {
      // Pure stock flow → live Pexels (caption-accurate). Skipped for upload
      // gap-fill; falls through to the library when live sourcing is off.
      if (userBufs.length === 0) {
        matched = await buildStockBackgrounds(
          content,
          nicheSlug,
          nicheSlug,
          diag,
          body.prompt || "",
        );
      }
      if (!matched) {
        const selected = await selectBackgrounds({
          supabase,
          // Frozen-library fallback (only when live Pexels is off). "other" has
          // no library collection, so use gym — the largest, historical default.
          collection: nicheSlug === "other" ? "gym" : nicheSlug,
          slideshows: content.map((slides) =>
            slides.map((s) => ({
              caption: s.text,
              keywords: s.imageKeywords ?? [],
            })),
          ),
        });
        if (selected) {
          matched = selected.buffers;
        } else {
          backgrounds = await Promise.all(
            collectionImagePaths().map((f) => readFile(f)),
          );
        }
      }
    }
  } catch {
    throw new PipelineError("Could not load background images.", 500);
  }
  if (userBufs.length === 0 && !matched && backgrounds.length === 0) {
    throw new PipelineError("No background images available.", 500);
  }

  // Resolve the final image for a slide. `finalImages` — set ONLY by the judge —
  // overrides the copy/stock resolution below, so the diag dump AND the
  // compositor both pick up the judge's image edits from one seam. Null in the
  // normal path ⇒ identical resolution to before.
  let finalImages: (Buffer | undefined)[][] | null = null;
  const resolveImage = (ssIdx: number, i: number): Buffer | undefined => {
    if (finalImages) return finalImages[ssIdx]?.[i];
    if (photoAssign) {
      const p = photoAssign[ssIdx]?.[i] ?? -1;
      if (p >= 0) return userBufs[p];
    } else if (userBufs[i]) {
      return userBufs[i];
    }
    return (
      matched?.[ssIdx]?.[i] ??
      backgrounds[(ssIdx * slideCount + i) % (backgrounds.length || 1)]
    );
  };

  // ── Supercharge: judge the finished draft, then apply the judge's edits ──
  let judgeSummary: JudgeSummary | undefined;
  if (supercharge) {
    // Re-source ONE stock background (the judge's resource_image op).
    const resourceStockImage = async (
      keywords: string[],
      caption: string,
    ): Promise<Buffer | null> => {
      const live = await buildStockBackgrounds(
        [[{ role: "reason", number: null, text: caption, imageKeywords: keywords }]],
        nicheSlug,
        nicheSlug,
        null,
        body.prompt || "",
      );
      return live?.[0]?.[0] ?? null;
    };

    // Re-source stock backgrounds for a whole fresh deck (regenerate_deck).
    const sourceStockDeck = async (
      deck: ListicleSlide[],
    ): Promise<(Buffer | undefined)[]> => {
      const live = await buildStockBackgrounds(
        [deck],
        nicheSlug,
        nicheSlug,
        null,
        body.prompt || "",
      );
      if (live) return live[0];
      const sel = await selectBackgrounds({
        supabase,
        collection: nicheSlug === "other" ? "gym" : nicheSlug,
        slideshows: [
          deck.map((s) => ({ caption: s.text, keywords: s.imageKeywords ?? [] })),
        ],
      });
      if (sel) return sel.buffers[0];
      const locals = await Promise.all(
        collectionImagePaths().map((f) => readFile(f)),
      );
      return deck.map((_s, i) => locals[i % locals.length]);
    };

    // Nuclear option: rebuild a deck from scratch with the judge's guidance,
    // then re-source its images. Returns null on any failure (op is skipped).
    const regenerateDeck = async (
      guidance: string,
    ): Promise<{ deck: ListicleSlide[]; images: (Buffer | undefined)[] } | null> => {
      try {
        const description = guidance
          ? `${body.prompt || ""}\n\nEditor guidance: ${guidance}`.trim()
          : body.prompt || "";
        const req2: ListicleRequest = { ...baseReq, description, slideshowCount: 1 };
        if (userBufs.length > 0) {
          const imgF = await generateImageFirst(req2, userBufs, null);
          if (imgF && imgF.slideshows[0]?.length) {
            const raw = imgF.slideshows[0];
            const deck = raw.map(bakeCaption);
            const assign = raw.map((s) => s.photoIndex);
            const stock = assign.some((p) => p < 0)
              ? await sourceStockDeck(deck)
              : null;
            const images = deck.map((_s, i) => {
              const p = assign[i] ?? -1;
              return p >= 0 ? userBufs[p] : stock?.[i];
            });
            return { deck, images };
          }
        }
        const deck = (await generateListicle(req2, null))[0].map(bakeCaption);
        const images = await sourceStockDeck(deck);
        return { deck, images };
      } catch {
        return null;
      }
    };

    emit({ stage: "judging", label: "Judging the draft" });
    const decks: JudgedSlide[][] = [];
    const deckImages: (Buffer | undefined)[][] = [];
    const summaries: JudgeSummary["decks"] = [];
    let anyOps = false;

    for (let ss = 0; ss < content.length; ss++) {
      const deck = content[ss];
      const imgs = deck.map((_s, i) => resolveImage(ss, i));
      const { verdict, prompt } = await judgeDeck({
        deck,
        images: imgs,
        brief: {
          topic: body.prompt || "",
          niche: nicheLabel,
          slideCount: deck.length,
          exemplars,
          hooks,
        },
      });
      const sfx = ss > 0 ? `_ss${ss}` : "";
      if (diag) {
        await diag.text(`03e_judge_prompt${sfx}.txt`, prompt);
        await diag.json(
          `03f_judge_verdict${sfx}.json`,
          verdict ?? { note: "judge unavailable — null verdict; deck unchanged" },
        );
      }
      if (verdict && verdict.operations.length > 0) {
        anyOps = true;
        const { deck: nd, images: ni, applied } = await applyOperations(
          deck,
          imgs,
          verdict.operations,
          { userBufs, resourceStockImage, regenerateDeck },
        );
        if (diag) await diag.json(`03g_judge_applied${sfx}.json`, applied);
        decks.push(nd);
        deckImages.push(ni);
        summaries.push({
          approved: verdict.approved,
          assessment: verdict.assessment,
          applied,
        });
      } else {
        decks.push(deck.map((s) => ({ ...s })));
        deckImages.push(imgs);
        summaries.push({
          approved: verdict?.approved ?? true,
          assessment:
            verdict?.assessment ?? "judge unavailable — deck unchanged",
          applied: [],
        });
      }
    }

    if (anyOps) emit({ stage: "revising", label: "Applying the judge's fixes" });
    content = decks;
    finalImages = deckImages;
    judgeSummary = { model: JUDGE_MODEL, decks: summaries };
  }

  emit({ stage: "finalizing", label: "Compositing slides" });

  // Dump the FINAL per-slide image (numbered to match the deck) plus an
  // automated anomaly scan, so a bad run explains itself without screenshots.
  if (diag) {
    const resolve = resolveImage;
    const deck = content[0] ?? [];
    // Per slide, dump BOTH views and measure the caption's legibility:
    //   images/ → the text-free background (debugs image selection)
    //   slides/ → the composited slide as the user sees it (debugs the result)
    // The probe samples the fitted 1080x1920 crop at the caption's real box, so
    // the number in the table describes the pixels actually under the text.
    const probes: (ContrastProbe | null)[] = [];
    await Promise.all(
      deck.map(async (s, i) => {
        const buf = resolve(0, i);
        if (!buf) return;
        await diag.image(`images/slide_${i + 1}_${s.role}`, buf);
        try {
          const captionOpts = {
            text: s.text,
            role: s.role,
            number: s.number,
            pos: posFor(s),
            body: s.body ?? null,
          };
          const fitted = await prepareBackground(buf);
          const probe = await probeCaptionContrast(fitted, captionOpts);
          probes[i] = probe;
          // Bake with the plate the real pipeline would apply, so `slides/`
          // shows the actual outcome of the contrast decision.
          const png = await compositeSlide(buf, {
            ...captionOpts,
            textBg: probe?.poor ?? false,
          });
          await diag.image(
            `slides/slide_${i + 1}_${s.role}`,
            await sharp(png).jpeg({ quality: 85 }).toBuffer(),
          );
        } catch {
          // Diagnostics must never break a generation.
        }
      }),
    );

    // Strip the trailing "Goal of this post: …" the composer appends, and stop
    // words, so overlap reflects the actual topic. >=3 chars keeps "gym"/"abs".
    const STOP = new Set([
      "the", "and", "for", "you", "your", "our", "with", "that", "this", "are",
      "post", "goal", "what", "why", "how", "make", "makes", "things",
    ]);
    const promptText = (body.prompt || "")
      .toLowerCase()
      .replace(/goal of this post:[\s\S]*/, "");
    const words = (t: string) =>
      new Set(
        t
          .toLowerCase()
          .replace(/[^a-z0-9\s]/g, " ")
          .split(/\s+/)
          .filter((w) => w.length >= 3 && !STOP.has(w)),
      );
    const promptWords = words(promptText);
    const overlap = (t: string) =>
      [...words(t)].filter((w) => promptWords.has(w)).length;

    const flags: string[] = [];
    deck.forEach((s, i) => {
      const stripped = s.text.replace(/^\s*\d+[.)]\s*/, "").trim().toLowerCase();
      if (s.role === "plug" && promptText && overlap(stripped) >= 3) {
        flags.push(
          `**SMOKING GUN — slide ${i + 1} (\`plug\`) parrots the user's prompt.** The structure forces exactly one \`plug\` slide; with no product to sell the model fills it by echoing the topic.\n  - prompt: "${body.prompt}"\n  - slide:  "${s.text}"`,
        );
      }
      if (s.role !== "cta" && s.role !== "title" && s.text.trim().endsWith("?")) {
        flags.push(
          `Slide ${i + 1} (\`${s.role}\`) is phrased as a QUESTION while its siblings are statements — inconsistent voice: "${s.text}"`,
        );
      }
    });
    // Real drift = the WHOLE deck (title + every reason) shares nothing with the
    // topic, not just the title (a good title can paraphrase with synonyms).
    const title = deck.find((s) => s.role === "title");
    const deckOverlap = deck.reduce((sum, s) => sum + overlap(s.text), 0);
    if (title && promptText.trim() && deckOverlap === 0) {
      flags.push(
        `**TOPIC DRIFT** — no slide shares a significant word with the prompt.\n  - prompt: "${body.prompt}"\n  - title:  "${title.text}"`,
      );
    }
    // More uploads than slides forces some exclusions by pigeonhole (8 photos
    // into 6 slides = 2 left over) — only flag exclusions beyond that.
    const forcedExclusions = Math.max(0, userBufs.length - slideCount);
    if (photoAssign && excludedPhotos > forcedExclusions) {
      flags.push(
        `${excludedPhotos} uploaded photo(s) were excluded by the vision model (only ${forcedExclusions} forced by photo count; see 04_photo_assignment.json).`,
      );
    }
    // Specificity is MEASURED, not enforced: a hard "must contain a digit" gate
    // would be wrong for slides making a mindset point. This just surfaces decks
    // where nothing is actionable, which is the failure mode that makes a post
    // forgettable ("it takes a mix of nutrition and full-body workouts").
    if (slideCount <= SHORT_DECK_MAX) {
      const withBody = deck.filter((s) => (s.body ?? "").trim()).length;
      const concrete = deck.filter((s) =>
        /\d/.test(`${s.text} ${s.body ?? ""}`),
      ).length;
      if (withBody === 0) {
        flags.push(
          `**NO BODY TEXT** — every slide is a bare heading, so the deck delivers no substance. Short decks are supposed to carry the payload in \`body\`.`,
        );
      }
      if (concrete === 0) {
        flags.push(
          `**NOTHING ACTIONABLE** — no slide contains a number, dose, frequency or figure. Check whether the deck is real advice or just gestures at the topic.`,
        );
      }
    }

    // Anything the mechanical detector still catches AFTER the retry is a real
    // leak worth seeing — the whole point is that prompt bans alone don't hold.
    const lingoHits = scanDeckForAiLingo(
      deck.map((s) => ({ text: s.text, body: s.body })),
    );
    if (lingoHits.length) {
      flags.push(
        `**AI LINGO SURVIVED THE RETRY** — ${lingoHits
          .map((l) => `slide ${l.slide}: ${l.tells.join(", ")}`)
          .join("; ")}. These are banned in the prompt AND retried once; if they reach here the detector or the prompt needs another pass.`,
      );
    }

    const poorContrast = deck
      .map((s, i) => ({ s, i, p: probes[i] }))
      .filter((x) => x.p?.poor);
    if (poorContrast.length) {
      flags.push(
        `**LOW CONTRAST — ${poorContrast.length} of ${deck.length} slide(s)** have white text on a background too bright to read (ratio < ${CONTRAST_FLOOR}): ${poorContrast
          .map((x) => `slide ${x.i + 1} (${x.p!.ratio.toFixed(2)})`)
          .join(", ")}. Open \`slides/\` to see them and compare against the contrast table below.`,
      );
    }

    const plan = cleanAiPlan(body.aiPlan);
    diag.add(
      "Request",
      [
        `- mode: **${plan ? "Let AI decide (planner chose the settings)" : "Manual"}**`,
        plan
          ? `- user actually typed: ${plan.userPrompt ? `**"${plan.userPrompt}"**` : "_nothing — the photos alone drove this_"}`
          : null,
        plan?.angle ? `- AI angle: **"${plan.angle}"**` : null,
        plan?.rationale ? `- AI rationale: ${plan.rationale}` : null,
        plan?.suggestions ? `- suggestions used: ${plan.suggestions}/3` : null,
        `- prompt sent to the model: **"${body.prompt}"**${plan ? " _(written by the planner, not the user)_" : ""}`,
        `- niche: ${nicheLabel}${plan ? " _(AI-chosen)_" : ` _(auto-detected from prompt${nicheSlug === "other" ? " — no match, using generic" : ""})_`}`,
        `- layout: ${body.layout}${plan ? " _(AI-chosen)_" : ""}`,
        `- source: ${mode === "single" ? "Upload" : "Stock photos"}`,
        `- slides: ${slideCount} (title + ${slideCount - 2} value reasons + cta; no plug/ad slide)${plan ? " _(AI-chosen)_" : ""}`,
        `- uploads: ${userBufs.length}`,
      ]
        .filter(Boolean)
        .join("\n"),
    );
    diag.add(
      "Anomalies detected",
      flags.length ? flags.map((f) => `- ${f}`).join("\n") : "_None detected._",
    );
    diag.add(
      "Final deck (caption → image)",
      deck
        .map(
          (s, i) =>
            `**Slide ${i + 1}** — \`${s.role}\` → \`images/slide_${i + 1}_${s.role}.*\`${
              photoAssign
                ? ` (upload index: ${photoAssign[0]?.[i] ?? -1}${(photoAssign[0]?.[i] ?? -1) < 0 ? " = STOCK FILL" : ""})`
                : ""
            }\n\n> ${s.text}\n${s.body ? `>\n> _body:_ ${s.body}\n` : "\n_(no body)_\n"}\n- image_keywords: \`${JSON.stringify(s.imageKeywords ?? [])}\``,
        )
        .join("\n\n"),
    );
    diag.add(
      "Caption contrast (CV)",
      [
        `White caption text is measured against the mean colour of the background **inside the caption's own box**, at the placement layoutSlide() actually chose.`,
        "",
        `- **bright ratio** DECIDES the verdict: the 85th percentile of brightness across only the grid cells that sit under actual glyphs. **mean ratio** is the whole box averaged, shown for comparison — it is what used to decide, and it hides bright patches (a treadmill console read 6.81 by mean and 4.68 bright).`,
        `- **floor** = \`${CONTRAST_FLOOR.toFixed(2)}\` — below this the caption is treated as unreadable and earns a black plate behind it. Far below the WCAG AA bar (4.5) on purpose: the glyphs already carry a black stroke, so only the genuinely broken cases should trip it.`,
        `- **stdev** = how busy the region is. NOT part of the pass/fail decision — logged to find out whether the mean alone is a good enough predictor.`,
        "",
        "| # | role | mean bg | mean ratio | **bright ratio** | stdev | verdict |",
        "|---|------|---------|------------|------------------|-------|---------|",
        ...deck.map((s, i) => {
          const p = probes[i];
          if (!p) return `| ${i + 1} | \`${s.role}\` | — | — | — | — | _not measured_ |`;
          const rgb = `rgb(${Math.round(p.mean.r)}, ${Math.round(p.mean.g)}, ${Math.round(p.mean.b)})`;
          return `| ${i + 1} | \`${s.role}\` | ${rgb} | ${p.meanRatio.toFixed(2)} | **${p.ratio.toFixed(2)}** | ${p.stdev.toFixed(1)} | ${p.poor ? "**PLATE**" : "ok"} |`;
        }),
        "",
        "Compare each row against the matching file in `slides/` — that's the same slide with the caption baked in.",
      ].join("\n"),
    );
    diag.add(
      "Files",
      "- `01_request.json` — resolved request/structure\n- `01b_trend_exemplars.txt` — trending hooks injected into the prompt\n- `01c_ai_plan.json` — \"Let AI decide\" runs only: what the user typed vs what the planner chose\n- `02_*_prompt.txt` — EXACT system+user prompt sent to the model\n- `03_*_raw_response.json` — the model's raw output before normalization\n- `03e_judge_prompt.txt` / `03f_judge_verdict.json` / `03g_judge_applied.json` — Supercharge runs only: the judge's prompt, its verdict, and the ops actually applied\n- `04_*` — per-slide image decisions\n- `uploads/` — your uploads, numbered as the model saw them\n- `images/` — the text-free background chosen per slide (debugs image SELECTION)\n- **`slides/` — the composited slide WITH its caption, i.e. what the user actually sees (debugs placement + contrast)**",
    );

    // Supercharge only: what the judge thought and how it changed the deck.
    if (judgeSummary) {
      const d = judgeSummary.decks[0];
      const esc = (t: string) => t.replace(/\|/g, "\\|").replace(/\n/g, " ");
      const opsTable =
        d && d.applied.length
          ? [
              "| op | slide | status | detail (why) |",
              "|----|-------|--------|--------------|",
              ...d.applied.map(
                (a) =>
                  `| \`${a.op}\` | ${a.slide ?? "—"} | ${a.status}${
                    a.skipReason ? ` (${esc(a.skipReason)})` : ""
                  } | ${esc(a.detail)}${a.reason ? ` — _${esc(a.reason)}_` : ""} |`,
              ),
            ].join("\n")
          : "_No operations — the judge approved the draft as-is._";
      diag.add(
        "Judge (Supercharge)",
        [
          `- model: **${judgeSummary.model}**`,
          `- approved: **${d?.approved ? "yes" : "no"}**`,
          d?.assessment ? `- assessment: ${esc(d.assessment)}` : null,
          "",
          opsTable,
        ]
          .filter((x) => x !== null)
          .join("\n"),
      );
    }

    await diag.finish();
  }

  // 3) Composite each slide; persist as a draft only when signed in.
  try {
    const slideshows = await Promise.all(
      content.map(async (slides, ssIdx) => {
        const title =
          slides.find((s) => s.role === "title")?.text ||
          nicheLabel ||
          "Untitled slideshow";

        const bgFor = (i: number): Buffer => {
          const b = resolveImage(ssIdx, i);
          if (!b) throw new PipelineError("Internal: missing image for a slide.", 500);
          return b;
        };

        // The old "not signed in" branch baked ephemeral data-URL previews here.
        // It is gone: POST now 401s before any of this, so it was unreachable —
        // and reachable only by curl, where it served the entire paid pipeline
        // for free. Every deck from here on is persisted.

        // --- Persist as a draft (Storage + DB), return signed URLs ---
        const { data: ss, error: ssErr } = await supabase
          .from("slideshows")
          .insert({
            user_id: user.id,
            title,
            niche: nicheLabel ?? null,
            description: body.prompt ?? null,
            layout: body.layout ?? "listicle",
            slide_count: slides.length,
            // Auto-saved into the library on creation (no manual "Save" step).
            status: "saved",
          })
          .select("id")
          .single();
        if (ssErr || !ss) {
          throw new Error(ssErr?.message || "Could not create slideshow.");
        }

        // Store ONLY the text-free background. Captions stay live data in the DB
        // and are baked on demand at render/post — never saved into the image.
        // `storage_path` stays an `{i}.jpg` identifier; the renderer derives the
        // `-bg.jpg` background from it.
        const paths = slides.map((_, i) => `${user.id}/${ss.id}/${i}.jpg`);
        const bgPaths = slides.map((_, i) => `${user.id}/${ss.id}/${i}-bg.jpg`);
        const bgJpgs = await Promise.all(
          slides.map((_, i) => prepareBackground(bgFor(i))),
        );

        // Measure white-text legibility against the exact region each caption
        // lands on. Stored (not recomputed at render) so the SVG bake and the
        // HTML drag editor can never disagree about whether a plate is drawn.
        const textBgs = await Promise.all(
          slides.map(async (slide, i) => {
            const probe = await probeCaptionContrast(bgJpgs[i], {
              text: slide.text,
              role: slide.role,
              number: slide.number,
              pos: posFor(slide),
              body: slide.body ?? null,
            });
            return probe?.poor ?? false;
          }),
        );

        // Use node:https directly — Next.js's patched globalThis.fetch silently
        // drops large binary POSTs (fetch failed / bad record mac). Sequential
        // uploads avoid Supabase NANO's per-connection limits (EPIPE on 5+ parallel).
        const { data: { session } } = await supabase.auth.getSession();
        const jwt = session?.access_token ?? "";
        const sbUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;

        for (let i = 0; i < bgJpgs.length; i++) {
          const result = await uploadWithRetry(sbUrl, "slideshows", bgPaths[i], bgJpgs[i], "image/jpeg", jwt);
          if (result.error) {
            // The slideshows row already exists; leaving it would put an empty,
            // image-less deck in the user's library. Best-effort cleanup so a
            // failed run leaves nothing behind.
            await supabase.from("slideshows").delete().eq("id", ss.id);
            throw new Error(`Storage upload failed: ${result.error}`);
          }
        }

        const slideRows = slides.map((slide, i) => ({
          slideshow_id: ss.id,
          position: i,
          role: slide.role,
          number: slide.number,
          caption: slide.text,
          body: slide.body ?? null,
          storage_path: paths[i],
          position_x: posFor(slide).x,
          position_y: posFor(slide).y,
          align: posFor(slide).align,
          text_bg: textBgs[i],
          // Kept so the editor's "Try another photo" can run the SAME search
          // later. Without them it had to guess from the caption, and the first
          // two words of a listicle caption are the list number and a filler
          // word — Pexels was being asked for "4 reasons".
          image_keywords: (slide.imageKeywords ?? []).filter(Boolean),
        }));

        let { error: slErr } = await supabase.from("slides").insert(slideRows);
        // The image_keywords column ships in migration 20260806120000, which is
        // run by hand. If the code is deployed first, drop the field and insert
        // without it rather than failing a generation the user already paid for.
        if (slErr && /image_keywords/i.test(slErr.message)) {
          const withoutKeywords = slideRows.map((row) => {
            const rest: Record<string, unknown> = { ...row };
            delete rest.image_keywords;
            return rest;
          });
          ({ error: slErr } = await supabase.from("slides").insert(withoutKeywords));
        }
        if (slErr) {
          await supabase.from("slideshows").delete().eq("id", ss.id);
          throw new Error(slErr.message);
        }

        // Sign the text-free backgrounds so the drag editor can overlay live text.
        const { data: signed } = await supabase.storage
          .from("slideshows")
          .createSignedUrls(bgPaths, SIGNED_URL_TTL);
        const bgUrlByPath = new Map(
          (signed ?? []).map((x) => [x.path, x.signedUrl]),
        );

        return {
          id: ss.id as string,
          title,
          persisted: true,
          slides: slides.map((slide, i) => ({
            position: i,
            caption: slide.text,
            body: slide.body ?? null,
            role: slide.role,
            number: slide.number,
            // Baked on demand via the render endpoint — never stored.
            url: `/api/slideshows/${ss.id}/render/${i}`,
            bgUrl: bgUrlByPath.get(bgPaths[i]) ?? "",
            posX: posFor(slide).x,
            posY: posFor(slide).y,
            align: posFor(slide).align,
            maxWidth: null as number | null,
            fontScale: 1,
            // Contrast verdict, so the just-generated editor draws the same
            // plate the render endpoint bakes.
            textBg: textBgs[i],
          })),
        };
      }),
    );

    // Already charged up front (reserve → run → refund). Persisting is the
    // point of no return: from here the reservation is earned, so clear it so
    // nothing can refund it later.
    reservation = null;

    return { slideshows, excludedPhotos, judge: judgeSummary };
  } catch (e) {
    if (e instanceof PipelineError) throw e;
    const message = e instanceof Error ? e.message : "Failed to build slideshow.";
    throw new PipelineError(message, 500);
  }
  }; // end runPipeline

  // Supercharge streams stage events (NDJSON); the normal path returns one JSON
  // body, byte-for-byte the same shape as before. BOTH must refund on failure —
  // the stream swallows the throw into an {type:"error"} line with HTTP 200, so
  // without this a deliberately-failed Supercharge run is free spend.
  if (supercharge) {
    return streamPipeline(runPipeline, refund);
  }
  try {
    const out = await runPipeline(() => {});
    return NextResponse.json({
      slideshows: out.slideshows,
      excludedPhotos: out.excludedPhotos,
    });
  } catch (e) {
    await refund();
    return errorResponse(e);
  }
}
