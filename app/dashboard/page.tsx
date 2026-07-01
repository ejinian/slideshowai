import { createClient } from "@/utils/supabase/server";
import { Generator } from "@/components/dashboard/Generator";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let isConnected = false;
  if (user) {
    const { data } = await supabase
      .from("tiktok_connections")
      .select("id")
      .eq("user_id", user.id)
      .maybeSingle();
    isConnected = !!data;
  }

  return (
    <div className="dashboard-bolt-stage flex flex-1 flex-col items-center justify-center px-5 pb-20 pt-10">
      <div className="dashboard-bolt-glow" aria-hidden />
      <div className="dashboard-bolt-arc-mask" aria-hidden />
      <div className="dashboard-bolt-arc-rim" aria-hidden />
      <div className="dashboard-bolt-content w-full max-w-3xl">
        <Generator isConnected={isConnected} isLoggedIn={!!user} />
      </div>

      {/* Dev-only: replay the first-run onboarding wizard. Not shown in prod.
          Bottom-right so it doesn't collide with the Next.js dev indicator. */}
      {process.env.NODE_ENV === "development" && (
        <a
          href="/onboarding?debug=1"
          className="fixed bottom-4 right-4 z-50 rounded-full border border-accent/40 bg-accent/15 px-3.5 py-2 text-xs font-semibold text-white shadow-lg shadow-black/40 backdrop-blur transition-colors hover:bg-accent/25"
        >
          View onboarding
        </a>
      )}
    </div>
  );
}
