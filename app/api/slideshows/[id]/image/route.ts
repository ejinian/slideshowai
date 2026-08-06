import { NextResponse } from "next/server";
import * as https from "node:https";
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/utils/supabase/server";
import { createAdminClient } from "@/utils/supabase/admin";
import { isAdminEmail } from "@/lib/admins";
import {
  bumpImageSwaps,
  spendCredits,
  refundCredits,
  claimRateWindow,
  SWAPS_PER_CREDIT,
} from "@/lib/billing/usage";
import { prepareBackground } from "@/lib/generate/composite";
import { repickSlideBackground } from "@/lib/generate/liveImages";
import { probeCaptionContrast } from "@/lib/generate/contrast";
import { GENERATOR_NICHES } from "@/lib/generator-options";
import { bgPathFrom } from "@/lib/generate/renderSlide";
import { captionKeywords } from "@/lib/generate/captionQuery";
import type { SlideRole } from "@/lib/generate/listicle";
import type { Align } from "@/lib/generate/layout";

// Replace ONE slide's photo, after the deck has been generated.
//
// Two ways in: let the AI find a different shot, or upload your own. Both end
// in the same place — the text-free `-bg.jpg` for that slide is overwritten and
// the caption is left completely alone, because captions are live DB data that
// get composited on demand (see lib/generate/renderSlide.ts). So this can never
// stack text or lose an edit; the next render just picks up the new background.
export const runtime = "nodejs";
// A Pexels search + vision judge + download + recomposite runs past the default.
export const maxDuration = 60;

const MAX_UPLOAD_BYTES = 12_000_000;
const SIGNED_URL_TTL = 60 * 60; // 1 hour, matching /api/generate

const sha1 = (b: Buffer) => createHash("sha1").update(b).digest("hex");

/**
 * Hashes of every background already in this deck.
 *
 * Deliberately the WHOLE deck, not just the slide being changed: a re-pick that
 * avoids only the current photo can still hand back one sitting on slide 4, and
 * a deck showing the same shot twice looks like a bug to anyone scrolling it.
 * The generator already enforces variety across a run (see the photographer cap
 * in selectLiveBackgrounds); this keeps that true after editing.
 *
 * Hashing the stored bytes rather than tracking source URLs catches the same
 * photo arriving from a different URL, and needs no extra column.
 */
async function deckBgHashes(
  client: SupabaseClient,
  slideshowId: string,
): Promise<Set<string>> {
  const { data } = await client
    .from("slides")
    .select("storage_path")
    .eq("slideshow_id", slideshowId);
  const paths = (data ?? [])
    .map((r) => (r as { storage_path: string | null }).storage_path)
    .filter((p): p is string => !!p)
    .map(bgPathFrom);

  const hashes = await Promise.all(
    paths.map(async (p) => {
      try {
        const { data: blob } = await client.storage.from("slideshows").download(p);
        return blob ? sha1(Buffer.from(await blob.arrayBuffer())) : null;
      } catch {
        return null;
      }
    }),
  );
  return new Set(hashes.filter((h): h is string => !!h));
}

/** Storage upload via node:https — Next's patched fetch drops large binary POSTs. */
function rawUpload(
  supabaseUrl: string,
  bucket: string,
  storagePath: string,
  body: Buffer,
  jwt: string,
): Promise<{ error?: string }> {
  return new Promise((resolve) => {
    const url = new URL(`/storage/v1/object/${bucket}/${storagePath}`, supabaseUrl);
    const req = https.request(
      {
        hostname: url.hostname,
        port: url.port ? parseInt(url.port) : 443,
        path: url.pathname,
        method: "POST",
        agent: false,
        headers: {
          Authorization: `Bearer ${jwt}`,
          "Content-Type": "image/jpeg",
          "Content-Length": body.length,
          "x-upsert": "true",
          // Supabase Storage defaults objects to cacheControl 3600. On a FIRST
          // write that's harmless, but this route overwrites an existing object
          // — and with the default the renderer kept downloading the previous
          // photo for up to an hour, so the swap silently appeared to do
          // nothing. Backgrounds are mutable now, so they must not be cached.
          "cache-control": "max-age=0",
        },
      },
      (res) => {
        let raw = "";
        res.on("data", (c: Buffer) => (raw += c.toString()));
        res.on("end", () => {
          const code = res.statusCode ?? 0;
          if (code >= 200 && code < 300) return resolve({});
          try {
            resolve({ error: (JSON.parse(raw) as { message?: string }).message ?? `HTTP ${code}` });
          } catch {
            resolve({ error: `HTTP ${code}` });
          }
        });
      },
    );
    req.on("error", (e: Error) => resolve({ error: e.message }));
    req.write(body);
    req.end();
  });
}

