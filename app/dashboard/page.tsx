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
    <div className="relative flex flex-1 flex-col items-center justify-center overflow-hidden px-5 pb-20 pt-10">
      {/* Planetary arc — no border, rim gradient at top only, black interior */}
      <div
        className="pointer-events-none absolute"
        style={{
          width: "220vw",
          height: "110vw",
          bottom: "-95vw",
          left: "50%",
          transform: "translateX(-50%)",
          borderRadius: "50%",
          background: [
            "radial-gradient(ellipse 100% 2% at 50% 0%, rgba(199, 210, 254, 0.80) 0%, rgba(165, 180, 252, 0.12) 55%, transparent 100%)",
            "#000",
          ].join(", "),
          boxShadow: [
            "0 0 22px 3px rgba(165, 180, 252, 0.30)",
            "0 -80px 180px 30px rgba(99, 102, 241, 0.18)",
            "0 -200px 380px 80px rgba(79, 70, 229, 0.10)",
          ].join(", "),
          zIndex: 1,
        }}
        aria-hidden
      />
      <div className="relative z-20 w-full max-w-3xl">
        <Generator isConnected={isConnected} isLoggedIn={!!user} />
      </div>
    </div>
  );
}
