import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { THUMB_TTL } from "../route";

export const runtime = "nodejs";

// A single collection with every image signed for display. Owner-scoped by
// RLS — a foreign id simply returns no rows, so there's no separate authz.

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: collection, error } = await supabase
    .from("collections")
    .select("id, name, is_product_images, created_at, updated_at")
    .eq("id", id)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!collection) {
    return NextResponse.json({ error: "Collection not found." }, { status: 404 });
  }

  const { data: images, error: imgErr } = await supabase
    .from("collection_images")
    .select("id, storage_path, name, width, height, position, created_at")
    .eq("collection_id", id)
    .order("position", { ascending: true })
    .order("created_at", { ascending: true });
  if (imgErr) {
    return NextResponse.json({ error: imgErr.message }, { status: 500 });
  }

  const paths = (images ?? []).map((i) => i.storage_path);
  const signedByPath = new Map<string, string>();
  if (paths.length > 0) {
    const { data: signed } = await supabase.storage
      .from("collections")
      .createSignedUrls(paths, THUMB_TTL);
    for (const s of signed ?? []) {
      if (s.path && s.signedUrl) signedByPath.set(s.path, s.signedUrl);
    }
  }

  return NextResponse.json({
    collection: {
      id: collection.id,
      name: collection.name,
      isProductImages: collection.is_product_images,
      createdAt: collection.created_at,
      updatedAt: collection.updated_at,
    },
    images: (images ?? []).map((i) => ({
      id: i.id,
      url: signedByPath.get(i.storage_path) ?? "",
      name: i.name,
      width: i.width,
      height: i.height,
    })),
  });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { name?: string; isProductImages?: boolean };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const patch: Record<string, unknown> = {};
  if (typeof body.name === "string") {
    const name = body.name.trim().slice(0, 80);
    // An empty rename is a slip, not an intent to blank the title.
    if (name) patch.name = name;
  }
  if (typeof body.isProductImages === "boolean") {
    patch.is_product_images = body.isProductImages;
  }
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("collections")
    .update(patch)
    .eq("id", id)
    .select("id, name, is_product_images, updated_at")
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) {
    return NextResponse.json({ error: "Collection not found." }, { status: 404 });
  }

  return NextResponse.json({
    collection: {
      id: data.id,
      name: data.name,
      isProductImages: data.is_product_images,
      updatedAt: data.updated_at,
    },
  });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Remove the objects BEFORE the row: `on delete cascade` drops the image
  // rows, and without their storage_paths the files would be orphaned in the
  // bucket with nothing left pointing at them.
  const { data: images } = await supabase
    .from("collection_images")
    .select("storage_path")
    .eq("collection_id", id);
  const paths = (images ?? []).map((i) => i.storage_path);
  if (paths.length > 0) {
    await supabase.storage.from("collections").remove(paths);
  }

  const { error } = await supabase.from("collections").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, removedFiles: paths.length });
}
