import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { renderSlideJpeg } from "@/lib/generate/renderSlide";

// In-app slide image: bakes bg + live text on demand for display (hub thumbnails,
// post viewer, generator filmstrip). Session-authed; RLS scopes to the owner.
// Sharp needs the Node.js runtime.
export const runtime = "nodejs";

export async function GET(
  request: Request,
  ctx: { params: Promise<{ id: string; pos: string }> },
) {
  const { id, pos } = await ctx.params;
  const posNum = parseInt(pos, 10);
  if (!Number.isInteger(posNum) || posNum < 0) {
    return NextResponse.json({ error: "Invalid position." }, { status: 400 });
  }

  const url = new URL(request.url);
  // Optional downscale for thumbnails (?w=540): the full bake is ~300KB of
  // 1080x1920 JPEG, absurd for a 161px hub card. Clamped so it can't upscale
  // or be abused as a resizer.
  const wParam = Number(url.searchParams.get("w"));
  const width =
    Number.isFinite(wParam) && wParam >= 100 && wParam < 1080
      ? Math.round(wParam)
      : undefined;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const result = await renderSlideJpeg(supabase, id, posNum, width);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  // Versioned URLs (?v=<updated_at>, hub thumbnails) are immutable by
  // construction — any edit changes updated_at, which changes the URL — so the
  // browser may cache them forever, making hub revisits instant instead of
  // re-baking 12 slides. Unversioned consumers (editor, detail, post viewer)
  // keep revalidating every load so caption edits appear immediately.
  const versioned = url.searchParams.has("v");
  return new Response(new Uint8Array(result.jpeg), {
    status: 200,
    headers: {
      "Content-Type": "image/jpeg",
      "Cache-Control": versioned
        ? "private, max-age=31536000, immutable"
        : "private, max-age=0, must-revalidate",
    },
  });
}
