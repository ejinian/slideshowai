import { TrendsView } from "@/components/dashboard/grow/TrendsView";
import {
  getInspirationFeed,
  getTrendingFeed,
  trendNicheForOnboarding,
} from "@/lib/trends";
import { getCachedUser } from "@/utils/supabase/server";

export const metadata = { title: "Trends — SlideLabsAI" };
export const dynamic = "force-dynamic";

export default async function TrendsPage() {
  const user = await getCachedUser();
  const defaultNiche = trendNicheForOnboarding(
    user?.user_metadata?.niche as string | undefined,
  );
  // Live chart + the 12-month hall of fame (the All-time tab) in parallel.
  const [feed, inspirationFeed] = await Promise.all([
    getTrendingFeed(),
    getInspirationFeed(),
  ]);
  return (
    <div className="mx-auto w-full max-w-7xl flex-1 px-5 py-8 sm:px-8">
      <header>
        <h1 className="text-2xl font-bold tracking-tight text-white">Trends</h1>
        <p className="mt-1 text-sm text-white/40">
          The hottest slideshows in your niches, ranked by how fast
          they&apos;re climbing — catch the format on the way up.
        </p>
      </header>
      <div className="mt-6">
        <TrendsView
          initialFeed={feed}
          inspirationFeed={inspirationFeed}
          defaultNiche={defaultNiche}
        />
      </div>
    </div>
  );
}
