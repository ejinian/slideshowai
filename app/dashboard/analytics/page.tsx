import { createClient, getCachedUser } from "@/utils/supabase/server";
import { AnalyticsView } from "@/components/dashboard/grow/AnalyticsView";
import { loadAnalytics } from "@/lib/analytics/summary";
import { loadAccountSummary } from "@/lib/analytics/accountStats";

export const metadata = { title: "Analytics — SlideLabsAI" };
// Numbers change as soon as something is posted; never serve a cached page.
export const dynamic = "force-dynamic";

export default async function AnalyticsPage() {
  const supabase = await createClient();
  const user = await getCachedUser();
  // Internal rows and the TikTok call are independent — run them together so
  // the page isn't the sum of both waits.
  const [data, account] = user
    ? await Promise.all([
        loadAnalytics(supabase, user.id),
        loadAccountSummary(supabase, user.id),
      ])
    : [
        { stats: [], activity: [], rows: [], connected: false },
        { status: "disconnected" as const, stats: null, trend: [], stale: false },
      ];

  return (
    <div className="mx-auto w-full max-w-7xl flex-1 px-5 py-8 sm:px-8">
      <header>
        <h1 className="text-2xl font-bold tracking-tight text-white">Analytics</h1>
        <p className="mt-1 text-sm text-white/40">
          What you&apos;ve posted, and whether it landed.
        </p>
      </header>
      <div className="mt-6">
        <AnalyticsView data={data} account={account} />
      </div>
    </div>
  );
}
