import { redirect } from "next/navigation";
import { TopNav } from "@/components/dashboard/TopNav";
import { Sidebar } from "@/components/dashboard/Sidebar";
import { PLANS, isPlanId, type PlanId } from "@/lib/billing/plans";
import { createClient } from "@/utils/supabase/server";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // No guest access — the dashboard is sign-in only. Anyone without a session
  // is sent to sign up (existing users can switch to Log in from there).
  if (!user) {
    redirect("/signup?return_to=/dashboard");
  }

  // First-time users run the onboarding wizard once before reaching the app.
  // Covers every entry (email or Google signup) since it guards the dashboard
  // itself, not just the signup redirect.
  if (!user.user_metadata?.onboarded) {
    redirect("/onboarding");
  }

  const businessName =
    (user.user_metadata?.business_name as string | undefined)?.trim() || null;

  // Billing lives on profiles (owner-read RLS). Drives the sidebar plan card +
  // billing modal (plan, monthly usage, credits).
  const { data: profile } = await supabase
    .from("profiles")
    .select("plan, plan_quota, slideshows_used, credits, period_end")
    .eq("id", user.id)
    .maybeSingle();

  const planRaw = (profile?.plan as string | undefined) ?? "free";
  const plan: PlanId = isPlanId(planRaw) ? planRaw : "free";
  const quota =
    profile?.plan_quota === null || profile?.plan_quota === undefined
      ? PLANS[plan].quota
      : (profile.plan_quota as number);
  // Display-only monthly reset: if the period elapsed, show 0 used (the real
  // reset happens in the generate route's loadBilling on next generation).
  const periodEnd = profile?.period_end as string | null | undefined;
  const elapsed = !periodEnd || Date.now() > Date.parse(periodEnd);
  const usage = {
    plan,
    quota,
    used: elapsed ? 0 : ((profile?.slideshows_used as number | undefined) ?? 0),
    credits: (profile?.credits as number | undefined) ?? 0,
  };

  return (
    <div className="relative flex min-h-screen bg-black">
      {/* desktop app shell — hidden below lg, where TopNav takes over */}
      <Sidebar businessName={businessName} email={user?.email ?? null} usage={usage} />
      <div className="relative z-10 flex min-w-0 flex-1 flex-col">
        <TopNav businessName={businessName} email={user?.email ?? null} />
        <main className="flex flex-1 flex-col">{children}</main>
      </div>
    </div>
  );
}
