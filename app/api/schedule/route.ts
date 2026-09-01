import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { resolveConnection } from "@/utils/tiktok";

export const runtime = "nodejs";

// Scheduled posts CRUD (owner-scoped via RLS). Publishing happens in
// /api/cron/publish-scheduled.

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data, error } = await supabase
    .from("scheduled_posts")
    .select("id, slideshow_id, caption, scheduled_at, status, fail_reason, posted_at, connection_id")
    .order("scheduled_at", { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ posts: data ?? [] });
}

interface CreateBody {
  slideshowId?: string;
  scheduledAt?: string; // ISO
  caption?: string;
  /** Which connected account to publish from (multi-account). Default when unset. */
  connectionId?: string;
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: CreateBody;
  try {
    body = (await request.json()) as CreateBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const scheduledMs = Date.parse(body.scheduledAt ?? "");
  if (!body.slideshowId || !Number.isFinite(scheduledMs)) {
    return NextResponse.json(
      { error: "slideshowId and a valid scheduledAt are required." },
      { status: 400 },
    );
  }
  if (scheduledMs < Date.now() - 60_000) {
    return NextResponse.json({ error: "That time is in the past." }, { status: 400 });
  }

  // Must own the slideshow (RLS scopes the select) and have TikTok connected —
  // otherwise the queue would silently fail at publish time.
  const { data: show } = await supabase
    .from("slideshows")
    .select("id")
    .eq("id", body.slideshowId)
    .maybeSingle();
  if (!show) return NextResponse.json({ error: "Slideshow not found." }, { status: 404 });

  // Validates the connection exists — and, with an explicit connectionId, that
  // it belongs to this user (a bogus id must 400 now, not fail in the cron).
  let connectionId: string | null = null;
  try {
    const conn = await resolveConnection(supabase, user.id, body.connectionId);
    connectionId = body.connectionId ? conn.id : null; // null = default at publish time
  } catch {
    return NextResponse.json(
      { error: "Connect your TikTok account first." },
      { status: 400 },
    );
  }

  const baseRow = {
    user_id: user.id,
    slideshow_id: body.slideshowId,
    caption: (body.caption ?? "").slice(0, 2200),
    scheduled_at: new Date(scheduledMs).toISOString(),
  };
  const cols = "id, slideshow_id, caption, scheduled_at, status, fail_reason, posted_at, connection_id";
  const insertRow: Record<string, unknown> = { ...baseRow };
  if (connectionId) insertRow.connection_id = connectionId;
  let { data: row, error } = await supabase
    .from("scheduled_posts")
    .insert(insertRow)
    .select(cols)
    .single();
  if (error && connectionId) {
    // connection_id column predates migration 20260831140000 — queue on the
    // default account rather than failing the schedule.
    ({ data: row, error } = await supabase
      .from("scheduled_posts")
      .insert(baseRow)
      .select(cols)
      .single());
  }
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ post: row });
}
