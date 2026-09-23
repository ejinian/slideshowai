import { NextResponse } from "next/server";
import { createAdminClient } from "@/utils/supabase/admin";
import {
  generateItem,
  listItems,
  reviewItem,
  selfOrigin,
  type AutopilotItem,
  type AutopilotPlan,
} from "@/lib/autopilot/run";

// Autopilot's clock. Hit by cron-job.org (Vercel Hobby crons are daily-only
// and vercel.json must not change) with CRON_SECRET, like publish-scheduled.
// One action per call, so it always fits the budget: first any deck that was
// generated but never reviewed, else one new deck for the first enabled plan
// that has room (fewer than max_pending awaiting review) and topics left.
// It never posts — that stays a human's Approve.
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
  const { data: plans, error } = await admin
    .from("autopilot_plans")
    .select("*")
    .eq("enabled", true)
    .order("updated_at", { ascending: true });
  if (error) {
    return NextResponse.json(
      { error: `autopilot_plans not readable (${error.message}). Run the 20260923120000 migration.` },
      { status: 500 },
    );
  }

  for (const raw of (plans ?? []) as Record<string, unknown>[]) {
    const plan: AutopilotPlan = {
      id: String(raw.id),
      user_id: String(raw.user_id),
      enabled: true,
      connection_id: (raw.connection_id as string | null) ?? null,
      collection_id: (raw.collection_id as string | null) ?? null,
      topics: Array.isArray(raw.topics) ? (raw.topics as unknown[]).map(String) : [],
      next_topic_index: Number(raw.next_topic_index) || 0,
      slide_count: Number(raw.slide_count) || 5,
      privacy_level: (raw.privacy_level as AutopilotPlan["privacy_level"]) ?? "SELF_ONLY",
      max_pending: Number(raw.max_pending) || 2,
    };
    const items = await listItems(admin, plan.id, 50);
    const unreviewed = items.find((i: AutopilotItem) => i.status === "generated");
    if (unreviewed) {
      const item = await reviewItem(admin, unreviewed, origin);
      return NextResponse.json({ action: "reviewed", plan: plan.id, item: item.id, verdict: item.review?.verdict });
    }
    const pending = items.filter((i) => i.status === "needs_review").length;
    if (pending >= plan.max_pending) continue;
    if (plan.topics.filter((t) => t.trim()).length === 0) continue;
    const generated = await generateItem(admin, plan, origin);
    // Review in the same call when there is time left; otherwise the next
    // tick picks the `generated` item up first.
    const reviewed = await reviewItem(admin, generated, origin).catch(() => null);
    return NextResponse.json({
      action: reviewed ? "generated+reviewed" : "generated",
      plan: plan.id,
      item: generated.id,
      verdict: reviewed?.review?.verdict ?? null,
    });
  }
  return NextResponse.json({ action: "idle", plans: plans?.length ?? 0 });
}

export async function POST(request: Request) {
  return handle(request);
}
export async function GET(request: Request) {
  return handle(request);
}
