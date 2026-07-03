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
}

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
      return supabase
        .from("slides")
        .update({ position_x: x, position_y: y, align: u.align, max_width: maxWidth })
        .eq("slideshow_id", id)
        .eq("position", u.position);
    }),
  );

  const failed = results.find((r) => r.error);
  if (failed?.error) {
    return NextResponse.json({ error: failed.error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
