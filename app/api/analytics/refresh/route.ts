import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { refreshOfficialStats, statsEnabled } from "@/lib/analytics/officialStats";

export const runtime = "nodejs";

// Fired by AnalyticsView when the newest snapshot is over an hour old. The
// hour gate is enforced HERE, against the snapshot row — the client asking
// again costs nothing, and a fresh snapshot answers instantly.
//
// Unpriced on purpose: two read-only TikTok API calls at most hourly is not
// inference — charging credits for it punishes users (billing doctrine).
const SNAPSHOT_INTERVAL_MS = 60 * 60 * 1000;

export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Answer the flag before touching the DB — while the scope revision is
  // pending this is every visitor's path, and it should cost nothing.
  if (!statsEnabled()) return NextResponse.json({ refreshed: false, reason: "not_enabled" });

  const { data: newest } = await supabase
    .from("account_snapshots")
    .select("captured_at")
    .eq("user_id", user.id)
    .order("captured_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (
    newest &&
    Date.now() - new Date(newest.captured_at).getTime() < SNAPSHOT_INTERVAL_MS
  ) {
    return NextResponse.json({ refreshed: false, fresh: true });
  }

  const result = await refreshOfficialStats(supabase, user.id);
  if (!result.ok) {
    // 200, not an error status: a failed refresh leaves the page on its last
    // stored numbers, which is a degraded success, not a request failure.
    return NextResponse.json({ refreshed: false, reason: result.reason });
  }
  return NextResponse.json({ refreshed: true, matched: result.matched });
}
