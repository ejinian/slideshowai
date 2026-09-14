import Link from "next/link";
import { notFound } from "next/navigation";
import { createAdminClient } from "@/utils/supabase/admin";
import { getCachedUser } from "@/utils/supabase/server";
import { isAdminEmail } from "@/lib/admins";
import { getRun } from "@/lib/admin/runs";
import { Metric } from "../../ui";
import { StatusBadge, seconds } from "../row";

// One run, everything we know: the request, the deck it produced, every
// stage's payload under the name it has in a local diagnostics folder, and —
// when it failed — where and why. Read top to bottom the same way you'd read
// 00_SUMMARY.md then the numbered files.
export const dynamic = "force-dynamic";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="text-xs font-medium uppercase tracking-wider text-white/40">{title}</h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function Pre({ children }: { children: string }) {
  return (
    <pre className="max-h-[32rem] overflow-auto whitespace-pre-wrap break-words rounded-xl bg-[#1c1c1e] p-4 text-[12px] leading-relaxed text-white/80">
      {children}
    </pre>
  );
}

function stageBody(v: unknown): string {
  return typeof v === "string" ? v : JSON.stringify(v, null, 2);
}

export default async function AdminRunPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const me = await getCachedUser();
  if (!isAdminEmail(me?.email)) notFound();

  const { id } = await params;
  const run = await getRun(createAdminClient(), id);
  if (!run) notFound();

  const lastTiming = run.timings[run.timings.length - 1];

  return (
    <div className="mx-auto w-full max-w-5xl px-5 py-8 sm:px-8">
      <div className="flex flex-wrap items-center gap-3 text-sm text-white/40">
        <Link href="/dashboard/admin/runs" className="transition-colors hover:text-white">
          ← Runs
        </Link>
        {run.userId && (
          <>
            <span>·</span>
            <Link href={`/dashboard/admin/${run.userId}`} className="transition-colors hover:text-white">
              {run.email ?? run.userId.slice(0, 8)}
            </Link>
          </>
        )}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <StatusBadge status={run.status} />
        <h1 className="font-tiktok text-2xl font-extrabold tracking-tight text-white">
          {run.hook ?? run.prompt ?? "Run"}
        </h1>
      </div>
      <p className="mt-1 text-sm text-white/40">
        {new Date(run.createdAt).toLocaleString()} · {run.env}
        {run.copyPath ? ` · ${run.copyPath}` : ""}
        {run.kind && !run.kind.includes(":") ? ` · ${run.kind}` : ""}
      </p>

      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Metric label="Duration" value={seconds(run.durationMs)} />
        <Metric label="Stages" value={run.stages.length} />
        <Metric label="Anomalies" value={run.anomalies.length} />
        <Metric label="Slides" value={run.slides.length || "—"} />
      </div>

      {run.status !== "ok" && (
        <div className="mt-6 rounded-2xl bg-red-500/10 p-5">
          <div className="text-sm font-medium text-red-300">
            {run.status === "rejected" ? "Rejected before the pipeline" : "Failed"}
            {run.failedAt ? ` — last stage: ${run.failedAt}` : ""}
          </div>
          <div className="mt-1 text-sm text-white/80">
            {run.errorCode ? <code className="mr-2 text-red-200/80">{run.errorCode}</code> : null}
            {run.errorMessage}
          </div>
          {run.errorStack && (
            <details className="mt-2">
              <summary className="cursor-pointer text-xs text-white/40">stack</summary>
              <Pre>{run.errorStack}</Pre>
            </details>
          )}
        </div>
      )}

      {run.prompt && (
        <Section title="Prompt">
          <div className="rounded-2xl bg-white/[0.02] p-5 text-sm text-white">“{run.prompt}”</div>
        </Section>
      )}

      {run.anomalies.length > 0 && (
        <Section title="Anomalies detected">
          <ul className="space-y-1 rounded-2xl bg-amber-500/10 p-5 text-sm text-amber-100">
            {run.anomalies.map((a, i) => (
              <li key={i}>• {a}</li>
            ))}
          </ul>
        </Section>
      )}

      {run.slides.length > 0 && (
        <Section title={`Deck${run.slideshowIds.length > 1 ? ` (first of ${run.slideshowIds.length})` : ""}`}>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {run.slides.map((s) => (
              <div key={s.position} className="overflow-hidden rounded-xl bg-[#1c1c1e]">
                {s.url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={s.url} alt="" className="aspect-[9/16] w-full object-cover" />
                ) : (
                  <div className="flex aspect-[9/16] items-center justify-center text-xs text-white/30">
                    no image
                  </div>
                )}
                <div className="p-2">
                  <div className="text-[10px] uppercase tracking-wider text-white/30">
                    {s.position + 1} · {s.role}
                    {s.textBg ? " · plate" : ""}
                  </div>
                  <div className="mt-1 text-xs text-white">{s.caption}</div>
                  {s.body && <div className="mt-1 text-[11px] text-white/50">{s.body}</div>}
                </div>
              </div>
            ))}
          </div>
          {run.slideshowId && (
            <p className="mt-2 text-xs text-white/40">
              slideshow <code>{run.slideshowId}</code>
              {run.slideshowIds.length > 1 && ` · also ${run.slideshowIds.slice(1).join(", ")}`}
            </p>
          )}
        </Section>
      )}

      {run.notes.length > 0 && (
        <Section title="Summary">
          <div className="space-y-3">
            {run.notes.map((n, i) => (
              <details key={i} open={i < 3} className="rounded-2xl bg-white/[0.02] p-4">
                <summary className="cursor-pointer text-sm font-medium text-white">{n.section}</summary>
                <div className="mt-3">
                  <Pre>{n.body}</Pre>
                </div>
              </details>
            ))}
          </div>
        </Section>
      )}

      <Section title="Stages">
        {run.stages.length === 0 ? (
          <p className="text-sm text-white/40">Nothing logged before it stopped.</p>
        ) : (
          <div className="space-y-2">
            {run.stages.map(([name, v]) => (
              <details key={name} className="rounded-2xl bg-white/[0.02] p-4">
                <summary className="cursor-pointer text-sm text-white">
                  <code>{name}</code>
                  <span className="ml-3 text-xs text-white/40">
                    {run.timings.find(([n]) => n === name)?.[1] != null
                      ? `+${(run.timings.find(([n]) => n === name)![1] / 1000).toFixed(1)}s`
                      : ""}
                  </span>
                </summary>
                <div className="mt-3">
                  <Pre>{stageBody(v)}</Pre>
                </div>
              </details>
            ))}
          </div>
        )}
      </Section>

      {run.timings.length > 0 && (
        <Section title="Waterfall">
          <div className="rounded-2xl bg-white/[0.02] p-4">
            {run.timings.map(([name, ms]) => (
              <div key={name} className="flex items-center gap-3 py-0.5 text-xs">
                <span className="w-56 shrink-0 truncate text-white/60">
                  <code>{name}</code>
                </span>
                <div className="h-1.5 flex-1 rounded-full bg-white/[0.06]">
                  <div
                    className="h-1.5 rounded-full bg-[#6366f1]"
                    style={{ width: `${lastTiming ? Math.max(1, (ms / lastTiming[1]) * 100) : 0}%` }}
                  />
                </div>
                <span className="w-14 shrink-0 text-right text-white/40">{(ms / 1000).toFixed(1)}s</span>
              </div>
            ))}
          </div>
        </Section>
      )}

      {run.images.length > 0 && (
        <Section title="Images (references)">
          <div className="rounded-2xl bg-white/[0.02] p-4 text-xs text-white/60">
            {run.images.map((im, i) => (
              <div key={i} className="flex justify-between py-0.5">
                <code>{im.name}</code>
                <span className="text-white/40">{(im.bytes / 1024).toFixed(0)} KB</span>
              </div>
            ))}
          </div>
        </Section>
      )}

      {run.request && (
        <Section title="Request">
          <Pre>{JSON.stringify(run.request, null, 2)}</Pre>
        </Section>
      )}
    </div>
  );
}
