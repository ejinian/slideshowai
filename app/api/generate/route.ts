import { NextResponse } from "next/server";
import path from "node:path";
import * as https from "node:https";
import { readFile } from "node:fs/promises";
import { createClient } from "@/utils/supabase/server";
import { createAdminClient } from "@/utils/supabase/admin";
import { isAdminEmail } from "@/lib/admins";
import {
  loadBilling,
  remaining,
  consume,
  rateLimited,
  markGenerated,
  type Billing,
} from "@/lib/billing/usage";
import {
  generateListicle,
  explicitListCount,
  type FormatBlueprint,
  type ListicleSlide,
} from "@/lib/generate/listicle";
import { generateImageFirst } from "@/lib/generate/imageFirst";
import { fetchTrendExemplars, exemplarsBlock } from "@/lib/generate/trendExemplars";
import { selectLiveBackgrounds } from "@/lib/generate/liveImages";
import { createRun, type RunLogger } from "@/lib/generate/diagnostics";
import { resolveNiche } from "@/lib/generate/nicheDetect";
import sharp from "sharp";
import { compositeSlide, prepareBackground } from "@/lib/generate/composite";
import { selectBackgrounds } from "@/lib/generate/imageSelection";
import { DEFAULT_POS } from "@/lib/generate/layout";
import { GYM_IMAGES } from "@/lib/library-images";

// Emoji (and their joiners/variation selectors) have no glyph in the caption
// font, so they bake as tofu boxes. Matches pictographs only — ASCII digits are
// `Emoji` but not `Emoji_Presentation`, so "3 tips" survives intact.
const EMOJI_RE =
  /[\p{Extended_Pictographic}\p{Emoji_Presentation}\uFE0F\u200D\u20E3]/gu;

function stripEmoji(s: string): string {
  return s.replace(EMOJI_RE, "").replace(/\s{2,}/g, " ").trim();
}

// Upload a binary buffer to Supabase Storage using Node's native https module,
// bypassing Next.js's patched globalThis.fetch which breaks large binary POSTs.
// agent:false prevents TLS session reuse that causes "bad record mac" errors.
function rawStorageUpload(
  supabaseUrl: string,
  bucket: string,
  storagePath: string,
  body: Buffer,
  contentType: string,
  jwt: string,
): Promise<{ error?: string; retryable?: boolean }> {
  return new Promise((resolve) => {
    const url = new URL(
      `/storage/v1/object/${bucket}/${storagePath}`,
      supabaseUrl,
    );
    const req = https.request(
      {
        hostname: url.hostname,
        port: url.port ? parseInt(url.port) : 443,
        path: url.pathname,
        method: "POST",
        agent: false,
        headers: {
          Authorization: `Bearer ${jwt}`,
          "Content-Type": contentType,
          "Content-Length": body.length,
          "x-upsert": "true",
        },
      },
      (res) => {
        let raw = "";
        res.on("data", (chunk: Buffer) => (raw += chunk.toString()));
        res.on("end", () => {
          const code = res.statusCode ?? 0;
          if (code >= 200 && code < 300) {
            resolve({});
          } else {
            // 5xx / 429 are worth another go; a 4xx (bad auth, bad path) never
            // will be, so don't burn retries on it.
            const retryable = code >= 500 || code === 429;
            try {
              const parsed = JSON.parse(raw) as { message?: string };
              resolve({ error: parsed.message ?? `HTTP ${code}`, retryable });
            } catch {
              resolve({ error: `HTTP ${code}`, retryable });
            }
          }
        });
      },
    );
    // Transport-level failures (TLS "bad record mac", ECONNRESET, EPIPE) are
    // transient by nature — always retryable.
    req.on("error", (e: Error) => resolve({ error: e.message, retryable: true }));
    req.write(body);
    req.end();
  });
}

// A single flaky socket used to throw away an entire generation — minutes of
// OpenAI + Pexels + compositing work — because one TLS record failed its
// integrity check. Retry transient failures with a short backoff.
async function uploadWithRetry(
  supabaseUrl: string,
  bucket: string,
  storagePath: string,
  body: Buffer,
  contentType: string,
  jwt: string,
  attempts = 3,
): Promise<{ error?: string }> {
  let last: { error?: string; retryable?: boolean } = {};
  for (let attempt = 0; attempt < attempts; attempt++) {
    last = await rawStorageUpload(
      supabaseUrl,
      bucket,
      storagePath,
      body,
      contentType,
      jwt,
    );
    if (!last.error) return {};
    if (!last.retryable) return { error: last.error };
    if (attempt < attempts - 1) {
      await new Promise((r) => setTimeout(r, 300 * 2 ** attempt));
    }
  }
  return { error: `${last.error} (after ${attempts} attempts)` };
}

