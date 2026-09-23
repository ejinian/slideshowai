import { NextResponse } from "next/server";
import { createAdminClient } from "@/utils/supabase/admin";
import { autoTick, loadPlanRows, selfOrigin } from "@/lib/autopilot/run";

// Autopilot's clock. Hit by cron-job.org (Vercel Hobby crons are daily-only
// and vercel.json must not change) with CRON_SECRET, like publish-scheduled.
// Every enabled plan gets a tick, least recently touched first, and the call
// stops after the first plan that did any work so it always fits the budget;
// a plan with nothing to do is skipped in the same pass. Automatic plans post
// from inside the tick (autoTick in lib/autopilot/run.ts); assisted ones only
// generate and review. Run it hourly — the tick itself paces posts per day.
export const runtime = "nodejs";
export const maxDuration = 120;

async function handle(request: Request) {
  const secret = process.env.CRON_SECRET;
  const url = new URL(request.url);
  const provided =
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ||
    url.searchParams.get("secret") ||
    "";
  if (!secret || provided !== secret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const origin = selfOrigin();
  let plans;
  try {
    plans = await loadPlanRows(admin, { enabledOnly: true });
  } catch (e) {
    return NextResponse.json(
      {
        error: `autopilot_plans not readable (${e instanceof Error ? e.message : String(e)}). Run the 20260923120000 + 20260923130000 migrations.`,
      },
      { status: 500 },
    );
  }

  for (const plan of plans) {
    const actions = await autoTick(admin, plan, origin);
    if (actions.length > 0) {
      // Touch it so the next tick serves another plan first.
      await admin.from("autopilot_plans").update({ updated_at: new Date().toISOString() }).eq("id", plan.id);
      return NextResponse.json({ plan: plan.id, actions });
    }
  }
  return NextResponse.json({ action: "idle", plans: plans.length });
}

export async function POST(request: Request) {
  return handle(request);
}
export async function GET(request: Request) {
  return handle(request);
}
