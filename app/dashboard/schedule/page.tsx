import { ScheduleView } from "@/components/dashboard/grow/ScheduleView";
import { createClient, getCachedUser } from "@/utils/supabase/server";

export const metadata = { title: "Schedule — SlideLabsAI" };
export const dynamic = "force-dynamic";

export default async function SchedulePage() {
  const supabase = await createClient();
  const user = await getCachedUser();

  let connected = false;
  let scheduled: unknown[] = [];
  let slideshows: unknown[] = [];
  if (user) {
    const [conn, posts, shows] = await Promise.all([
      supabase.from("tiktok_connections").select("user_id").eq("user_id", user.id).maybeSingle(),
      supabase
        .from("scheduled_posts")
        .select("id, slideshow_id, caption, scheduled_at, status, fail_reason, posted_at")
        .order("scheduled_at", { ascending: true }),
      supabase
        .from("slideshows")
        .select("id, title, created_at")
        .eq("status", "saved")
        .order("created_at", { ascending: false })
        .limit(24),
    ]);
    connected = !!conn.data;
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
          connected={connected}
          initialPosts={scheduled as never}
          slideshows={slideshows as never}
        />
      </div>
    </div>
  );
}
