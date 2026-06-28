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
  const businessName =
    (user?.user_metadata?.business_name as string | undefined)?.trim() || null;

  return (
    <div className="bg-hero-glow flex min-h-screen flex-col">
      <TopNav businessName={businessName} email={user?.email ?? null} />
      <main className="flex flex-1 flex-col">{children}</main>
    </div>
  );
}
