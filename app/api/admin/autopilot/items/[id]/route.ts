import { NextResponse } from "next/server";
import { createAdminClient } from "@/utils/supabase/admin";
import { requireAdmin } from "@/lib/admin/gate";
import {
  AutopilotError,
  approveItem,
  getItem,
  loadPlan,
  rejectItem,
  reviewItem,
  selfOrigin,
} from "@/lib/autopilot/run";

// Admin-only: act on one of the caller's autopilot items.
//   review  → write the post description + run the vision gate (→ needs_review)
//   approve → post it to TikTok now with the plan's account + visibility
//   reject  → park it
export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin();
  if (gate.response) return gate.response;
  const { id } = await ctx.params;
  const admin = createAdminClient();
  const body = (await request.json().catch(() => ({}))) as { action?: unknown };
  const action = typeof body.action === "string" ? body.action : "";
  try {
    const item = await getItem(admin, id, gate.user.id);
    if (!item) return NextResponse.json({ error: "Not found." }, { status: 404 });
    if (action === "review") {
      return NextResponse.json({ item: await reviewItem(admin, item, selfOrigin(request)) });
    }
    if (action === "approve") {
      const plan = await loadPlan(admin, gate.user.id);
      if (!plan) return NextResponse.json({ error: "No plan." }, { status: 400 });
      const out = await approveItem(admin, item, plan);
      return NextResponse.json({ item: out.item, postId: out.postId });
    }
    if (action === "reject") {
      await rejectItem(admin, item);
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  } catch (e) {
    if (e instanceof AutopilotError) return NextResponse.json({ error: e.message }, { status: e.status });
    return NextResponse.json({ error: e instanceof Error ? e.message : "Failed." }, { status: 500 });
  }
}