interface Body {
  position?: number;
  mode?: "ai" | "upload";
  /** mode "upload": a data: URL of the user's photo. */
  image?: string;
  /** mode "ai": source URLs already rejected, so a retry gives something new. */
  exclude?: string[];
}

export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as Body;
  const position = body.position;
  if (!Number.isInteger(position) || (position as number) < 0) {
    return NextResponse.json({ error: "Invalid slide position." }, { status: 400 });
  }
  const mode = body.mode === "upload" ? "upload" : "ai";

  // Metering. "Upload my own" is free — it's a Storage write and nothing else.
  // "Try another photo" runs a Pexels search plus a vision judge, i.e. real
  // spend, so a credit buys a block of SWAPS_PER_CREDIT of them and is taken on
  // the first of each block. Admins bypass, as everywhere else.
  const admin = createAdminClient();
  const isAdmin = isAdminEmail(user.email);
  /** Set only when a credit was actually taken, so failures can hand it back. */
  let charged: Awaited<ReturnType<typeof spendCredits>> = null;
  let swapsLeftInBlock: number | null = null;

  if (!isAdmin && !(await claimRateWindow(admin, user.id, 40, 5 * 60))) {
    return NextResponse.json(
      { error: "Slow down a moment and try again." },
      { status: 429 },
    );
  }

  if (mode === "ai" && !isAdmin) {
    // Bump first so the counter can't be raced. Returns null when the deck
    // isn't the caller's — the RPC re-checks ownership because it is SECURITY
    // DEFINER and therefore bypasses RLS.
    const n = await bumpImageSwaps(admin, id, user.id);
    if (n === null) {
      return NextResponse.json({ error: "Slideshow not found." }, { status: 404 });
    }
    swapsLeftInBlock = SWAPS_PER_CREDIT - ((n - 1) % SWAPS_PER_CREDIT) - 1;
    if ((n - 1) % SWAPS_PER_CREDIT === 0) {
      charged = await spendCredits(admin, user.id, 1);
      if (!charged) {
        return NextResponse.json(
          {
            error: `Out of credits — 1 credit covers ${SWAPS_PER_CREDIT} photo swaps.`,
            code: "quota_exceeded",
          },
          { status: 402 },
        );
      }
    }
  }

  /** Never keep a credit for a swap the user didn't get. */
  const refundSwap = async () => {
    if (charged) {
      await refundCredits(admin, user.id, charged).catch(() => {});
      charged = null;
    }
  };

  // RLS scopes both reads to the owner.
  const BASE_COLS =
    "storage_path, caption, body, role, number, position_x, position_y, align, max_width, font_scale";
  const readSlide = (cols: string) =>
    supabase
      .from("slides")
      .select(cols)
      .eq("slideshow_id", id)
      .eq("position", position as number)
      .single();

  let { data: slideRow, error: slideErr } = await readSlide(
    `${BASE_COLS}, image_keywords`,
  );
  // image_keywords ships in migration 20260806120000, which is run by hand. If
  // the code is deployed first, fall back to the columns that definitely exist
  // rather than 404-ing every slide.
  if (slideErr && /image_keywords/i.test(slideErr.message)) {
    ({ data: slideRow, error: slideErr } = await readSlide(BASE_COLS));
  }
  const slide = slideRow as unknown as {
    storage_path: string;
    caption: string | null;
    body: string | null;
    role: string;
    number: number | null;
    position_x: number | null;
    position_y: number | null;
    align: string | null;
    max_width: number | null;
    font_scale: number | null;
    image_keywords?: string[] | null;
  } | null;
  if (slideErr || !slide?.storage_path) {
    await refundSwap();
    return NextResponse.json({ error: "Slide not found." }, { status: 404 });
  }

  let jpeg: Buffer;
  let sourceUrl: string | null = null;

  if (mode === "upload") {
    const m = /^data:image\/(png|jpe?g|webp);base64,(.+)$/i.exec(body.image ?? "");
    if (!m) {
      return NextResponse.json(
        { error: "Send a PNG, JPEG or WebP image." },
        { status: 400 },
      );
    }
    const raw = Buffer.from(m[2], "base64");
    if (raw.byteLength > MAX_UPLOAD_BYTES) {
      return NextResponse.json({ error: "That image is too large." }, { status: 413 });
    }
    try {
      // Same 1080x1920 fit every generated background gets, so an uploaded
      // photo composites identically to one we sourced.
      jpeg = await prepareBackground(raw);
    } catch {
      return NextResponse.json({ error: "Couldn't read that image." }, { status: 400 });
    }
  } else {
    const { data: deck } = await supabase
      .from("slideshows")
      .select("title, description, niche")
      .eq("id", id)
      .single();
    // The deck's TITLE, not its description. `description` holds the original
    // prompt, which for a product deck is a 3.5k-character scraped brief — as a
    // judge "subject" that is noise, and it is what the judge scores relevance
    // against. The title is the deck's actual subject in one line.
    const topic = (deck?.title ?? "").trim() || (deck?.description ?? "").slice(0, 200);
    const caption = slide.caption ?? "";
    // Prefer the subject phrases the copy model wrote when this slide's photo
    // was first sourced — searching what generation searched. Decks made before
    // migration 20260806120000 have none, so derive terms from the caption.
    const stored = Array.isArray(slide.image_keywords)
      ? (slide.image_keywords as string[]).filter(
          (k) => typeof k === "string" && k.trim(),
        )
      : [];
    const keywords = stored.length > 0 ? stored : captionKeywords(caption);
    // Reuse the niche the deck was BUILT with, never re-derive it from
    // `description`. That column can hold a long scraped product brief, and
    // keyword-voting over one is what once routed a calming-pouch deck to the
    // gym pin pool and put six gym photos under captions about kava. The label
    // was resolved correctly at generation time; map it straight back to a slug.
    const slugFromLabel = GENERATOR_NICHES.find(
      (n) =>
        n.label.replace(/^[^\p{L}]+/u, "").trim().toLowerCase() ===
        (deck?.niche ?? "").replace(/^[^\p{L}]+/u, "").trim().toLowerCase(),
    )?.value;
    const nicheSlug = slugFromLabel ?? "other";
    const picked = await repickSlideBackground(
      { caption, keywords },
      {
        niche: nicheSlug,
        collection: nicheSlug,
        topic,
        exclude: Array.isArray(body.exclude) ? body.exclude.slice(0, 40) : [],
      },
    );
    if (!picked || picked.ranked.length === 0) {
      await refundSwap();
      return NextResponse.json(
        { error: "Couldn't find another photo for this slide — try uploading one." },
        { status: 502 },
      );
    }

    // "Try another photo" has to actually produce a photo not already in the
    // deck. The judge is deterministic, so its top pick is frequently the shot
    // already on this slide — which looked exactly like a broken button — and
    // taking the runner-up blindly can duplicate a photo from another slide.
    // Skip anything matching ANY existing background, in ranked order.
    const usedHashes = await deckBgHashes(supabase, id);
    let chosen: { jpeg: Buffer; url: string } | null = null;
    for (const cand of picked.ranked) {
      let fitted: Buffer;
      try {
        fitted = await prepareBackground(cand.raw);
      } catch {
        continue;
      }
      if (usedHashes.has(sha1(fitted))) continue;
      chosen = { jpeg: fitted, url: cand.url };
      break;
    }
    if (!chosen) {
      await refundSwap();
      return NextResponse.json(
        {
          error:
            "Every option we found is already in this slideshow — try again or upload your own.",
        },
        { status: 502 },
      );
    }
    jpeg = chosen.jpeg;
    sourceUrl = chosen.url;
  }

  // A new photo has different brightness where the caption sits, so the stored
  // plate decision has to be re-measured — otherwise white text can land on a
  // bright new background with no plate behind it.
  const probe = await probeCaptionContrast(jpeg, {
    text: slide.caption ?? "",
    role: slide.role as SlideRole,
    number: slide.number ?? null,
    pos: {
      x: slide.position_x ?? 0.5,
      y: slide.position_y ?? 0.82,
      align: (slide.align ?? "center") as Align,
      maxWidth: slide.max_width ?? undefined,
      fontScale: slide.font_scale ?? undefined,
    },
    body: slide.body ?? null,
  });

  // Write to a NEW versioned path instead of overwriting in place.
  //
  // Overwriting looked correct — the upload returned 200 and the bytes really
  // did change — but the renderer kept serving the previous photo for a while
  // afterwards, because Supabase Storage had the old object cached from
  // generation (default cacheControl 3600) and an upsert does not reliably
  // evict that entry. Setting cache-control on the new write cannot fix an
  // entry that is already cached. A fresh key has no cache history at all, so
  // the swap is visible immediately and every stored background stays
  // immutable.
  const oldBgPath = bgPathFrom(slide.storage_path);
  const base = `${user.id}/${id}/${position}-v${Date.now()}.jpg`;
  const newBgPath = bgPathFrom(base);

  const {
    data: { session },
  } = await supabase.auth.getSession();
  const up = await rawUpload(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    "slideshows",
    newBgPath,
    jpeg,
    session?.access_token ?? "",
  );
  if (up.error) {
    await refundSwap();
    return NextResponse.json({ error: `Couldn't save the image: ${up.error}` }, { status: 500 });
  }

  const { error: updErr } = await supabase
    .from("slides")
    .update({ storage_path: base, text_bg: probe?.poor ?? false })
    .eq("slideshow_id", id)
    .eq("position", position as number);
  if (updErr) {
    // The row still points at the old background, so the deck is unchanged
    // rather than broken. Bin the orphan we just wrote.
    await supabase.storage.from("slideshows").remove([newBgPath]).catch(() => {});
    await refundSwap();
    return NextResponse.json({ error: "Couldn't save the image." }, { status: 500 });
  }

  // Best-effort: the previous background is now unreferenced.
  if (oldBgPath !== newBgPath) {
    await supabase.storage.from("slideshows").remove([oldBgPath]).catch(() => {});
  }

  // The client overlays live text on the background itself, so it needs a
  // signed URL for the NEW object — the old one it holds is now deleted.
  const { data: signed } = await supabase.storage
    .from("slideshows")
    .createSignedUrl(newBgPath, SIGNED_URL_TTL);

  // Bump the parent so hub thumbnails (versioned by updated_at) refetch.
  await supabase
    .from("slideshows")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", id);

  return NextResponse.json({
    ok: true,
    sourceUrl,
    bgUrl: signed?.signedUrl ?? null,
    // The plate was re-measured against the NEW photo, so the editor's live
    // overlay has to adopt it or it will disagree with the baked render.
    textBg: probe?.poor ?? false,
    // AI swaps left before the next credit is taken (null = upload/admin, which
    // cost nothing). Lets the editor state the price before charging it.
    swapsLeftInBlock,
  });
}
