import { NextResponse } from "next/server";
import { createAdminClient } from "@/utils/supabase/admin";
import { requireAdmin } from "@/lib/admin/gate";
import { AutopilotError, generateItem, loadPlan, selfOrigin } from "@/lib/autopilot/run";

// Admin-only: generate ONE deck for the caller's plan (the next topic, or a
// given one for Regenerate). Returns the item in `generated`; the client then
// calls items/[id] with action "review". Split on purpose — generation alone
// runs 30-90s and the review another 10-20s, and each call must fit the
// function budget the generate route already proves (120s).
export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(request: Request) {
  const gate = await requireAdmin();
  if (gate.response) return gate.response;
  const admin = createAdminClient();
  const body = (await request.json().catch(() => ({}))) as { topic?: unknown };
  const topic = typeof body.topic === "string" ? body.topic.slice(0, 300) : undefined;
  try {
    const plan = await loadPlan(admin, gate.user.id);
    if (!plan) return NextResponse.json({ error: "Save a plan first." }, { status: 400 });
    const item = await generateItem(admin, plan, selfOrigin(request), topic);
    return NextResponse.json({ item });
  } catch (e) {
    if (e instanceof AutopilotError) return NextResponse.json({ error: e.message }, { status: e.status });
    return NextResponse.json({ error: e instanceof Error ? e.message : "Failed." }, { status: 500 });
  }
}
