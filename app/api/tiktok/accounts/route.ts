import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { listConnections } from "@/utils/tiktok";

export const runtime = "nodejs";

// The connected TikTok accounts, for the post modal's account picker.
// Identity fields are the ones cached at connect time — no TikTok call here,
// this renders a picker, and creator-info fetches live data for the SELECTED
// account anyway.
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const rows = await listConnections(supabase, user.id);
  return NextResponse.json({
    accounts: rows.map((r) => ({
      id: r.id,
      openId: r.open_id,
      displayName: r.display_name ?? null,
      username: r.username ?? null,
      avatarUrl: r.avatar_url ?? null,
      isDefault: !!r.is_default,
    })),
  });
}

// Set the default account: { connectionId }. Clear-then-set, in that order —
// the partial unique index allows at most one is_default row per user, so
// setting the new one first would violate it.
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let connectionId = "";
  try {
    connectionId = ((await request.json()) as { connectionId?: string }).connectionId ?? "";
  } catch {
    // fall through to the check below
  }
  const rows = await listConnections(supabase, user.id);
  if (!rows.some((r) => r.id === connectionId)) {
    return NextResponse.json({ error: "That account is not connected." }, { status: 404 });
  }

  await supabase
    .from("tiktok_connections")
    .update({ is_default: false })
    .eq("user_id", user.id)
    .eq("is_default", true);
  const { error } = await supabase
    .from("tiktok_connections")
    .update({ is_default: true })
    .eq("id", connectionId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
