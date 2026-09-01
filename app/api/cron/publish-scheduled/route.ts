import { NextResponse } from "next/server";
import { createAdminClient } from "@/utils/supabase/admin";
import { resolveConnection } from "@/utils/tiktok";
import { publishSlideshowToTikTok, type PrivacyLevel } from "@/lib/tiktok/publish";

// Publishes due scheduled posts. Fired every ~10 minutes by the GitHub
// Actions pinger (.github/workflows/pinger.yml) — Vercel Hobby crons are
// once-daily only. Protected by CRON_SECRET, same convention as the other
// crons. Batch is capped well under TikTok's 6-inits-per-minute limit.
export const runtime = "nodejs";
export const maxDuration = 120;

const BATCH = 5;

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
  // select("*"): the row shape must survive the multi-account migration
  // (connection_id) not having run yet — naming it would 500 the whole cron.
  const { data: due, error } = await admin
    .from("scheduled_posts")
    .select("*")
    .eq("status", "queued")
    .lte("scheduled_at", new Date().toISOString())
    .order("scheduled_at", { ascending: true })
    .limit(BATCH);
  if (error) {
    return NextResponse.json(
      { error: `scheduled_posts not readable (${error.message}). Run the 20260708130000 migration.` },
      { status: 500 },
    );
  }

  const results: { id: string; status: string; detail?: string }[] = [];
  for (const row of due ?? []) {
    // Optimistic claim: only proceed if we flipped it from queued ourselves,
    // so overlapping pinger runs can't double-post.
    const { data: claimed } = await admin
      .from("scheduled_posts")
      .update({ status: "publishing" })
      .eq("id", row.id)
      .eq("status", "queued")
      .select("id");
    if (!claimed?.length) continue;

    // Multi-account: honor the account chosen at schedule time. A connection
    // that has since been disconnected throws here → the post fails with a
    // clear reason instead of silently landing on a different account's feed.
    const chosenConnection = (row as { connection_id?: string | null }).connection_id ?? undefined;
    let openId: string | null = null;
    try {
      const conn = await resolveConnection(admin, row.user_id, chosenConnection);
      openId = conn.open_id;
    } catch (e) {
      const reason = e instanceof Error ? e.message : "TikTok account not connected.";
      await admin
        .from("scheduled_posts")
        .update({ status: "failed", fail_reason: reason.slice(0, 500) })
        .eq("id", row.id);
      results.push({ id: row.id, status: "failed", detail: reason });
      continue;
    }

    const outcome = await publishSlideshowToTikTok(admin, row.user_id, {
      slideshowId: row.slideshow_id,
      caption: row.caption,
      privacyLevel: (row.privacy_level as PrivacyLevel) ?? "SELF_ONLY",
      autoAddMusic: row.auto_add_music ?? true,
      postMode: "DIRECT_POST",
      connectionId: chosenConnection,
    });

    if (outcome.ok) {
      const postRow = {
        user_id: row.user_id,
        slideshow_id: row.slideshow_id,
        publish_id: outcome.publishId,
        caption: row.caption,
        privacy_level: row.privacy_level ?? "SELF_ONLY",
        cover_index: outcome.coverIndex,
        status: "PROCESSING_DOWNLOAD",
      };
      const { error: insErr } = await admin
        .from("tiktok_posts")
        .insert({ ...postRow, open_id: openId });
      // open_id column predates the migration — record the post anyway.
      if (insErr) await admin.from("tiktok_posts").insert(postRow);
      await admin
        .from("scheduled_posts")
        .update({
          status: "posted",
          publish_id: outcome.publishId,
          posted_at: new Date().toISOString(),
        })
        .eq("id", row.id);
      results.push({ id: row.id, status: "posted" });
    } else {
      await admin
        .from("scheduled_posts")
        .update({ status: "failed", fail_reason: outcome.error.slice(0, 500) })
        .eq("id", row.id);
      results.push({ id: row.id, status: "failed", detail: outcome.error });
    }
  }

  return NextResponse.json({ due: due?.length ?? 0, results });
}

export async function POST(request: Request) {
  return handle(request);
}
export async function GET(request: Request) {
  return handle(request);
}
