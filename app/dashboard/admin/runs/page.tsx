import Link from "next/link";
import { notFound } from "next/navigation";
import { createAdminClient } from "@/utils/supabase/admin";
import { getCachedUser } from "@/utils/supabase/server";
import { isAdminEmail } from "@/lib/admins";
import { listRuns, type RunStatus } from "@/lib/admin/runs";
import { relative } from "../ui";
import { RunRow } from "./row";

// The feed: every generation run, newest first, with the failures on top when
// you ask. This is the page to keep open on a client's first day. Same
// security boundary as the rest of admin: the email check IS the gate.
export const dynamic = "force-dynamic";

const STATUSES: { key: RunStatus | "problems" | "all"; label: string }[] = [
  { key: "all", label: "All" },
  { key: "problems", label: "Problems" },
  { key: "failed", label: "Failed" },
  { key: "rejected", label: "Rejected" },
  { key: "ok", label: "OK" },
];
const ENVS = ["all", "production", "preview", "development"];

export default async function AdminRunsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; env?: string }>;
}) {
  const me = await getCachedUser();
  if (!isAdminEmail(me?.email)) notFound();

  const sp = await searchParams;
  const status = (STATUSES.find((s) => s.key === sp.status)?.key ?? "all") as
    | RunStatus
    | "problems"
    | "all";
  const env = ENVS.includes(sp.env ?? "") ? (sp.env as string) : "all";
  const runs = await listRuns(createAdminClient(), { status, env, limit: 150 });
  const link = (next: { status?: string; env?: string }) => {
    const q = new URLSearchParams();
    const s = next.status ?? status;
    const e = next.env ?? env;
    if (s !== "all") q.set("status", s);
    if (e !== "all") q.set("env", e);
    const qs = q.toString();
    return `/dashboard/admin/runs${qs ? `?${qs}` : ""}`;
  };

  const problems = runs.filter((r) => r.status !== "ok").length;

  return (
    <div className="mx-auto w-full max-w-6xl px-5 py-8 sm:px-8">
      <Link
        href="/dashboard/admin"
        className="text-sm text-white/40 transition-colors hover:text-white"
      >
        ← Customers
      </Link>
      <div className="mt-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-tiktok text-2xl font-extrabold tracking-tight text-white">
            Generation runs
          </h1>
          <p className="mt-1 text-sm text-white/40">
            {runs.length} shown · {problems} problem{problems === 1 ? "" : "s"} · newest first
          </p>
        </div>
        <Link
          href={`/dashboard/admin/diagnostics${status !== "all" ? `?status=${status}` : ""}`}
          className="text-sm text-white/50 transition-colors hover:text-white"
        >
          Readable view →
        </Link>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-2">
        {STATUSES.map((s) => (
          <Link
            key={s.key}
            href={link({ status: s.key })}
            className={`rounded-full px-3 py-1 text-xs transition-colors ${
              s.key === status
                ? "bg-white text-black"
                : "bg-white/[0.06] text-white/60 hover:bg-white/[0.1] hover:text-white"
            }`}
          >
            {s.label}
          </Link>
        ))}
        <span className="mx-1 h-4 w-px bg-white/10" />
        {ENVS.map((e) => (
          <Link
            key={e}
            href={link({ env: e })}
            className={`rounded-full px-3 py-1 text-xs transition-colors ${
              e === env
                ? "bg-white text-black"
                : "bg-white/[0.06] text-white/60 hover:bg-white/[0.1] hover:text-white"
            }`}
          >
            {e}
          </Link>
        ))}
      </div>

      {runs.length === 0 ? (
        <div className="mt-8 rounded-2xl bg-white/[0.02] p-8 text-center text-sm text-white/40">
          No runs recorded yet. Rows appear once migration{" "}
          <code className="text-white/60">20260914120000_generation_runs.sql</code> has run and a
          generation completes.
        </div>
      ) : (
        <div className="mt-5 overflow-hidden rounded-2xl bg-white/[0.02]">
          {runs.map((r) => (
            <RunRow key={r.id} run={r} when={relative(r.createdAt)} showUser />
          ))}
        </div>
      )}
    </div>
  );
}
