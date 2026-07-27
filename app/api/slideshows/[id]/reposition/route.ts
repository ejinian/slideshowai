import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import {
  FONT_SCALE_MIN,
  FONT_SCALE_MAX,
  type Align,
} from "@/lib/generate/layout";
import { isTextBgMode } from "@/lib/generate/textBg";

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
  /** Optional caption size multiplier (1 = as generated). */
  fontScale?: number | null;
}

interface Body {
  updates?: PosUpdate[];
  /** Deck-level caption-plate override: 'auto' | 'on' | 'off'. */
  textBgMode?: unknown;
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

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const updates = (body.updates ?? []).filter(
    (u) => u && Number.isInteger(u.position) && ALIGNS.includes(u.align),
  );
  // The deck-level caption-plate mode is a slideshow-row edit, so it arrives
  // with an empty `updates` array. Only a request carrying neither is a no-op.
  const textBgMode = isTextBgMode(body.textBgMode) ? body.textBgMode : null;
  if (updates.length === 0 && !textBgMode) {
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
      if (u.fontScale != null) {
        patch.font_scale = clamp(u.fontScale, FONT_SCALE_MIN, FONT_SCALE_MAX);
      }
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
  // The plate mode, when present, rides the same write.
  const { error: showErr } = await supabase
    .from("slideshows")
    .update({
      updated_at: new Date().toISOString(),
      ...(textBgMode ? { text_bg_mode: textBgMode } : {}),
    })
    .eq("id", id);
  if (showErr && textBgMode) {
    return NextResponse.json({ error: showErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
