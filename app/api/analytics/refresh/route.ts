import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { refreshViaScrape } from "@/lib/analytics/scrape";

export const runtime = "nodejs";
// Two synchronous ScrapTik runs at 60s apiece, plus headroom.
export const maxDuration = 150;

// Fired by AnalyticsView when the newest snapshot is over an hour old. The
// hour gate is enforced HERE, against the snapshot row — the client asking
// again costs nothing, and a fresh snapshot answers instantly.
//
// Unpriced on purpose: ~$0.004 of ScrapTik per refresh, at most hourly, is
// platform cost like the trends cron — charging credits for non-inference
// punishes users (see the billing doctrine in CLAUDE.md).
const SNAPSHOT_INTERVAL_MS = 60 * 60 * 1000;

export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

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

  const result = await refreshViaScrape(supabase, user.id);
  if (!result.ok) {
    // 200, not an error status: a failed refresh leaves the page on its last
    // stored numbers, which is a degraded success, not a request failure.
    return NextResponse.json({ refreshed: false, reason: result.reason });
  }
  return NextResponse.json({
    refreshed: true,
    privateAccount: result.privateAccount,
    matched: result.matched,
  });
}
