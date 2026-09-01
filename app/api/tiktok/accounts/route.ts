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
