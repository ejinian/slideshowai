import { AccountsView, type AccountCardData } from "@/components/dashboard/accounts/AccountsView";
import { createClient, getCachedUser } from "@/utils/supabase/server";
import { listConnections } from "@/utils/tiktok";
import { isAdminEmail } from "@/lib/admins";
import { isPlanId, tiktokAccountLimit, type PlanId } from "@/lib/billing/plans";

export const metadata = { title: "Accounts — SlideLabsAI" };
export const dynamic = "force-dynamic";

// The full account manager (the Schedule page keeps its compact chip strip).
// Per-account numbers come from our own tables — no TikTok calls on render.
export default async function AccountsPage() {
  const supabase = await createClient();
  const user = await getCachedUser();

  let accounts: AccountCardData[] = [];
  let limit = 1;
  if (user) {
    const [conns, postsRes, schedRes, profileRes] = await Promise.all([
      listConnections(supabase, user.id),
      supabase
        .from("tiktok_posts")
        .select("open_id, status, created_at")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(500),
      supabase
        .from("scheduled_posts")
        .select("connection_id")
        .eq("user_id", user.id)
        .eq("status", "queued"),
      supabase.from("profiles").select("plan").eq("id", user.id).maybeSingle(),
    ]);

    const planRaw = (profileRes.data?.plan as string | undefined) ?? "free";
    const plan: PlanId = isPlanId(planRaw) ? planRaw : "free";
    limit = tiktokAccountLimit(plan, isAdminEmail(user.email));

    const posts = (postsRes.data ?? []) as {
      open_id: string | null;
      status: string;
      created_at: string;
    }[];
    const queued = (schedRes.data ?? []) as { connection_id: string | null }[];

    accounts = conns.map((c) => {
      const mine = posts.filter((p) => p.open_id === c.open_id);
      const published = mine.filter((p) => p.status === "PUBLISH_COMPLETE");
      return {
        id: c.id,
        openId: c.open_id,
        displayName: c.display_name ?? null,
        username: c.username ?? null,
        avatarUrl: c.avatar_url ?? null,
        isDefault: !!c.is_default,
        connectedAt: (c as { created_at?: string }).created_at ?? null,
        postsPublished: published.length,
        lastPostedAt: published[0]?.created_at ?? null,
        // Queued posts pinned to this account, plus — on the default — the
        // unpinned ones, since that's where they'll publish.
        queued:
          queued.filter((q) => q.connection_id === c.id).length +
          (c.is_default ? queued.filter((q) => q.connection_id == null).length : 0),
      };
    });
  }

  return (
    <div className="mx-auto w-full max-w-7xl flex-1 px-5 py-8 sm:px-8">
      <header>
        <h1 className="text-2xl font-bold tracking-tight text-white">Accounts</h1>
        <p className="mt-1 text-sm text-white/40">
          The TikTok accounts you post to, and which one is the default.
        </p>
      </header>
      <div className="mt-6">
        <AccountsView accounts={accounts} limit={limit} />
      </div>
    </div>
  );
}
