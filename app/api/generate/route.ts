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
import sharp from "sharp";
import { compositeSlide, prepareBackground } from "@/lib/generate/composite";
import { selectBackgrounds } from "@/lib/generate/imageSelection";
import { DEFAULT_POS } from "@/lib/generate/layout";
import { GYM_IMAGES } from "@/lib/library-images";

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
): Promise<{ error?: string }> {
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
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            resolve({});
          } else {
            try {
              const parsed = JSON.parse(raw) as { message?: string };
              resolve({ error: parsed.message ?? `HTTP ${res.statusCode}` });
            } catch {
              resolve({ error: `HTTP ${res.statusCode}` });
            }
          }
        });
      },
    );
    req.on("error", (e: Error) => resolve({ error: e.message }));
    req.write(body);
    req.end();
  });
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

  // Freshest real trending hooks for this niche, fed into every generation path
  // so copy mirrors what's actually going viral now (one fast indexed read).
  const exemplars = exemplarsBlock(
    await fetchTrendExemplars(supabase, body.niche || "", 8),
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
      niche: body.niche,
      collection: body.collection,
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
      niche: body.niche || "small business",
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
          body.niche || "",
          body.collection,
          diag,
        );
      }
      if (!matched) {
        const selected = await selectBackgrounds({
          supabase,
          collection: body.collection || "gym",
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

    const promptText = (body.prompt || "").toLowerCase();
    const words = (t: string) =>
      new Set(
        t.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w.length > 3),
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
    const title = deck.find((s) => s.role === "title");
    if (title && promptText && overlap(title.text) === 0) {
      flags.push(
        `**TOPIC DRIFT** — the title shares no significant words with the prompt.\n  - prompt: "${body.prompt}"\n  - title:  "${title.text}"`,
      );
    }
    if (photoAssign && excludedPhotos > 0) {
      flags.push(
        `${excludedPhotos} uploaded photo(s) were excluded by the vision model (see 04_photo_assignment.json).`,
      );
    }

    diag.add(
      "Request",
      `- prompt: **"${body.prompt}"**\n- niche: ${body.niche}\n- source: ${mode === "single" ? "Upload" : "Stock photos"}\n- slides: ${slideCount} (structure forces title + ${slideCount - 2} middles + cta, with ONE forced \`plug\`)\n- uploads: ${userBufs.length}`,
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
      "- `01_request.json` — resolved request/structure\n- `01b_trend_exemplars.txt` — trending hooks injected into the prompt\n- `02_*_prompt.txt` — EXACT system+user prompt sent to the model\n- `03_*_raw_response.json` — the model's raw output before normalization\n- `04_*` — per-slide image decisions\n- `uploads/` — your uploads, numbered as the model saw them\n- `images/` — the final image used per slide",
    );
    await diag.finish();
  }

  // 3) Composite each slide; persist as a draft only when signed in.
  try {
    const slideshows = await Promise.all(
      content.map(async (slides, ssIdx) => {
        const title =
          slides.find((s) => s.role === "title")?.text ||
          body.niche ||
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
            niche: body.niche ?? null,
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
          const result = await rawStorageUpload(sbUrl, "slideshows", bgPaths[i], bgJpgs[i], "image/jpeg", jwt);
          if (result.error) throw new Error(`Storage upload failed: ${result.error}`);
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
        if (slErr) throw new Error(slErr.message);

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
