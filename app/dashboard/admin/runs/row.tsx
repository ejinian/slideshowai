import Link from "next/link";
import type { RunSummary } from "@/lib/admin/runs";

// One run in a list. Shared by the feed and the per-customer page so a run
// reads the same everywhere.

export const STATUS: Record<string, { label: string; cls: string }> = {
  ok: { label: "OK", cls: "bg-emerald-500/15 text-emerald-300" },
  failed: { label: "Failed", cls: "bg-red-500/15 text-red-300" },
  rejected: { label: "Rejected", cls: "bg-amber-500/15 text-amber-300" },
};

export function StatusBadge({ status }: { status: string }) {
  const s = STATUS[status] ?? { label: status, cls: "bg-white/10 text-white/60" };
  return (
    <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${s.cls}`}>{s.label}</span>
  );
}

export function seconds(ms: number | null): string {
  return ms == null ? "—" : `${(ms / 1000).toFixed(1)}s`;
}

export function RunRow({
  run,
  when,
  showUser,
}: {
  run: RunSummary;
  when: string;
  showUser?: boolean;
}) {
  const title = run.hook ?? run.prompt ?? "(no prompt)";
  const meta = [
    run.copyPath,
    run.kind && !run.kind.includes(":") ? run.kind : null,
    run.env !== "production" ? run.env : null,
  ].filter(Boolean);
  return (
    <Link
      href={`/dashboard/admin/runs/${run.id}`}
      className="flex items-start gap-4 border-b border-white/[0.05] px-5 py-3.5 transition-colors last:border-b-0 hover:bg-white/[0.03]"
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={run.status} />
          <span className="truncate text-sm text-white">{title}</span>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-white/40">
          {showUser && <span className="text-white/60">{run.email ?? run.userId?.slice(0, 8) ?? "anon"}</span>}
          {meta.map((m) => (
            <span key={m as string}>{m}</span>
          ))}
          {run.hook && run.prompt && (
            <span className="truncate">“{run.prompt}”</span>
          )}
          {run.status !== "ok" && (
            <span className="text-red-300/80">
              {run.failedAt ? `at ${run.failedAt} — ` : ""}
              {run.errorMessage ?? run.errorCode ?? "unknown error"}
            </span>
          )}
          {run.anomalies.length > 0 && (
            <span className="text-amber-300/80">
              {run.anomalies.length} anomal{run.anomalies.length === 1 ? "y" : "ies"}
            </span>
          )}
        </div>
      </div>
      <div className="shrink-0 text-right text-xs text-white/40">
        <div>{when}</div>
        <div>{seconds(run.durationMs)}</div>
      </div>
    </Link>
  );
}
