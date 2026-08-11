import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { isAdminEmail } from "@/lib/admins";
import { tiktokRedirectUri } from "@/utils/tiktok";

// Admin-only. What the PRODUCTION runtime actually holds for TikTok.
//
// TikTok answers every credential problem with one word on a generic error page
// — "client_key" covers a wrong key, a key with a stray newline, and a secret
// pasted into the key field alike — so three deploys were spent guessing at a
// value nobody could see. This reports the SHAPE of what the server read, which
// is enough to tell those apart without anyone reading a secret out of Vercel.
//
// Open it in a browser while signed in as an admin. Non-admins get a 404, not a
// 403, so its existence isn't advertised to anyone probing.
export const runtime = "nodejs";

// The client key is public by design — it travels in the authorize URL the
// user's own browser visits — so a prefix is safe to echo and is what identifies
// which app (and whether it's a sandbox `sbaw…` key) is configured. The secret
// gets a length and nothing else.
function describe(name: string, prefixChars: number) {
  const raw = process.env[name];
  if (raw === undefined) return { present: false, note: "variable is not set in this environment" };
  const value = raw.trim();
  return {
    present: value.length > 0,
    length: value.length,
    ...(prefixChars > 0 ? { prefix: value.slice(0, prefixChars) } : {}),
    // Vercel stores a pasted newline and shows no sign of it. It's trimmed at
    // every read now, but knowing it was there explains a past failure.
    hadSurroundingWhitespace: raw !== value,
    hasInteriorWhitespace: /\s/.test(value),
  };
}

export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!isAdminEmail(user?.email)) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  return NextResponse.json({
    clientKey: describe("TIKTOK_CLIENT_KEY", 6),
    clientSecret: describe("TIKTOK_CLIENT_SECRET", 0),
    // Derived from THIS request's origin, so it is byte-for-byte what the
    // authorize call sends. It must appear in the app's Login Kit redirect list.
    redirectUri: tiktokRedirectUri(request),
    // Requesting a scope the app doesn't hold is rejected before the consent
    // screen, and looks like a broken login rather than a scope problem.
    scope: "video.publish,video.upload,user.info.basic",
    appUrl: process.env.NEXT_PUBLIC_APP_URL ?? null,
    vercelEnv: process.env.VERCEL_ENV ?? "local",
  });
}
