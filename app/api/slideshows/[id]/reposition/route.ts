import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import type { Align } from "@/lib/generate/layout";

// Persists caption positions ONLY. Text is never baked into a stored image —
// slides are composited on demand for display/post (see lib/generate/renderSlide.ts).
// So repositioning is a pure DB write: instant, and re-stacking text is impossible.
export const runtime = "nodejs";

const ALIGNS: Align[] = ["left", "center", "right"];

interface PosUpdate {
  position: number;
  x: number;
  y: number;
  align: Align;
  maxWidth?: number | null;
  /** Optional caption text edit — rides the same save path as positions. */
  caption?: string;
}

const MAX_CAPTION_CHARS = 300;

const clamp = (v: number, lo: number, hi: number) =>
  Math.min(Math.max(Number.isFinite(v) ? v : lo, lo), hi);

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

  let body: { updates?: PosUpdate[] };
  try {
    body = (await request.json()) as { updates?: PosUpdate[] };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const updates = (body.updates ?? []).filter(
    (u) => u && Number.isInteger(u.position) && ALIGNS.includes(u.align),
  );
  if (updates.length === 0) {
    return NextResponse.json({ error: "No valid updates." }, { status: 400 });
  }

  // RLS scopes these to the owner via the parent slideshow.
  const results = await Promise.all(
    updates.map((u) => {
      const x = clamp(u.x, 0, 1);
      const y = clamp(u.y, 0, 1);
      const maxWidth = u.maxWidth == null ? null : clamp(u.maxWidth, 0.2, 0.96);
      const patch: Record<string, unknown> = {
        position_x: x,
        position_y: y,
        align: u.align,
        max_width: maxWidth,
      };
      // Caption edits ride along. Empty strings are ignored (the editor blocks
      // them client-side too) so a slide can never end up textless by accident.
      if (typeof u.caption === "string") {
        const caption = u.caption.trim().slice(0, MAX_CAPTION_CHARS);
        if (caption) patch.caption = caption;
      }
      return supabase
        .from("slides")
        .update(patch)
        .eq("slideshow_id", id)
        .eq("position", u.position);
    }),
  );

  const failed = results.find((r) => r.error);
  if (failed?.error) {
    return NextResponse.json({ error: failed.error.message }, { status: 500 });
  }

  // Touch the parent so its updated_at bumps (the set_updated_at trigger fires
  // on slideshows-row updates only) — hub thumbnails use it as a cache-buster.
  await supabase
    .from("slideshows")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", id);

  return NextResponse.json({ ok: true });
}