// Sharp needs the Node.js runtime (not edge). Next auto-externalizes `sharp`.
export const runtime = "nodejs";
export const maxDuration = 120;

const SIGNED_URL_TTL = 60 * 60; // 1 hour

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
  /** "Remix this trend" only: the trend's format recipe (untrusted client
   *  input — sanitized by cleanFormat before it reaches the model prompt). */
  format?: FormatBlueprint;
  /** "Let AI decide" provenance — DIAGNOSTICS ONLY. Never reaches the model or
   *  any generation logic; it exists so a dump can tell whether a bad deck came
   *  from the PLANNER's direction or the GENERATOR's execution. */
  aiPlan?: AiPlanDiag;
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
): Promise<Buffer[][] | null> {
  const live = await selectLiveBackgrounds(
    content.map((slides) =>
      slides.map((s) => ({ caption: s.text, keywords: s.imageKeywords ?? [] })),
    ),
    niche,
    collection,
    diag,
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

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let body: GenerateBody;
  try {
    body = (await request.json()) as GenerateBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  // Honor a count stated in the prompt ("3 exercises" → 3 value slides = 5 total)
  // over the slide dropdown, so the headline number never contradicts the topic.
  const promptCount = explicitListCount(body.prompt || "");
  const slideCount =
    promptCount != null
      ? Math.min(Math.max(promptCount + 2, 3), 10)
      : Math.min(Math.max(Number(body.slideCount) || 6, 3), 10);
  const slideshowCount = Math.min(
    Math.max(Number(body.slideshowCount) || 1, 1),
    5,
  );
  const mode: BackgroundMode = body.backgroundMode ?? "collection";

  // Billing: enforce the monthly slideshow allowance (+ credits) for signed-in
  // users, who persist. Guests get an unsaved preview and aren't metered. The
  // check runs before the OpenAI call so we don't spend on blocked requests.
  // Founder/admin accounts skip quota + rate limiting entirely (see lib/admins).
  const isAdmin = isAdminEmail(user?.email);
  const admin = user ? createAdminClient() : null;
  let billing: Billing | null = null;
  if (user && admin && !isAdmin) {
    const now = Date.now();
    billing = await loadBilling(admin, user.id, now);
    if (rateLimited(billing.lastGeneratedAt, now)) {
      return NextResponse.json(
        {
          error:
            "You're generating too fast — give it a few seconds and try again.",
          code: "rate_limited",
        },
        { status: 429 },
      );
    }
    if (slideshowCount > remaining(billing)) {
      return NextResponse.json(
        {
          error:
            "You've reached your plan's slideshow limit for this month. Upgrade your plan or add credits to keep generating.",
          code: "quota_exceeded",
        },
        { status: 402 },
      );
    }
    // Reserve the rate-limit slot before the expensive OpenAI + compositing work.
    await markGenerated(admin, user.id, new Date(now).toISOString());
  }

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

  // User-uploaded photos (Composer step 3). When present they ARE the content:
  // we generate image-first — the model SEES them, writes grounded captions,
  // orders for the hook, and excludes ones that don't fit the story.
  const userBufs: Buffer[] = (body.userImages ?? [])
    .slice(0, 10)
    .filter((u) => typeof u === "string" && u.startsWith("data:"))
    .map((u) => Buffer.from(u.split(",")[1] ?? "", "base64"))
    .filter((b) => b.length > 0);

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
      explicitListCountFromPrompt: explicitListCount(body.prompt || ""),
      backgroundMode: mode,
      uploadedPhotos: userBufs.length,
      uploadedSizesKB: userBufs.map((b) => Math.round(b.length / 1024)),
      trendExemplarsInjected: exemplars.length > 0,
    });
    if (exemplars) await diag.text("01b_trend_exemplars.txt", exemplars);
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
  let content: ListicleSlide[][];
  let photoAssign: number[][] | null = null;
  let excludedPhotos = 0;
  try {
    const req = {
      niche: nicheLabel,
      description: body.prompt || "",
      slideCount,
      slideshowCount,
      exemplars,
      format: cleanFormat(body.format),
    };
    const imgFirst =
      userBufs.length > 0 ? await generateImageFirst(req, userBufs, diag) : null;
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
    return NextResponse.json({ error: message }, { status });
  }

  // Captions are baked by resvg with ONLY the TikTok Sans TTFs loaded
  // (composite.ts sets loadSystemFonts:false), and that family has no emoji
  // glyphs — so any emoji the copy model emits renders as a TOFU BOX on the
  // finished slide. Strip them here, the single choke point both intake paths
  // funnel through, so the stored caption, the editor overlay and the bake all
  // agree. (Digits are untouched: they're Emoji but not Emoji_Presentation.)
  content = content.map((slides) =>
    slides.map((s) => {
      const cleaned = stripEmoji(s.text);
      return cleaned ? { ...s, text: cleaned } : s;
    }),
  );

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
    return NextResponse.json(
      { error: "Could not load background images." },
      { status: 500 },
    );
  }
  if (userBufs.length === 0 && !matched && backgrounds.length === 0) {
    return NextResponse.json(
      { error: "No background images available." },
      { status: 500 },
    );
  }

  // Dump the FINAL per-slide image (numbered to match the deck) plus an
  // automated anomaly scan, so a bad run explains itself without screenshots.
  if (diag) {
    const resolve = (ssIdx: number, i: number): Buffer | undefined => {
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
    const deck = content[0] ?? [];
    await Promise.all(
      deck.map(async (s, i) => {
        const buf = resolve(0, i);
        if (buf) await diag.image(`images/slide_${i + 1}_${s.role}`, buf);
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
    if (photoAssign && excludedPhotos > 0) {
      flags.push(
        `${excludedPhotos} uploaded photo(s) were excluded by the vision model (see 04_photo_assignment.json).`,
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
            }\n\n> ${s.text}\n\n- image_keywords: \`${JSON.stringify(s.imageKeywords ?? [])}\``,
        )
        .join("\n\n"),
    );
    diag.add(
      "Files",
      "- `01_request.json` — resolved request/structure\n- `01b_trend_exemplars.txt` — trending hooks injected into the prompt\n- `01c_ai_plan.json` — \"Let AI decide\" runs only: what the user typed vs what the planner chose\n- `02_*_prompt.txt` — EXACT system+user prompt sent to the model\n- `03_*_raw_response.json` — the model's raw output before normalization\n- `04_*` — per-slide image decisions\n- `uploads/` — your uploads, numbered as the model saw them\n- `images/` — the final image used per slide",
    );
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

        const bgFor = (i: number) => {
          if (photoAssign) {
            const p = photoAssign[ssIdx]?.[i] ?? -1;
            if (p >= 0) return userBufs[p]; // image-first: model's photo choice
          } else if (userBufs[i]) {
            return userBufs[i]; // no vision assignment → positional (fallback/legacy)
          }
          return (
            matched?.[ssIdx]?.[i] ??
            backgrounds[(ssIdx * slideCount + i) % backgrounds.length]
          );
        };

        // --- Not signed in: ephemeral baked preview (data URLs, not saved). No
        // stored background, so the drag editor stays disabled (bgUrl = ""). ---
        if (!user) {
          const pngs = await Promise.all(
            slides.map((slide, i) =>
              compositeSlide(bgFor(i), {
                text: slide.text,
                role: slide.role,
                number: slide.number,
                pos: DEFAULT_POS,
              }),
            ),
          );
          const jpgPreviews = await Promise.all(
            pngs.map((p) => sharp(p).jpeg({ quality: 85 }).toBuffer()),
          );
          return {
            id: null,
            title,
            persisted: false,
            slides: slides.map((slide, i) => ({
              position: i,
              caption: slide.text,
              role: slide.role,
              number: slide.number,
              url: `data:image/jpeg;base64,${jpgPreviews[i].toString("base64")}`,
              bgUrl: "",
              posX: DEFAULT_POS.x,
              posY: DEFAULT_POS.y,
              align: DEFAULT_POS.align,
              maxWidth: null as number | null,
            })),
          };
        }

        // --- Signed in: persist as a draft (Storage + DB), return signed URLs ---
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

        const { error: slErr } = await supabase.from("slides").insert(
          slides.map((slide, i) => ({
            slideshow_id: ss.id,
            position: i,
            role: slide.role,
            number: slide.number,
            caption: slide.text,
            storage_path: paths[i],
            position_x: DEFAULT_POS.x,
            position_y: DEFAULT_POS.y,
            align: DEFAULT_POS.align,
          })),
        );
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
            role: slide.role,
            number: slide.number,
            // Baked on demand via the render endpoint — never stored.
            url: `/api/slideshows/${ss.id}/render/${i}`,
            bgUrl: bgUrlByPath.get(bgPaths[i]) ?? "",
            posX: DEFAULT_POS.x,
            posY: DEFAULT_POS.y,
            align: DEFAULT_POS.align,
            maxWidth: null as number | null,
          })),
        };
      }),
    );

    // Meter only after the slideshows are actually persisted.
    if (user && admin && billing) {
      await consume(admin, user.id, billing, slideshows.length);
    }

    return NextResponse.json({ slideshows, excludedPhotos });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to build slideshow.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
