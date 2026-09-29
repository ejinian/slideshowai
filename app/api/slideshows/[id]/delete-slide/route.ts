import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { bgPathFrom } from "@/lib/generate/renderSlide";
import { ownsPath, parseTexts, touchDeck } from "@/lib/slides/structure";

// Removes ONE slide from a deck and closes the gap it leaves.
//
// The editor deletes on a single click and offers Undo, so this route does NOT
// delete the slide's background: it hands the removed row back, and
// restore-slide can put it straight back with nothing re-uploaded. The
// background is removed by a second call (`{ purge }`) once the Undo window has
// closed. A purge that never arrives (tab closed) leaves one unreferenced
// object behind, which deleting the slideshow sweeps with the rest of its
// folder.
export const runtime = "nodejs";

interface SlideRow {
  id: string;
  position: number;
  storage_path: string | null;
  [column: string]: unknown;
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

  let body: { position?: unknown; texts?: unknown; purge?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  // RLS scopes this read to the owner via the parent slideshow.
  const { data, error: readErr } = await supabase
    .from("slides")
    .select("*")
    .eq("slideshow_id", id)
    .order("position", { ascending: true });
  if (readErr) {
    return NextResponse.json({ error: readErr.message }, { status: 500 });
  }
  const rows = (data ?? []) as SlideRow[];
  if (rows.length === 0) {
    return NextResponse.json({ error: "Slideshow not found." }, { status: 404 });
  }

  // ── Purge: the Undo window closed, the background is no longer needed ──
  if (body.purge !== undefined) {
    if (!ownsPath(body.purge, user.id, id)) {
      return NextResponse.json({ error: "Invalid path." }, { status: 400 });
    }
    // Never a background a slide still uses — an Undo may have put it back.
    const bg = bgPathFrom(body.purge);
    if (rows.some((r) => r.storage_path && bgPathFrom(r.storage_path) === bg)) {
      return NextResponse.json({ ok: true, kept: true });
    }
    const paths = [...new Set([bg, body.purge])];
    await supabase.storage.from("slideshows").remove(paths).catch(() => {});
    return NextResponse.json({ ok: true });
  }

  const target = rows.find((r) => r.position === body.position);
  if (!target) {
    return NextResponse.json({ error: "Slide not found." }, { status: 404 });
  }
  if (rows.length <= 1) {
    return NextResponse.json(
      { error: "A slideshow needs at least one slide." },
      { status: 400 },
    );
  }

  const { error: delErr } = await supabase.from("slides").delete().eq("id", target.id);
  if (delErr) {
    return NextResponse.json({ error: delErr.message }, { status: 500 });
  }

  // Close the gap LOWEST FIRST, one row at a time. Each slide moves into a
  // position that is already empty, so no two rows ever share one — the render
  // endpoint reads a slide by position with .single() and would fail on a pair.
  // If a write fails part-way the deck is left with a gap, not a duplicate:
  // every reader walks the positions that exist, and the next reorder closes it.
  const remaining = rows.filter((r) => r.id !== target.id);
  const texts = parseTexts(body.texts, remaining.length);
  for (let i = 0; i < remaining.length; i++) {
    const row = remaining[i];
    const patch = {
      ...(row.position !== i ? { position: i } : {}),
      ...texts.get(i),
    };
    if (Object.keys(patch).length === 0) continue;
    const { error } = await supabase.from("slides").update(patch).eq("id", row.id);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }

  await touchDeck(supabase, id, remaining.length);

  return NextResponse.json({ ok: true, removed: target });
}
