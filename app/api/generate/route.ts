import { NextResponse } from "next/server";
import path from "node:path";
import * as https from "node:https";
import { readFile } from "node:fs/promises";
import { createClient } from "@/utils/supabase/server";
import { generateListicle, type ListicleSlide } from "@/lib/generate/listicle";
import sharp from "sharp";
import { compositeSlide, prepareBackground } from "@/lib/generate/composite";
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

type BackgroundMode = "collection" | "auto" | "single";

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
  singleImage?: string; // optional data URL for "single" mode
}

function collectionImagePaths(): string[] {
  return GYM_IMAGES.map((p) =>
    path.join(process.cwd(), "public", p.replace(/^\//, "")),
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

  const slideCount = Math.min(Math.max(Number(body.slideCount) || 6, 3), 10);
  const slideshowCount = Math.min(
    Math.max(Number(body.slideshowCount) || 1, 1),
    5,
  );
  const mode: BackgroundMode = body.backgroundMode ?? "collection";

  // --- Optional, clearly-separated branch: AI image generation (disabled). ---
  if (mode === "auto") {
    return NextResponse.json(
      {
        error:
          "Auto-generate (AI images) isn't enabled yet. Pick an image collection for now.",
      },
      { status: 501 },
    );
  }

  // 1) Listicle copy (OpenAI, structured output, validated)
  let content: ListicleSlide[][];
  try {
    content = await generateListicle({
      niche: body.niche || "small business",
      description: body.prompt || "",
      slideCount,
      slideshowCount,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Generation failed.";
    const status = message.includes("OPENAI_API_KEY")
      ? 400
      : message.includes("quota")
        ? 429
        : 502;
    return NextResponse.json({ error: message }, { status });
  }

  // 2) Backgrounds
  let backgrounds: Buffer[];
  try {
    if (mode === "single" && body.singleImage?.startsWith("data:")) {
      backgrounds = [Buffer.from(body.singleImage.split(",")[1] ?? "", "base64")];
    } else {
      backgrounds = await Promise.all(
        collectionImagePaths().map((f) => readFile(f)),
      );
    }
  } catch {
    return NextResponse.json(
      { error: "Could not load background images." },
      { status: 500 },
    );
  }
  if (backgrounds.length === 0) {
    return NextResponse.json(
      { error: "No background images available." },
      { status: 500 },
    );
  }

  // 3) Composite each slide; persist as a draft only when signed in.
  try {
    const slideshows = await Promise.all(
      content.map(async (slides, ssIdx) => {
        const title =
          slides.find((s) => s.role === "title")?.text ||
          body.niche ||
          "Untitled slideshow";

        const bgFor = (i: number) =>
          backgrounds[(ssIdx * slideCount + i) % backgrounds.length];

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

    return NextResponse.json({ slideshows });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to build slideshow.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
