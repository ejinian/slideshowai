import { readFileSync } from "node:fs";
import path from "node:path";
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

  if (!verifyProxyToken(id, pos, token, exp)) {
    return NextResponse.json({ error: "Invalid or expired token." }, { status: 401 });
  }

  // TEMP diagnostic: reports deployed commit + whether the Inter TTF is present
  // in this function's bundle on Vercel. Remove after debugging the tofu glyphs.
  if (searchParams.get("debug") === "1") {
    const info: Record<string, unknown> = {
      commit: process.env.VERCEL_GIT_COMMIT_SHA ?? "unknown",
      cwd: process.cwd(),
    };
    try {
      const p = path.join(process.cwd(), "assets", "fonts", "Inter-700.ttf");
      const b = readFileSync(p);
      info.fontPath = p;
      info.fontBytes = b.length;
      info.fontMagic = b.subarray(0, 4).toString("hex");
    } catch (e) {
      info.fontError = e instanceof Error ? e.message : String(e);
    }
    return NextResponse.json(info);
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
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return new Response(new Uint8Array(result.jpeg), {
    status: 200,
    headers: {
      "Content-Type": "image/jpeg",
      "Cache-Control": "private, max-age=7200",
      "Content-Length": String(result.jpeg.byteLength),
    },
  });
}
