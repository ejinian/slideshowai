import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { createAdminClient } from "@/utils/supabase/admin";
import { isAdminEmail } from "@/lib/admins";
import {
  spendCredits,
  refundCredits,
  claimRateWindow,
  guardUnavailable,
} from "@/lib/billing/usage";
import {
  resolveReference,
  analyzeReference,
  ReferenceError,
} from "@/lib/reference/tiktok";

// "Make one like this" — read a pasted TikTok photo post and distill its FORMAT
// into the blueprint /api/generate already accepts (the remix channel). A
// READER, like /api/product: the generation pipeline is untouched.
//
// PRICED: 1 credit, charged HERE — this is where the real cost lives (image
// downloads + a vision call), and charging server-side at the point of work
// means no client flag to trust at generate time. Refunded on any failure: an
// unreadable post is our problem, not the user's. Admins bypass, as everywhere.
export const runtime = "nodejs";
export const maxDuration = 120;

/** Analyses per user per 5 min. Vision + third-party fetches — worth guarding. */
const WINDOW_SECS = 5 * 60;
const MAX_HITS = 10;

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { url } = (await request.json().catch(() => ({}))) as { url?: string };
  if (typeof url !== "string" || !url.trim()) {
    return NextResponse.json({ error: "Add a TikTok link first." }, { status: 400 });
  }

  const admin = createAdminClient();
  const isAdmin = isAdminEmail(user.email);

  if (!isAdmin) {
    const win = await claimRateWindow(admin, user.id, MAX_HITS, WINDOW_SECS);
    if (!win.ok) {
      if (win.reason === "error") return guardUnavailable(win.detail);
      return NextResponse.json(
        { error: "Slow down a moment and try again." },
        { status: 429 },
      );
    }
  }

  // Charge before the work (reserve → run → refund, same shape as generate).
  let reservation = null as Awaited<ReturnType<typeof spendCredits>> | null;
  if (!isAdmin) {
    const spend = await spendCredits(admin, user.id, 1);
    if (!spend.ok) {
      if (spend.reason === "error") return guardUnavailable(spend.detail);
      return NextResponse.json(
        {
          error:
            "Analyzing a reference costs 1 credit and you're out. Upgrade your plan or add credits.",
          code: "quota_exceeded",
        },
        { status: 402 },
      );
    }
    reservation = spend;
  }
  const refund = async () => {
    if (reservation?.ok) {
      await refundCredits(admin, user.id, reservation.value).catch(() => {});
      reservation = null;
    }
  };

  try {
    const resolved = await resolveReference(url.trim());
    const analysis = await analyzeReference(resolved);
    return NextResponse.json({ reference: analysis });
  } catch (e) {
    // Every failure refunds — the user got nothing.
    await refund();
    if (e instanceof ReferenceError) {
      const status =
        e.code === "not_tiktok" || e.code === "not_photo_post" ? 400 : 502;
      return NextResponse.json({ error: e.message, code: e.code }, { status });
    }
    console.error("[reference] unexpected:", e);
    return NextResponse.json(
      { error: "Couldn't read that TikTok post right now.", code: "unreachable" },
      { status: 502 },
    );
  }
}
