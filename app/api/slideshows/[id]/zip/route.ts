import JSZip from "jszip";
import { createClient } from "@/utils/supabase/server";
import { renderSlideJpeg } from "@/lib/generate/renderSlide";

// Streams a slideshow's slides into a single .zip. Each slide is baked on demand
// (text-free bg + live caption) via the shared renderer, so the download always
// reflects the current text. Node runtime; ownership enforced by RLS.
export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(
  _request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const { data: ss } = await supabase
    .from("slideshows")
    .select("title")
    .eq("id", id)
    .single();
  if (!ss) return new Response("Not found", { status: 404 });

  const { data: slides } = await supabase
    .from("slides")
    .select("position")
    .eq("slideshow_id", id)
    .order("position", { ascending: true });
  if (!slides || slides.length === 0) {
    return new Response("No slides", { status: 404 });
  }

  const zip = new JSZip();
  for (const s of slides) {
    const result = await renderSlideJpeg(supabase, id, s.position);
    if (!result.ok) continue;
    zip.file(`slide-${String(s.position + 1).padStart(2, "0")}.jpg`, result.jpeg);
  }

  const out = await zip.generateAsync({ type: "nodebuffer" });
  const safe =
    (ss.title || "slideshow")
      .replace(/[^a-z0-9]+/gi, "-")
      .toLowerCase()
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "slideshow";

  return new Response(new Uint8Array(out), {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${safe}.zip"`,
    },
  });
}
