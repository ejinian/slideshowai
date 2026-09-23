import { NextResponse } from "next/server";
import { createAdminClient } from "@/utils/supabase/admin";
import { requireAdmin } from "@/lib/admin/gate";
import { AutopilotError, loadPlan, savePlan, type PlanPatch } from "@/lib/autopilot/run";

// Admin-only: read / save the caller's autopilot plan. Ownership of the chosen
// TikTok connection and collection is checked here so a stray id can't point
// the plan at someone else's account or photos.
export const runtime = "nodejs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET() {
  const gate = await requireAdmin();
  if (gate.response) return gate.response;
  try {
    const plan = await loadPlan(createAdminClient(), gate.user.id);
    return NextResponse.json({ plan });
  } catch (e) {
    return fail(e);
  }
}

export async function PUT(request: Request) {
  const gate = await requireAdmin();
  if (gate.response) return gate.response;
  const admin = createAdminClient();
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const patch: PlanPatch = {};

  if ("enabled" in body) patch.enabled = body.enabled === true;
  if ("topics" in body) {
    patch.topics = Array.isArray(body.topics) ? (body.topics as unknown[]).map(String) : [];
  }
  if ("slide_count" in body) patch.slide_count = Number(body.slide_count);
  if ("max_pending" in body) patch.max_pending = Number(body.max_pending);
  if ("privacy_level" in body) patch.privacy_level = String(body.privacy_level) as PlanPatch["privacy_level"];

  if ("connection_id" in body) {
    const id = body.connection_id;
    if (id === null || id === "") patch.connection_id = null;
    else if (typeof id === "string" && UUID_RE.test(id)) {
      const { data } = await admin
        .from("tiktok_connections")
        .select("id")
        .eq("id", id)
        .eq("user_id", gate.user.id)
        .limit(1)
        .maybeSingle();
      if (!data) return NextResponse.json({ error: "That TikTok account isn't yours." }, { status: 400 });
      patch.connection_id = id;
    } else return NextResponse.json({ error: "Bad connection id." }, { status: 400 });
  }
  if ("collection_id" in body) {
    const id = body.collection_id;
    if (id === null || id === "") patch.collection_id = null;
    else if (typeof id === "string" && UUID_RE.test(id)) {
      const { data } = await admin
        .from("collections")
        .select("id")
        .eq("id", id)
        .eq("user_id", gate.user.id)
        .maybeSingle();
      if (!data) return NextResponse.json({ error: "That collection isn't yours." }, { status: 400 });
      patch.collection_id = id;
    } else return NextResponse.json({ error: "Bad collection id." }, { status: 400 });
  }

  try {
    const plan = await savePlan(admin, gate.user.id, patch);
    return NextResponse.json({ plan });
  } catch (e) {
    return fail(e);
  }
}

function fail(e: unknown): Response {
  if (e instanceof AutopilotError) return NextResponse.json({ error: e.message }, { status: e.status });
  return NextResponse.json({ error: e instanceof Error ? e.message : "Failed." }, { status: 500 });
}
