import { redirect } from "next/navigation";
import { TopNav } from "@/components/dashboard/TopNav";
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

  return (
    <div className="relative flex min-h-screen flex-col bg-black">
      <div className="relative z-10 flex flex-1 flex-col">
        <TopNav businessName={businessName} email={user?.email ?? null} />
        <main className="flex flex-1 flex-col">{children}</main>
      </div>
    </div>
  );
}
