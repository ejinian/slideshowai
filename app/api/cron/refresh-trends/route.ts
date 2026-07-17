import { NextResponse } from "next/server";
import { collectTrendRows, ingestTrends } from "@/lib/trends";

// Refreshes the trending_posts cache from the Apify TikTok scraper.
// Protected by CRON_SECRET (same convention as cleanup-drafts).
// ?dry=1 runs the scrape + mapping WITHOUT touching the database — used to
// validate the pipeline before the trending_posts migration is applied.
export const runtime = "nodejs";
export const maxDuration = 300;

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

  try {
    if (url.searchParams.get("dry") === "1") {
      const { rows, stats } = await collectTrendRows();
      return NextResponse.json({
        dry: true,
        ...stats,
        perNiche: rows.reduce<Record<string, number>>((acc, r) => {
          acc[r.niche] = (acc[r.niche] ?? 0) + 1;
          return acc;
        }, {}),
        recent7d: rows.filter(
          (r) => Date.parse(r.posted_at) > Date.now() - 7 * 86_400_000,
        ).length,
        // raw is bulky — drop it from the preview (undefined is omitted in JSON)
        sample: rows.slice(0, 3).map((row) => ({ ...row, raw: undefined })),
      });
    }

    // ?mode=profiles -> watchlist-only stat sweep (no clockworks search):
    // flat-rate cheap, so it can run every few hours to keep "Best today"
    // full and the Rising climb rates fresh.
    const result = await ingestTrends({
      searchless: url.searchParams.get("mode") === "profiles",
    });
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Trends refresh failed." },
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
