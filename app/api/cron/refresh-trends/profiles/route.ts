import { NextResponse } from "next/server";
import { ingestTrends } from "@/lib/trends";

// Watchlist-only stat sweep — equivalent to /api/cron/refresh-trends
// ?mode=profiles, but on its own path because Vercel cron `path` entries
// can't carry query strings. Flat-rate cheap (no clockworks search), so it
// runs several times a day to keep "Best today" and climb rates fresh.
export const runtime = "nodejs";
export const maxDuration = 300;

async function handle(request: Request) {
  const secret = process.env.CRON_SECRET;
  const provided =
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ||
    new URL(request.url).searchParams.get("secret") ||
    "";
  if (!secret || provided !== secret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await ingestTrends({ searchless: true });
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Trends sweep failed." },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  return handle(request);
}
export async function GET(request: Request) {
  return handle(request);
}
