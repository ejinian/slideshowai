import sharp from "sharp";
import type { SupabaseClient } from "@supabase/supabase-js";
import { compositeSlide } from "@/lib/generate/composite";
import type { Align, SlideRole } from "@/lib/generate/layout";

// Server-only. Bakes a slide ON DEMAND from its text-free background + the live
// text data in the DB. Nothing baked is ever stored — display, download, and the
// TikTok pull all go through here, so a caption is only ever composited transiently.
// Callers pass either the session client (RLS-scoped) or the admin client.

const ROLES: SlideRole[] = ["title", "reason", "plug", "cta"];
const ALIGNS: Align[] = ["left", "center", "right"];

/**
 * The text-free background path for a slide. Handles legacy baked paths
 * (`{i}.jpg` / `{i}.png`) and paths that are already the `-bg.jpg` background.
 */
export function bgPathFrom(storagePath: string): string {
  if (storagePath.endsWith("-bg.jpg")) return storagePath;
  return storagePath.replace(/\.(png|jpe?g)$/i, "-bg.jpg");
}

export type RenderResult =
  | { ok: true; jpeg: Buffer }
  | { ok: false; status: number; error: string };

export async function renderSlideJpeg(
  client: SupabaseClient,
  slideshowId: string,
  pos: number,
): Promise<RenderResult> {
  const { data: slide, error } = await client
    .from("slides")
    .select("storage_path, caption, role, number, position_x, position_y, align, max_width")
    .eq("slideshow_id", slideshowId)
    .eq("position", pos)
    .single();

  if (error) return { ok: false, status: 500, error: `Slide lookup failed: ${error.message}` };
  if (!slide?.storage_path) return { ok: false, status: 404, error: "Slide not found." };

  const bgPath = bgPathFrom(slide.storage_path);
  const { data: blob, error: dlErr } = await client.storage
    .from("slideshows")
    .download(bgPath);
  if (dlErr || !blob) {
    return { ok: false, status: 404, error: "Editable background missing — regenerate this slideshow." };
  }

  const role = ROLES.includes(slide.role as SlideRole) ? (slide.role as SlideRole) : "reason";
  const align = ALIGNS.includes(slide.align as Align) ? (slide.align as Align) : "center";

  const png = await compositeSlide(Buffer.from(await blob.arrayBuffer()), {
    text: slide.caption ?? "",
    role,
    number: slide.number ?? null,
    pos: {
      x: slide.position_x ?? 0.5,
      y: slide.position_y ?? 0.82,
      align,
      maxWidth: slide.max_width ?? undefined,
    },
  });
  const jpeg = await sharp(png).jpeg({ quality: 85 }).toBuffer();
  return { ok: true, jpeg };
}
