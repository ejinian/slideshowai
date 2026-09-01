import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { getValidToken, listConnections } from "@/utils/tiktok";

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { publish_id?: string };
  try {
    body = (await request.json()) as { publish_id?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  if (!body.publish_id) {
    return NextResponse.json({ error: "publish_id is required." }, { status: 400 });
  }

  // A publish_id belongs to the ACCOUNT that made the post — status/fetch with
  // another account's token 404s. Look up which account this post went to and
  // use its connection; the default covers drafts (no post row) and legacy rows.
  let connectionId: string | undefined;
  const { data: post } = await supabase
    .from("tiktok_posts")
    .select("*")
    .eq("publish_id", body.publish_id)
    .limit(1)
    .maybeSingle();
  const postOpenId = (post as { open_id?: string | null } | null)?.open_id;
  if (postOpenId) {
    const conns = await listConnections(supabase, user.id);
    connectionId = conns.find((c) => c.open_id === postOpenId)?.id;
  }

  let accessToken: string;
  try {
    accessToken = await getValidToken(supabase, user.id, connectionId);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Auth error." },
      { status: 401 },
    );
  }

  const res = await fetch(
    "https://open.tiktokapis.com/v2/post/publish/status/fetch/",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=UTF-8",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ publish_id: body.publish_id }),
    },
  );

  // Deliberately loose: TikTok returns fields here that aren't in our narrow
  // type (downloaded_bytes, error_code, per-image detail), and those are exactly
  // what distinguishes "we fetched your images and rejected them" from "we never
  // fetched at all". The raw body is logged below rather than parsed — a shape
  // we haven't seen is the whole point.
  const data = await res.json() as {
    data?: { status?: string; fail_reason?: string } & Record<string, unknown>;
    error?: { code?: string; message?: string };
  };

  if (!res.ok) {
    return NextResponse.json(
      { error: data.error?.message ?? "Status check failed." },
      { status: 502 },
    );
  }

  const status = data.data?.status ?? "PROCESSING_DOWNLOAD";
  const failReason = data.data?.fail_reason ?? null;

  // Only on a terminal outcome — polling runs every couple of seconds and this
  // would otherwise bury the log. FAILED is where the diagnosis lives: it is the
  // only place TikTok ever explains itself.
  if (failReason || (status !== "PROCESSING_DOWNLOAD" && status !== "PROCESSING_UPLOAD")) {
    console.log("[tiktok/status] terminal", {
      publishId: body.publish_id,
      status,
      failReason,
      raw: JSON.stringify(data),
    });
  }

  // Keep the persisted post row in sync so "My Posts" reflects the real outcome.
  // RLS scopes the update to the owner's row for this publish_id.
  await supabase
    .from("tiktok_posts")
    .update({ status, fail_reason: failReason })
    .eq("publish_id", body.publish_id);

  return NextResponse.json({ status, failReason });
}
