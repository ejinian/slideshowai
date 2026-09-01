import { createClient, getCachedUser } from "@/utils/supabase/server";
import { Generator } from "@/components/dashboard/Generator";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const supabase = await createClient();
  const user = await getCachedUser();

  let isConnected = false;
  if (user) {
    const { data } = await supabase
      .from("tiktok_connections")
      .select("id")
      .eq("user_id", user.id)
      // limit(1): a maybeSingle over multiple connections (multi-account) errors.
      .limit(1)
      .maybeSingle();
    isConnected = !!data;
  }

  return (
    // The horizon's height is set here, not in globals.css: a @media block
    // containing only a custom property gets optimized away in this build, so
    // the phone value silently won at every width. Phones get a low horizon so
    // the composer sits above it instead of being sliced in half by the rim.
    // The stage is vertically centred, so the rise has to clear the composer at
    // its TALLEST — card plus the expanded sharper-angles panel plus the source
    // switch — not just at rest.
    <div className="dashboard-bolt-stage flex flex-1 flex-col items-center justify-center px-5 pb-20 pt-10 [--arc-rise:clamp(60px,9vh,100px)] sm:[--arc-rise:clamp(360px,40vh,520px)]">
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
