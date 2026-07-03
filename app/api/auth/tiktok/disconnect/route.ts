import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

// Disconnects the signed-in user's TikTok account: best-effort revokes the token
// with TikTok, then deletes the connection row (RLS scopes it to the owner).
export const runtime = "nodejs";

export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: conn } = await supabase
    .from("tiktok_connections")
    .select("access_token")
    .eq("user_id", user.id)
    .single();

  const clientKey = process.env.TIKTOK_CLIENT_KEY;
  const clientSecret = process.env.TIKTOK_CLIENT_SECRET;
  if (conn?.access_token && clientKey && clientSecret) {
    try {
      await fetch("https://open.tiktokapis.com/v2/oauth/revoke/", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_key: clientKey,
          client_secret: clientSecret,
          token: conn.access_token,
        }),
      });
    } catch {
      // Revocation is best-effort — we still remove the local connection below.
    }
  }

  const { error } = await supabase
    .from("tiktok_connections")
    .delete()
    .eq("user_id", user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
