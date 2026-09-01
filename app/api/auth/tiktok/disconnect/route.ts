import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { listConnections, tiktokClientKey, tiktokClientSecret } from "@/utils/tiktok";

// Disconnects a TikTok account: best-effort revokes the token with TikTok,
// then deletes the connection row (RLS scopes it to the owner).
//
// Multi-account: an optional JSON body { connectionId } disconnects just that
// account; when it was the default, another connected account is promoted so
// default-account callers (analytics, legacy paths) keep working. No body (or
// an empty one) disconnects EVERYTHING — the shape the pre-multi-account UI
// still sends.
export const runtime = "nodejs";

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let connectionId: string | undefined;
  try {
    const body = (await request.json()) as { connectionId?: string };
    connectionId = body.connectionId || undefined;
  } catch {
    // no body — disconnect all, the legacy shape
  }

  const rows = await listConnections(supabase, user.id);
  const targets = connectionId ? rows.filter((r) => r.id === connectionId) : rows;
  if (connectionId && targets.length === 0) {
    return NextResponse.json({ error: "That account is not connected." }, { status: 404 });
  }

  for (const conn of targets) {
    if (!conn.access_token) continue;
    try {
      await fetch("https://open.tiktokapis.com/v2/oauth/revoke/", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_key: tiktokClientKey(),
          client_secret: tiktokClientSecret(),
          token: conn.access_token,
        }),
      });
    } catch {
      // Best-effort, including when the credentials are missing or mangled —
      // the accessors throw and we still remove the local connection below.
      // Disconnect must never be the thing that a broken env var blocks.
    }
  }

  let del = supabase.from("tiktok_connections").delete().eq("user_id", user.id);
  if (connectionId) del = del.eq("id", connectionId);
  const { error } = await del;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Keep the one-default invariant when the default account was removed.
  if (connectionId && targets[0]?.is_default) {
    const remaining = rows.filter((r) => r.id !== connectionId);
    if (remaining.length > 0) {
      await supabase
        .from("tiktok_connections")
        .update({ is_default: true })
        .eq("id", remaining[0].id);
    }
  }

  return NextResponse.json({ ok: true, remaining: rows.length - targets.length });
}
