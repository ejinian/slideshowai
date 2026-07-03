import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { renderSlideJpeg } from "@/lib/generate/renderSlide";

// In-app slide image: bakes bg + live text on demand for display (hub thumbnails,
// post viewer, generator filmstrip). Session-authed; RLS scopes to the owner.
// Sharp needs the Node.js runtime.
export const runtime = "nodejs";

export async function GET(
  _request: Request,
  ctx: { params: Promise<{ id: string; pos: string }> },
) {
  const { id, pos } = await ctx.params;
  const posNum = parseInt(pos, 10);
  if (!Number.isInteger(posNum) || posNum < 0) {
    return NextResponse.json({ error: "Invalid position." }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const result = await renderSlideJpeg(supabase, id, posNum);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return new Response(new Uint8Array(result.jpeg), {
    status: 200,
    headers: {
      "Content-Type": "image/jpeg",
      // Revalidate every load so caption edits appear immediately (never stale).
      "Cache-Control": "private, max-age=0, must-revalidate",
    },
  });
}
