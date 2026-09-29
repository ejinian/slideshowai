import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { FONT_SCALE_MAX, FONT_SCALE_MIN } from "@/lib/generate/layout";
import { ownsPath, parseTexts, touchDeck } from "@/lib/slides/structure";

// Undo for delete-slide: puts a removed slide back where it was.
//
// `slide` is the row delete-slide handed out, sent back by the editor. It has
// been in the browser, so it is treated as input, not as a record: every column
// is re-validated and the background must sit in the caller's own deck folder.
// The background itself was never deleted (see delete-slide), so this is a pure
// DB write like every other structural edit.
export const runtime = "nodejs";

const ROLES = ["title", "reason", "plug", "cta"];
const ALIGNS = ["left", "center", "right"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const unit = (v: unknown, fallback: number | null) =>
  typeof v === "number" && Number.isFinite(v) ? Math.min(Math.max(v, 0), 1) : fallback;

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

  let body: { slide?: unknown; position?: unknown; texts?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const slide = (body.slide ?? null) as Record<string, unknown> | null;
  if (!slide || typeof slide !== "object" || !ownsPath(slide.storage_path, user.id, id)) {
    return NextResponse.json({ error: "Nothing to restore." }, { status: 400 });
  }

  // RLS scopes this read to the owner via the parent slideshow.
  const { data, error: readErr } = await supabase
    .from("slides")
    .select("id, position")
    .eq("slideshow_id", id)
    .order("position", { ascending: true });
  if (readErr) {
    return NextResponse.json({ error: readErr.message }, { status: 500 });
  }
  const rows = data ?? [];
  if (rows.length === 0) {
    return NextResponse.json({ error: "Slideshow not found." }, { status: 404 });
  }
  // A second Undo for the same slide: it is already back.
  if (rows.some((r) => r.id === slide.id)) {
    return NextResponse.json({ error: "That slide is already back." }, { status: 409 });
  }

  // Only the columns the deleted row actually had are written back, so this
  // works whichever of the hand-run slide migrations the database has.
  const row: Record<string, unknown> = {
    slideshow_id: id,
    storage_path: slide.storage_path,
    role: ROLES.includes(slide.role as string) ? slide.role : "reason",
    number:
      typeof slide.number === "number" && Number.isInteger(slide.number) ? slide.number : null,
    caption: typeof slide.caption === "string" ? slide.caption.slice(0, 300) : "",
  };
  // Re-using the id is what lets a repeated Undo be recognised (above).
  if (typeof slide.id === "string" && UUID.test(slide.id)) row.id = slide.id;
  if ("body" in slide) {
    row.body = typeof slide.body === "string" ? slide.body.slice(0, 600) || null : null;
  }
  if ("position_x" in slide) row.position_x = unit(slide.position_x, null);
  if ("position_y" in slide) row.position_y = unit(slide.position_y, null);
  if ("align" in slide) {
    row.align = ALIGNS.includes(slide.align as string) ? slide.align : "center";
  }
  if ("max_width" in slide) {
    const w = unit(slide.max_width, null);
    row.max_width = w == null ? null : Math.min(Math.max(w, 0.2), 0.96);
  }
  if ("text_bg" in slide) row.text_bg = slide.text_bg === true;
  if ("font_scale" in slide) {
    row.font_scale =
      typeof slide.font_scale === "number" && Number.isFinite(slide.font_scale)
        ? Math.min(Math.max(slide.font_scale, FONT_SCALE_MIN), FONT_SCALE_MAX)
        : null;
  }
  if ("image_keywords" in slide) {
    row.image_keywords = Array.isArray(slide.image_keywords)
      ? slide.image_keywords
          .filter((k): k is string => typeof k === "string")
          .slice(0, 12)
          .map((k) => k.slice(0, 80))
      : [];
  }

  const at =
    typeof body.position === "number" && Number.isInteger(body.position)
      ? Math.min(Math.max(body.position, 0), rows.length)
      : rows.length;

  // Insert FIRST, parked past the end of the deck, so a failed insert leaves
  // nothing moved. Then open the slot highest-first and drop the slide into it:
  // every write lands on an empty position, so no two rows ever share one (the
  // render endpoint reads a slide by position with .single()).
  const lastPosition = Math.max(...rows.map((r) => r.position as number));
  const { data: inserted, error: insErr } = await supabase
    .from("slides")
    .insert({ ...row, position: lastPosition + 2 })
    .select("id")
    .single();
  if (insErr || !inserted) {
    return NextResponse.json(
      { error: insErr?.message ?? "Couldn't restore that slide." },
      { status: 500 },
    );
  }

  const texts = parseTexts(body.texts, rows.length + 1);
  // rows[i] sat at index i; everything from `at` on moves one later.
  for (let i = rows.length - 1; i >= 0; i--) {
    const to = i >= at ? i + 1 : i;
    const patch = {
      ...(rows[i].position !== to ? { position: to } : {}),
      ...texts.get(to),
    };
    if (Object.keys(patch).length === 0) continue;
    const { error } = await supabase.from("slides").update(patch).eq("id", rows[i].id);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }
  const { error: placeErr } = await supabase
    .from("slides")
    .update({ position: at, ...texts.get(at) })
    .eq("id", inserted.id);
  if (placeErr) {
    return NextResponse.json({ error: placeErr.message }, { status: 500 });
  }

  await touchDeck(supabase, id, rows.length + 1);

  return NextResponse.json({ ok: true });
}
