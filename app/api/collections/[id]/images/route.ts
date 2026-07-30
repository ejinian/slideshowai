import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

export const runtime = "nodejs";

// Register / remove images in a collection.
//
// POST does NOT receive bytes — the browser has already uploaded straight to
// the private `collections` bucket with its own session (RLS scopes writes to
// `${userId}/…`). This only records the resulting paths, so a 50-photo drop
// costs one small JSON request instead of blowing Vercel's ~4.5MB body limit.

interface RegisterBody {
  images?: {
    storagePath?: string;
    name?: string;
    width?: number;
    height?: number;
  }[];
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: RegisterBody;
  try {
    body = (await request.json()) as RegisterBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  // Confirm the collection is this user's before writing rows against it. RLS
  // would reject the insert anyway, but this returns a real 404 instead of a
  // policy error.
  const { data: collection } = await supabase
    .from("collections")
    .select("id")
    .eq("id", id)
    .maybeSingle();
  if (!collection) {
    return NextResponse.json({ error: "Collection not found." }, { status: 404 });
  }

  const prefix = `${user.id}/${id}/`;
  const incoming = (body.images ?? []).filter(
    (i): i is { storagePath: string; name?: string; width?: number; height?: number } =>
      typeof i.storagePath === "string" &&
      // Never let a client register a path outside its own folder — RLS guards
      // the bytes, but the ROW is what generation later reads from.
      i.storagePath.startsWith(prefix),
  );
  if (incoming.length === 0) {
    return NextResponse.json({ error: "No valid images." }, { status: 400 });
  }

  // Append after whatever is already there so the user's order is stable.
  const { data: last } = await supabase
    .from("collection_images")
    .select("position")
    .eq("collection_id", id)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();
  const base = (last?.position ?? -1) + 1;

  const { data, error } = await supabase
    .from("collection_images")
    .insert(
      incoming.map((img, i) => ({
        collection_id: id,
        user_id: user.id,
        storage_path: img.storagePath,
        name: (img.name ?? "").slice(0, 120),
        width: Number.isFinite(img.width) ? img.width : null,
        height: Number.isFinite(img.height) ? img.height : null,
        position: base + i,
      })),
    )
    .select("id, storage_path, name, width, height");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Touch the parent so the grid re-sorts by "recently changed".
  await supabase
    .from("collections")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", id);

  const paths = (data ?? []).map((d) => d.storage_path);
  const { data: signed } = await supabase.storage
    .from("collections")
    .createSignedUrls(paths, 3600);
  const byPath = new Map(
    (signed ?? []).map((s) => [s.path ?? "", s.signedUrl ?? ""]),
  );

  return NextResponse.json({
    images: (data ?? []).map((d) => ({
      id: d.id,
      url: byPath.get(d.storage_path) ?? "",
      name: d.name,
      width: d.width,
      height: d.height,
    })),
  });
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { imageIds?: string[] };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const imageIds = (body.imageIds ?? []).filter(
    (i): i is string => typeof i === "string" && i.length > 0,
  );
  if (imageIds.length === 0) {
    return NextResponse.json({ error: "No images selected." }, { status: 400 });
  }

  // Read the paths first — after the row is gone we can't find the object.
  const { data: rows, error: readErr } = await supabase
    .from("collection_images")
    .select("id, storage_path")
    .eq("collection_id", id)
    .in("id", imageIds);
  if (readErr) {
    return NextResponse.json({ error: readErr.message }, { status: 500 });
  }
  if (!rows || rows.length === 0) {
    return NextResponse.json({ error: "Nothing to remove." }, { status: 404 });
  }

  const { error: delErr } = await supabase
    .from("collection_images")
    .delete()
    .eq("collection_id", id)
    .in(
      "id",
      rows.map((r) => r.id),
    );
  if (delErr) {
    return NextResponse.json({ error: delErr.message }, { status: 500 });
  }

  // Best-effort: the row is the source of truth, so a failed object delete
  // leaves a harmless orphan rather than a broken collection.
  await supabase.storage
    .from("collections")
    .remove(rows.map((r) => r.storage_path));

  await supabase
    .from("collections")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", id);

  return NextResponse.json({ ok: true, removed: rows.map((r) => r.id) });
}
