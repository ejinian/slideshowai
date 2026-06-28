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
    <div className="flex flex-1 flex-col items-center justify-center px-5 pb-20 pt-10">
      <div className="w-full max-w-2xl">
        <Generator isConnected={isConnected} isLoggedIn={!!user} />
      </div>
    </div>
  );
}
