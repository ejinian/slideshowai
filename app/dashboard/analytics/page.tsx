import { createClient, getCachedUser } from "@/utils/supabase/server";
import { AnalyticsView } from "@/components/dashboard/grow/AnalyticsView";
import { loadAnalytics } from "@/lib/analytics/summary";

export const metadata = { title: "Analytics — SlideLabsAI" };
// Numbers change as soon as something is posted; never serve a cached page.
export const dynamic = "force-dynamic";

export default async function AnalyticsPage() {
  const supabase = await createClient();
  const user = await getCachedUser();
  const data = user
    ? await loadAnalytics(supabase, user.id)
    : { stats: [], activity: [], rows: [], connected: false };

  return (
    <div className="mx-auto w-full max-w-7xl flex-1 px-5 py-8 sm:px-8">
      <header>
        <h1 className="text-2xl font-bold tracking-tight text-white">Analytics</h1>
        <p className="mt-1 text-sm text-white/40">
          What you&apos;ve posted, and whether it landed.
        </p>
      </header>
      <div className="mt-6">
        <AnalyticsView data={data} />
      </div>
    </div>
  );
}
