import { InspirationLibrary } from "@/components/dashboard/grow/InspirationLibrary";
import { getInspirationFeed, trendNicheForOnboarding } from "@/lib/trends";
import { createClient } from "@/utils/supabase/server";

export const metadata = { title: "Inspiration — SlideShowAI" };
export const dynamic = "force-dynamic";

export default async function InspirationPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const defaultNiche = trendNicheForOnboarding(
    user?.user_metadata?.niche as string | undefined,
  );
  const feed = await getInspirationFeed();

  return (
    <div className="mx-auto w-full max-w-7xl flex-1 px-5 py-8 sm:px-8">
      <header>
        <h1 className="text-2xl font-bold tracking-tight text-white">
          Inspiration
        </h1>
        <p className="mt-1 text-sm text-white/40">
          The most viral slideshows of the past year, by niche — steal the
          structure, make it yours.
        </p>
      </header>
      <div className="mt-6">
        <InspirationLibrary feed={feed} defaultNiche={defaultNiche} />
      </div>
    </div>
  );
}
