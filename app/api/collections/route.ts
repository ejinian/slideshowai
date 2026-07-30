import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

export const runtime = "nodejs";

// Image collections — the user's reusable photo library (owner-scoped via
// RLS). Bytes are NOT uploaded through here: the browser writes straight to
// the private `collections` bucket with its own session, then registers the
// paths via /api/collections/[id]/images. A Next route body cannot carry a
// bulk drop of 50 photos.

/** Signed-URL lifetime for grid/detail thumbnails (1h). */
export const THUMB_TTL = 3600;
/** Covers shown on a collection card in the grid. */
const COVERS_PER_CARD = 4;

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: rows, error } = await supabase
    .from("collections")
    .select(
      "id, name, is_product_images, created_at, updated_at, collection_images(id, storage_path, position, created_at)",
    )
    .order("updated_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  type ImgRow = {
    id: string;
    storage_path: string;
    position: number;
    created_at: string;
  };
  type Row = {
    id: string;
    name: string;
    is_product_images: boolean;
    created_at: string;
    updated_at: string;
    collection_images: ImgRow[] | null;
  };

  const list = (rows ?? []) as unknown as Row[];

  // One signing call for every cover across every collection — signing per
  // collection would be N round-trips on a grid that can hold dozens.
  const coverPaths: string[] = [];
  for (const c of list) {
    const imgs = [...(c.collection_images ?? [])].sort(
      (a, b) =>
        a.position - b.position || a.created_at.localeCompare(b.created_at),
    );
    coverPaths.push(...imgs.slice(0, COVERS_PER_CARD).map((i) => i.storage_path));
  }
  const signedByPath = new Map<string, string>();
  if (coverPaths.length > 0) {
    const { data: signed } = await supabase.storage
      .from("collections")
      .createSignedUrls(coverPaths, THUMB_TTL);
    for (const s of signed ?? []) {
      if (s.path && s.signedUrl) signedByPath.set(s.path, s.signedUrl);
    }
  }

  return NextResponse.json({
    collections: list.map((c) => {
      const imgs = [...(c.collection_images ?? [])].sort(
        (a, b) =>
          a.position - b.position || a.created_at.localeCompare(b.created_at),
      );
      return {
        id: c.id,
        name: c.name,
        isProductImages: c.is_product_images,
        createdAt: c.created_at,
        updatedAt: c.updated_at,
        imageCount: imgs.length,
        covers: imgs
          .slice(0, COVERS_PER_CARD)
          .map((i) => signedByPath.get(i.storage_path))
          .filter((u): u is string => !!u),
      };
    }),
  });
}

export async function POST(request: Request) {
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

  const name = (body.name ?? "").trim().slice(0, 80) || "Untitled collection";
  const { data, error } = await supabase
    .from("collections")
    .insert({
      user_id: user.id,
      name,
      is_product_images: !!body.isProductImages,
    })
    .select("id, name, is_product_images, created_at, updated_at")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    collection: {
      id: data.id,
      name: data.name,
      isProductImages: data.is_product_images,
      createdAt: data.created_at,
      updatedAt: data.updated_at,
      imageCount: 0,
      covers: [],
    },
  });
}
