import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { compositeSlide } from "@/lib/generate/composite";
import type { Align, SlideRole } from "@/lib/generate/layout";

// Authoritative re-export. The drag editor updates the live HTML preview
// instantly; on release it POSTs here to (1) persist the new position and
// (2) re-run Sharp compositing from the stored text-free background so the
// downloaded/zipped PNG matches the preview. Only the affected slides change.
// Sharp needs the Node.js runtime.
export const runtime = "nodejs";
export const maxDuration = 60;

const ALIGNS: Align[] = ["left", "center", "right"];
const ROLES: SlideRole[] = ["title", "reason", "plug", "cta"];
const SIGNED_URL_TTL = 60 * 60; // 1 hour

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

  // Load the affected slides (RLS scopes to the owner via the parent slideshow).
  const positions = updates.map((u) => u.position);
  const { data: rows, error: selErr } = await supabase
    .from("slides")
    .select("position, role, number, caption, storage_path")
    .eq("slideshow_id", id)
    .in("position", positions);
  if (selErr) {
    return NextResponse.json({ error: selErr.message }, { status: 500 });
  }
  const byPos = new Map((rows ?? []).map((r) => [r.position, r]));

  try {
    const urls: Record<number, string> = {};

    await Promise.all(
      updates.map(async (u) => {
        const row = byPos.get(u.position);
        if (!row || !row.storage_path) return;

        const x = clamp(u.x, 0, 1);
        const y = clamp(u.y, 0, 1);
        const align = u.align;
        const maxWidth =
          u.maxWidth == null ? null : clamp(u.maxWidth, 0.2, 0.96);
        const role = ROLES.includes(row.role as SlideRole)
          ? (row.role as SlideRole)
          : "reason";

        // 1) Persist the normalized position.
        const { error: upErr } = await supabase
          .from("slides")
          .update({ position_x: x, position_y: y, align, max_width: maxWidth })
          .eq("slideshow_id", id)
          .eq("position", u.position);
        if (upErr) throw new Error(upErr.message);

        // 2) Re-composite from the stored text-free background.
        const bgPath = row.storage_path.replace(/\.png$/, "-bg.jpg");
        const { data: bgBlob, error: dlErr } = await supabase.storage
          .from("slideshows")
          .download(bgPath);
        if (dlErr || !bgBlob) {
          throw new Error(
            "Editable background missing — regenerate this slideshow to enable repositioning.",
          );
        }
        const png = await compositeSlide(
          Buffer.from(await bgBlob.arrayBuffer()),
          {
            text: row.caption ?? "",
            role,
            number: row.number,
            pos: { x, y, align, maxWidth: maxWidth ?? undefined },
          },
        );

        // 3) Overwrite the composited PNG.
        const { error: putErr } = await supabase.storage
          .from("slideshows")
          .upload(row.storage_path, png, {
            contentType: "image/png",
            upsert: true,
          });
        if (putErr) throw new Error(putErr.message);

        const { data: signed } = await supabase.storage
          .from("slideshows")
          .createSignedUrl(row.storage_path, SIGNED_URL_TTL);
        if (signed?.signedUrl) urls[u.position] = signed.signedUrl;
      }),
    );

    return NextResponse.json({ ok: true, urls });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Reposition failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
