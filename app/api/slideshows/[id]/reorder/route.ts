import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

// Reorders the slides of a slideshow. Like repositioning, this is a pure DB
// write: `position` is the only thing that moves. `storage_path` stays bound to
// its own slide (it is an identifier, not an ordinal), so no Storage objects are
// touched and nothing is re-baked.
//
// There is no unique constraint on (slideshow_id, position) — only an index —
// so the new positions can be written directly without a two-phase shuffle.
export const runtime = "nodejs";

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

  let body: { order?: unknown };
  try {
    body = (await request.json()) as { order?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const order = Array.isArray(body.order)
    ? body.order.filter((n): n is number => Number.isInteger(n))
    : [];
  if (order.length === 0) {
    return NextResponse.json({ error: "No order supplied." }, { status: 400 });
  }

  // RLS scopes this read to the owner via the parent slideshow.
  const { data: rows, error: readErr } = await supabase
    .from("slides")
    .select("id, position")
    .eq("slideshow_id", id);
  if (readErr) {
    return NextResponse.json({ error: readErr.message }, { status: 500 });
  }

  const byPosition = new Map((rows ?? []).map((r) => [r.position as number, r.id as string]));
  // The payload must be a permutation of exactly the positions that exist —
  // anything else would silently drop or duplicate a slide.
  const distinct = new Set(order);
  if (
    distinct.size !== order.length ||
    order.length !== byPosition.size ||
    order.some((p) => !byPosition.has(p))
  ) {
    return NextResponse.json(
      { error: "Order must list every existing slide position exactly once." },
      { status: 400 },
    );
  }

  const results = await Promise.all(
    order.map((fromPosition, toPosition) =>
      supabase
        .from("slides")
        .update({ position: toPosition })
        .eq("id", byPosition.get(fromPosition)!),
    ),
  );
  const failed = results.find((r) => r.error);
  if (failed?.error) {
    return NextResponse.json({ error: failed.error.message }, { status: 500 });
  }

  // Bump the parent so hub thumbnails bust their image cache (they key off
  // updated_at) and the first slide's thumbnail reflects any new slide 1.
  await supabase
    .from("slideshows")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", id);

  return NextResponse.json({ ok: true });
}
