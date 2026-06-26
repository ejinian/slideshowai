import Link from "next/link";
import { Logo } from "@/components/landing/Logo";
import { Sidebar } from "@/components/dashboard/Sidebar";
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
    <div className="flex h-screen overflow-hidden">
      <Sidebar businessName={businessName} email={user?.email ?? null} />

      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Mobile top bar (sidebar is hidden below lg) */}
        <header className="flex h-14 items-center justify-between border-b border-border bg-surface px-4 lg:hidden">
          <Logo href="/dashboard" />
          <Link
            href="/dashboard"
            className="rounded-full bg-accent px-4 py-1.5 text-sm font-semibold text-accent-foreground"
          >
            + Create
          </Link>
        </header>

        <main className="flex-1 overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}
