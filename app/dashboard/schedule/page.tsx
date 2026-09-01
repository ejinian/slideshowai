import { ScheduleView, type ScheduleAccount } from "@/components/dashboard/grow/ScheduleView";
import { createClient, getCachedUser } from "@/utils/supabase/server";
import { listConnections } from "@/utils/tiktok";

export const metadata = { title: "Schedule — SlideLabsAI" };
export const dynamic = "force-dynamic";

export default async function SchedulePage() {
  const supabase = await createClient();
  const user = await getCachedUser();

  let accounts: ScheduleAccount[] = [];
  let scheduled: unknown[] = [];
  let slideshows: unknown[] = [];
  if (user) {
    const [conns, posts, shows] = await Promise.all([
      listConnections(supabase, user.id),
      supabase
        .from("scheduled_posts")
        .select("id, slideshow_id, caption, scheduled_at, status, fail_reason, posted_at, connection_id")
        .order("scheduled_at", { ascending: true }),
      supabase
        .from("slideshows")
        .select("id, title, created_at")
        .eq("status", "saved")
        .order("created_at", { ascending: false })
        .limit(24),
    ]);
    accounts = conns.map((c) => ({
      id: c.id,
      openId: c.open_id,
      displayName: c.display_name ?? null,
      username: c.username ?? null,
      avatarUrl: c.avatar_url ?? null,
      isDefault: !!c.is_default,
    }));
    scheduled = posts.data ?? [];
    slideshows = shows.data ?? [];
  }

  return (
    <div className="mx-auto w-full max-w-7xl flex-1 px-5 py-8 sm:px-8">
      <header>
        <h1 className="text-2xl font-bold tracking-tight text-white">Schedule</h1>
        <p className="mt-1 text-sm text-white/40">
          Queue your slideshows and let the week post itself.
        </p>
      </header>
      <div className="mt-6">
        <ScheduleView
          accounts={accounts}
          initialPosts={scheduled as never}
          slideshows={slideshows as never}
        />
      </div>
    </div>
  );
}
