import Link from "next/link";
import { notFound } from "next/navigation";
import { createAdminClient } from "@/utils/supabase/admin";
import { getCachedUser } from "@/utils/supabase/server";
import { isAdminEmail } from "@/lib/admins";
import { listUsers, type SortKey } from "@/lib/admin/users";
import { estimateCost, usd } from "@/lib/admin/cost";
import { PlanBadge, Metric, CostRow, relative, SORTS, PER_PAGE } from "./ui";

// Founder-only. Reads across every user with the service-role client, so the
// email check below is the entire security boundary — it must stay a SERVER
// check against the authenticated session, never a prop or a query param.
//
// notFound() rather than redirect(): a non-admin who guesses the URL learns
// nothing about whether the route exists.
export const dynamic = "force-dynamic";

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ sort?: string; page?: string; q?: string }>;
}) {
  const user = await getCachedUser();
  if (!isAdminEmail(user?.email)) notFound();

  const sp = await searchParams;
  const sort = (SORTS.some((s) => s.key === sp.sort) ? sp.sort : "created") as SortKey;
  const page = Math.max(1, Number(sp.page) || 1);
  const query = sp.q ?? "";

  const admin = createAdminClient();
  const [{ users, total, unnamed, summary }, cost] = await Promise.all([
    listUsers(admin, { sort, page, perPage: PER_PAGE, query }),
    estimateCost(admin),
  ]);
  const pages = Math.max(1, Math.ceil(total / PER_PAGE));
  const link = (patch: Record<string, string | number>) => {
    const p = new URLSearchParams();
    if (query) p.set("q", query);
    p.set("sort", sort);
    p.set("page", String(page));
    for (const [k, v] of Object.entries(patch)) p.set(k, String(v));
    return `/dashboard/admin?${p.toString()}`;
  };

  return (
    <div className="mx-auto w-full max-w-6xl px-5 py-8 sm:px-8">
      <h1 className="font-tiktok text-2xl font-extrabold tracking-tight text-white">
        Customers
      </h1>
      <p className="mt-1 text-sm text-white/40">
        Accounts that told us who they are. Unnamed signups are listed below.
      </p>

      {/* The six numbers worth knowing at a glance. */}
      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Metric label="Users" value={summary.totalUsers} />
        <Metric label="Paying" value={summary.payingUsers} accent />
        <Metric label="MRR" value={`$${summary.mrr}`} accent />
        <Metric label="Active 7d" value={summary.activeLast7} />
        <Metric label="Never generated" value={summary.neverGenerated} muted />
        <Metric label="Slideshows" value={summary.slideshowsTotal} />
      </div>

      {/* Spend. An estimate, and it says so — we don't meter tokens per
          request, so this is unit prices x counts. */}
      <div className="mt-3 rounded-2xl border border-white/[0.08] px-4 py-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <span className="text-sm font-semibold text-white">
            Estimated cost to date
          </span>
          <span className="font-tiktok text-2xl font-extrabold tracking-tight text-white">
            {usd(cost.total)}
          </span>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1.5 text-[13px] sm:grid-cols-3">
          <CostRow label={`Copy · ${cost.decks} decks`} value={cost.copy} />
          <CostRow label={`Stock images · ${cost.slides} slides`} value={cost.stockImages} />
          <CostRow label={`Upload images · ${cost.uploadDecks} decks`} value={cost.uploadImages} />
          <CostRow label={`Supercharge · ${cost.superchargedDecks} decks`} value={cost.supercharge} />
          <CostRow label={`AI photo swaps · ${cost.swaps}`} value={cost.imageSwaps} />
          <CostRow label="Trends cron · monthly" value={cost.trends} />
        </div>
        <p className="mt-3 text-[11px] leading-snug text-white/30">
          Excludes Let AI decide, Sharpen, Remix and reference analyses — those
          happen outside deck creation and nothing records them per user.
          {cost.untracked > 0 &&
            ` ${cost.untracked} deck${cost.untracked === 1 ? "" : "s"} predate cost tracking and are priced as plain stock, so the real figure is a little higher.`}
        </p>
      </div>

      {/* Search + sort */}
      <div className="mt-6 flex flex-wrap items-center gap-2">
        <form action="/dashboard/admin" className="flex-1 sm:max-w-xs">
          <input type="hidden" name="sort" value={sort} />
          <input
            name="q"
            defaultValue={query}
            placeholder="Search email or business…"
            aria-label="Search customers"
            className="w-full rounded-full bg-white/[0.04] px-4 py-2 text-sm text-white placeholder:text-white/25 focus:outline-none focus:ring-1 focus:ring-white/15"
          />
        </form>
        <div className="flex flex-wrap gap-1.5">
          {SORTS.map((s) => (
            <Link
              key={s.key}
              href={link({ sort: s.key, page: 1 })}
              className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                sort === s.key
                  ? "bg-white text-black"
                  : "bg-white/[0.04] text-white/50 hover:text-white"
              }`}
            >
              {s.label}
            </Link>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="mt-4 overflow-x-auto rounded-2xl border border-white/[0.08]">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead>
            <tr className="border-b border-white/[0.08] text-[11px] uppercase tracking-wide text-white/35">
              <th className="px-4 py-3 font-medium">Customer</th>
              <th className="px-4 py-3 font-medium">Plan</th>
              <th className="px-4 py-3 font-medium text-right">Slideshows</th>
              <th className="px-4 py-3 font-medium text-right">Posted</th>
              <th className="px-4 py-3 font-medium text-right">Credits</th>
              <th className="px-4 py-3 font-medium">Last active</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr
                key={u.id}
                className="border-b border-white/[0.04] transition-colors last:border-0 hover:bg-white/[0.03]"
              >
                <td className="px-4 py-3">
                  <Link href={`/dashboard/admin/${u.id}`} className="block">
                    <span className="block truncate font-medium text-white">
                      {u.email ?? "—"}
                    </span>
                    <span className="block truncate text-xs text-white/35">
                      {u.businessName}
                      {u.tiktokConnected ? " · TikTok connected" : ""}
                    </span>
                  </Link>
                </td>
                <td className="px-4 py-3">
                  <PlanBadge plan={u.plan} status={u.subscriptionStatus} />
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-white">
                  {u.slideshowsTotal}
                  <span className="ml-1 text-xs text-white/30">
                    {u.quota == null ? "" : `${u.usedThisPeriod}/${u.quota}`}
                  </span>
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-white/70">
                  {u.postsTotal || "—"}
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-white/70">
                  {u.credits || "—"}
                </td>
                <td className="px-4 py-3 text-white/45">
                  {relative(u.lastGeneratedAt)}
                </td>
              </tr>
            ))}
            {users.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-white/35">
                  No customers match that search.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {unnamed.length > 0 && (
        <>
          <h2 className="mt-10 text-sm font-semibold uppercase tracking-wide text-white/35">
            Unnamed signups ({unnamed.length})
          </h2>
          <p className="mt-1 text-xs text-white/30">
            No business name — never finished onboarding. Newest first.
          </p>
          <div className="mt-3 overflow-hidden rounded-2xl border border-white/[0.08]">
            {unnamed.map((u) => (
              <Link
                key={u.id}
                href={`/dashboard/admin/${u.id}`}
                className="flex items-center gap-3 border-b border-white/[0.04] px-4 py-2.5 text-sm transition-colors last:border-0 hover:bg-white/[0.03]"
              >
                <span className="min-w-0 flex-1 truncate text-white/70">
                  {u.email ?? "no email on file"}
                </span>
                <span className="tabular-nums text-white/45">
                  {u.slideshowsTotal} deck{u.slideshowsTotal === 1 ? "" : "s"}
                </span>
                <span className="w-20 text-right text-white/30">
                  {relative(u.createdAt)}
                </span>
              </Link>
            ))}
          </div>
        </>
      )}

      {pages > 1 && (
        <div className="mt-4 flex items-center justify-between text-sm">
          <span className="text-white/35">
            {total} customers · page {page} of {pages}
          </span>
          <div className="flex gap-2">
            {page > 1 && (
              <Link
                href={link({ page: page - 1 })}
                className="rounded-full bg-white/[0.06] px-4 py-1.5 text-white/70 transition-colors hover:text-white"
              >
                Previous
              </Link>
            )}
            {page < pages && (
              <Link
                href={link({ page: page + 1 })}
                className="rounded-full bg-white/[0.06] px-4 py-1.5 text-white/70 transition-colors hover:text-white"
              >
                Next
              </Link>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
