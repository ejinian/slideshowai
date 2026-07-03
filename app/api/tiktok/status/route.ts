import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { getValidToken } from "@/utils/tiktok";

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

  let accessToken: string;
  try {
    accessToken = await getValidToken(supabase, user.id);
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

  const data = await res.json() as {
    data?: { status?: string; fail_reason?: string };
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

  // Keep the persisted post row in sync so "My Posts" reflects the real outcome.
  // RLS scopes the update to the owner's row for this publish_id.
  await supabase
    .from("tiktok_posts")
    .update({ status, fail_reason: failReason })
    .eq("publish_id", body.publish_id);

  return NextResponse.json({ status, failReason });
}
