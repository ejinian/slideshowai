import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { isAdminEmail } from "@/lib/admins";
import { slideProxyUrl } from "@/utils/tiktok";

// Admin-only. Makes the EXACT request TikTok makes when it pulls a slide, from
// the server, and reports what came back.
//
// `photo_pull_failed` is all TikTok ever says: it pulled and didn't get usable
// JPEGs, with no indication whether the URL 404'd, 401'd, timed out, rendered
// wrong, or was never reachable. Nobody outside the server can reproduce the
// request either, because the proxy URL is signed with TIKTOK_CLIENT_SECRET —
// so the one machine that can sign a valid token is the one that must test it.
//
// Signs with the same helper publish.ts uses, against the same
// NEXT_PUBLIC_APP_URL, so a pass here means TikTok's fetch would also pass.
export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!isAdminEmail(user?.email)) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const { searchParams } = new URL(request.url);
  const slideshowId = searchParams.get("slideshowId");
  if (!slideshowId) {
    return NextResponse.json({ error: "slideshowId is required." }, { status: 400 });
  }
  const positions = (searchParams.get("pos") ?? "0")
    .split(",")
    .map((p) => parseInt(p, 10))
    .filter((p) => Number.isInteger(p) && p >= 0)
    .slice(0, 10);

  // publish.ts reads this same variable and fails the post outright without it.
  // A trailing slash here yields `//api/...`, which is a different path.
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (!appUrl) {
    return NextResponse.json({ error: "NEXT_PUBLIC_APP_URL is not configured." }, { status: 500 });
  }

  const results = [];
  for (const pos of positions) {
    const url = slideProxyUrl(appUrl, slideshowId, pos);
    // Redacted for the response — the token is a live credential for 2 hours.
    const shown = url.replace(/token=[^&]+/, "token=<redacted>");
    const startedAt = Date.now();
    try {
      const res = await fetch(url, { cache: "no-store" });
      const contentType = res.headers.get("content-type") ?? null;
      const buf = Buffer.from(await res.arrayBuffer());
      const isJpeg = buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
      results.push({
        pos,
        url: shown,
        ok: res.ok && isJpeg,
        status: res.status,
        contentType,
        bytes: buf.length,
        ms: Date.now() - startedAt,
        // JPEG magic bytes, not the header — TikTok decodes the body, so a JPEG
        // content-type over an HTML error page still fails the pull.
        looksLikeJpeg: isJpeg,
        ...(isJpeg ? {} : { body: buf.toString("utf8").slice(0, 400) }),
      });
    } catch (e) {
      results.push({
        pos,
        url: shown,
        ok: false,
        ms: Date.now() - startedAt,
        fetchError: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return NextResponse.json({
    appUrl,
    trailingSlash: appUrl.endsWith("/"),
    slideshowId,
    allOk: results.every((r) => r.ok),
    results,
  });
}
