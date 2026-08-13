import Link from "next/link";
import { notFound } from "next/navigation";
import { createAdminClient } from "@/utils/supabase/admin";
import { getCachedUser } from "@/utils/supabase/server";
import { isAdminEmail } from "@/lib/admins";
import { getUser } from "@/lib/admin/users";
import { PlanBadge, Metric, relative } from "../ui";

// One customer. Same security boundary as the list: the email check IS the gate,
// because everything below reads with the service-role client.
export const dynamic = "force-dynamic";

const POST_STATUS: Record<string, { label: string; cls: string }> = {
  PUBLISH_COMPLETE: { label: "Posted", cls: "bg-emerald-500/15 text-emerald-300" },
  PROCESSING_DOWNLOAD: { label: "Processing", cls: "bg-amber-500/15 text-amber-300" },
  FAILED: { label: "Failed", cls: "bg-red-500/15 text-red-300" },
};

export default async function AdminUserPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const me = await getCachedUser();
  if (!isAdminEmail(me?.email)) notFound();

  const { id } = await params;
  const u = await getUser(createAdminClient(), id);
  if (!u) notFound();

  return (
    <div className="mx-auto w-full max-w-5xl px-5 py-8 sm:px-8">
      <Link
        href="/dashboard/admin"
        className="text-sm text-white/40 transition-colors hover:text-white"
      >
        ← Customers
      </Link>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <h1 className="font-tiktok text-2xl font-extrabold tracking-tight text-white">
          {u.email ?? "Unknown"}
        </h1>
        <PlanBadge plan={u.plan} status={u.subscriptionStatus} />
      </div>
      <p className="mt-1 text-sm text-white/40">
        {u.businessName ?? "No business name"} · joined{" "}
        {new Date(u.createdAt).toLocaleDateString()} · last active{" "}
        {relative(u.lastGeneratedAt)}
      </p>

      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Metric label="Slideshows" value={u.slideshowsTotal} />
        <Metric label="Posted to TikTok" value={u.postsTotal} />
        <Metric
          label="Used this period"
          value={u.quota == null ? String(u.usedThisPeriod) : `${u.usedThisPeriod}/${u.quota}`}
        />
        <Metric label="Credits" value={u.credits} />
      </div>

      {!u.tiktokConnected && (
        <p className="mt-4 rounded-xl bg-amber-500/[0.07] px-4 py-3 text-sm text-amber-200/70">
          No TikTok account connected — they can generate but never publish.
        </p>
      )}

      <h2 className="mt-8 text-sm font-semibold uppercase tracking-wide text-white/35">
        Slideshows
      </h2>
      <div className="mt-3 overflow-hidden rounded-2xl border border-white/[0.08]">
        {u.slideshows.map((s) => {
          const meta = s.postStatus ? POST_STATUS[s.postStatus] : null;
          return (
            <Link
              key={s.id}
              href={`/dashboard/slideshows/${s.id}`}
              className="flex items-center gap-3 border-b border-white/[0.04] px-4 py-3 transition-colors last:border-0 hover:bg-white/[0.03]"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm text-white">
                  {s.title ?? "Untitled"}
                </span>
                <span className="block text-xs text-white/35">
                  {s.slideCount ?? "?"} slides ·{" "}
                  {new Date(s.createdAt).toLocaleDateString()}
                </span>
              </span>
              {meta && (
                <span
                  className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${meta.cls}`}
                >
                  {meta.label}
                </span>
              )}
            </Link>
          );
        })}
        {u.slideshows.length === 0 && (
          <p className="px-4 py-10 text-center text-sm text-white/35">
            Signed up but never generated a slideshow.
          </p>
        )}
      </div>
    </div>
  );
}
