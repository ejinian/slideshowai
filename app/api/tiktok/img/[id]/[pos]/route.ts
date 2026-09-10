import { type NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/utils/supabase/admin";
import { verifyProxyToken } from "@/utils/tiktok";
import { renderSlideJpeg } from "@/lib/generate/renderSlide";

// Public image proxy — no session auth, TikTok's servers pull this directly.
// Authentication is via a short-lived HMAC token in the query string.
// Bakes the slide (text-free background + live caption) to JPEG ON DEMAND via
// the shared renderer, so what TikTok pulls always matches the current text.
export const runtime = "nodejs";

export async function GET(
  request: NextRequest,
  ctx: { params: Promise<{ id: string; pos: string }> },
) {
  const { id, pos } = await ctx.params;
  const { searchParams } = new URL(request.url);
  const token = searchParams.get("token") ?? "";
  const exp = searchParams.get("exp") ?? "";

  // verifyProxyToken reads TIKTOK_CLIENT_SECRET and THROWS when it is unset.
  // Unhandled, that surfaces as a platform 500 with an EMPTY body — which told
  // us nothing while TikTok silently failed to pull every slide and every post
  // hung in PROCESSING_DOWNLOAD forever (2026-08-10). Name the cause instead.
  let tokenOk: boolean;
  try {
    tokenOk = verifyProxyToken(id, pos, token, exp);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[tiktok/img] CONFIG ERROR — cannot verify proxy token:", message);
    return NextResponse.json(
      { error: "Image proxy is misconfigured on the server.", detail: message },
      { status: 500 },
    );
  }
  // Every pull is logged — a photo_pull_failed with no line here means
  // TikTok's fetch never reached us (wrong host, firewall, redirect); one with
  // a non-200 here says exactly what it got instead (2026-09-10).
  const startedAt = Date.now();
  const ua = request.headers.get("user-agent") ?? "";
  const pull = (status: number, note: string) =>
    console.log("[tiktok/img] pull", {
      id,
      pos,
      status,
      note,
      ms: Date.now() - startedAt,
      ua: ua.slice(0, 80),
    });

  if (!tokenOk) {
    pull(401, "bad or expired token");
    return NextResponse.json({ error: "Invalid or expired token." }, { status: 401 });
  }

  const posNum = parseInt(pos, 10);
  if (!Number.isInteger(posNum) || posNum < 0) {
    return NextResponse.json({ error: "Invalid position." }, { status: 400 });
  }

  // Admin client: TikTok pulls this unauthenticated, so RLS can't scope it.
  const result = await renderSlideJpeg(createAdminClient(), id, posNum);
  if (!result.ok) {
    if (result.status >= 500) {
      console.error("[tiktok/img] render failed", { id, pos: posNum, error: result.error });
    }
    pull(result.status, result.error);
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  pull(200, `jpeg ${Math.round(result.jpeg.byteLength / 1024)}KB`);
  return new Response(new Uint8Array(result.jpeg), {
    status: 200,
    headers: {
      "Content-Type": "image/jpeg",
      "Cache-Control": "private, max-age=7200",
      "Content-Length": String(result.jpeg.byteLength),
    },
  });
}
