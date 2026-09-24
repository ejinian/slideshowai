import Link from "next/link";
import { notFound } from "next/navigation";
import { createAdminClient } from "@/utils/supabase/admin";
import { getCachedUser } from "@/utils/supabase/server";
import { isAdminEmail } from "@/lib/admins";
import { listRunsDetailed, digestRun, type RunDetail, type RunStatus } from "@/lib/admin/runs";
import { relative } from "../ui";
import { StatusBadge, seconds } from "../runs/row";

// Every run, fully readable, no clicking in: what they typed, what shipped,
// how each slide got its picture, every draft the copy model wrote and why
// one was chosen, and — when it broke — where. The run page keeps the raw
// stages; this is the one to read on a customer's first day.
export const dynamic = "force-dynamic";

const PER_PAGE = 10;
const STATUSES: { key: RunStatus | "problems" | "all"; label: string }[] = [
  { key: "all", label: "All" },
  { key: "problems", label: "Problems" },
  { key: "ok", label: "OK" },
];
const ENVS = ["all", "production", "development"];

function Label({ children }: { children: React.ReactNode }) {
  return <div className="text-[11px] font-medium uppercase tracking-wider text-white/35">{children}</div>;
}

function Mono({ children }: { children: string }) {
  return (
    <pre className="max-h-[28rem] overflow-auto whitespace-pre-wrap break-words rounded-xl bg-[#1c1c1e] p-4 text-[12px] leading-relaxed text-white/75">
      {children}
    </pre>
  );
}

function Run({ run }: { run: RunDetail }) {
  const d = digestRun(run);
  const rq = run.request ?? {};
  const source =
    run.kind === "swap"
      ? "photo swap"
      : rq.backgroundMode === "single"
        ? run.copyPath === "lean" && (run.stages.some(([n]) => n.startsWith("04_pool")) ? "their collection" : "their uploads")
        : rq.backgroundMode === "ai"
          ? "AI images"
          : "our photos (stock)";
  const meta = [
    run.env !== "production" ? run.env : null,
    source,
    run.copyPath && run.kind !== "swap" ? `${run.copyPath} copy` : null,
    typeof rq.slideCount === "number" ? `${rq.slideCount} slides asked` : null,
    run.slides.length ? `${run.slides.length} made` : null,
    seconds(run.durationMs),
  ].filter(Boolean);
  const deckTexts = run.slides.length
    ? run.slides.map((s) => s.caption ?? "")
    : d.pick && d.drafts[d.pick.index]
      ? d.drafts[d.pick.index].texts
      : [];

  return (
    <article className="rounded-2xl bg-white/[0.02] p-5 sm:p-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={run.status} />
            <span className="text-sm text-white">{run.email ?? run.userId?.slice(0, 8) ?? "anon"}</span>
            <span className="text-xs text-white/35">{new Date(run.createdAt).toLocaleString()} · {relative(run.createdAt)}</span>
          </div>
          <div className="mt-1 text-xs text-white/40">{meta.join(" · ")}</div>
        </div>
        <Link href={`/dashboard/admin/runs/${run.id}`} className="text-xs text-white/40 transition-colors hover:text-white">
          raw stages →
        </Link>
      </div>

      {/* What they typed → what it became */}
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div>
          <Label>{run.kind === "swap" ? "Slide being swapped" : "They typed"}</Label>
          <div className="mt-1 text-[15px] text-white">“{run.kind === "swap" ? d.swap?.caption ?? run.hook : run.prompt ?? "—"}”</div>
        </div>
        {run.kind !== "swap" && (
          <div>
            <Label>Slide 1 became</Label>
            <div className="mt-1 text-[15px] text-white">{run.hook ? `“${run.hook}”` : "—"}</div>
            {d.plannedHooks.length > 0 && run.prompt && d.plannedHooks[0] === run.hook && run.hook.toLowerCase() === run.prompt.toLowerCase().replace(/[.!]+$/, "") && (
              <div className="mt-0.5 text-xs text-emerald-300/80">their own words, verbatim</div>
            )}
          </div>
        )}
      </div>

      {/* Failure */}
      {run.status !== "ok" && (
        <div className="mt-4 rounded-xl bg-red-500/10 p-4">
          <div className="text-sm font-medium text-red-300">
            {run.status === "rejected" ? "Rejected before the pipeline" : "Failed"}
            {run.failedAt ? ` — last stage: ${run.failedAt}` : ""}
          </div>
          <div className="mt-1 text-sm text-white/80">
            {run.errorCode && <code className="mr-2 text-red-200/80">{run.errorCode}</code>}
            {run.errorMessage}
          </div>
          {run.errorStack && (
            <details className="mt-2">
              <summary className="cursor-pointer text-xs text-white/40">stack</summary>
              <Mono>{run.errorStack}</Mono>
            </details>
          )}
        </div>
      )}

      {/* Anomalies */}
      {run.anomalies.length > 0 && (
        <div className="mt-4 rounded-xl bg-amber-500/10 p-4 text-sm text-amber-100">
          {run.anomalies.map((a, i) => (
            <div key={i} className={i ? "mt-1" : ""}>
              • {a.replace(/\*\*/g, "")}
            </div>
          ))}
        </div>
      )}

      {/* Swap */}
      {d.swap && (
        <div className="mt-4">
          <Label>What the swap did</Label>
          <div className="mt-1 text-sm text-white">{d.swap.outcome ?? "—"}</div>
          {d.swap.keywords.length > 0 && (
            <div className="mt-0.5 text-xs text-white/40">searched: {d.swap.keywords.join(", ")}</div>
          )}
          {d.swap.source && <div className="mt-0.5 truncate text-xs text-white/30">{d.swap.source}</div>}
        </div>
      )}

      {/* The deck with its images */}
      {run.slides.length > 0 && (
        <div className="mt-5">
          <Label>The deck{run.kind === "swap" ? " (after the swap)" : ""}</Label>
          <div className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-6">
            {run.slides.map((s) => (
              <div key={s.position} className="overflow-hidden rounded-xl bg-[#1c1c1e]">
                {s.url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={s.url} alt="" className="aspect-[9/16] w-full object-cover" />
                ) : (
                  <div className="flex aspect-[9/16] items-center justify-center text-[11px] text-white/30">no image</div>
                )}
                <div className="p-2">
                  <div className="text-[10px] text-white/30">{s.position + 1}{s.textBg ? " · plate" : ""}</div>
                  <div className="mt-0.5 text-[12px] leading-snug text-white">{s.caption}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* How each slide got its picture */}
      {d.images.length > 0 && (
        <div className="mt-5">
          <Label>How each slide got its picture</Label>
          <div className="mt-2 overflow-hidden rounded-xl bg-[#1c1c1e]">
            {d.images.map((im) => (
              <div key={im.slide} className="flex gap-3 border-b border-white/[0.05] px-4 py-2 text-[12px] last:border-b-0">
                <span className="w-4 shrink-0 text-white/30">{im.slide}</span>
                <span className="w-2/5 shrink-0 text-white/80">{im.caption}</span>
                <span className="min-w-0 text-white/50">{im.how}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Named-thing retry */}
      {d.poolRetry && (
        <div className="mt-4 rounded-xl bg-amber-500/10 p-4 text-sm text-amber-100">
          <div className="font-medium">Named things the collection doesn&apos;t have</div>
          <div className="mt-1 text-amber-100/80">refused: {d.poolRetry.refused.map((t) => `“${t}”`).join(", ")}</div>
          <div className="mt-1 text-amber-100/80">
            {d.poolRetry.rewritten
              ? d.poolRetry.stillUnplaced.length
                ? `rewritten once — still unplaced: ${d.poolRetry.stillUnplaced.map((t) => `“${t}”`).join(", ")}`
                : "rewritten once — every slide then matched"
              : "the rewrite failed; original captions were backfilled"}
          </div>
        </div>
      )}

      {/* The copy: hooks planned, drafts written, the pick */}
      {(d.plannedHooks.length > 0 || d.drafts.length > 0) && (
        <div className="mt-5">
          <Label>The copy — {d.drafts.length} draft{d.drafts.length === 1 ? "" : "s"}, one chosen</Label>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {d.drafts.map((dr, i) => {
              const chosen = d.pick?.index === i;
              return (
                <div key={i} className={`rounded-xl p-3 ${chosen ? "bg-[#6366f1]/15 ring-1 ring-[#6366f1]/40" : "bg-[#1c1c1e]"}`}>
                  <div className="flex items-center justify-between text-[11px] text-white/40">
                    <span>draft {i}{chosen ? " · chosen" : ""}</span>
                    {dr.wordsPerSlide != null && <span>{dr.wordsPerSlide} w/slide</span>}
                  </div>
                  <ol className="mt-1 space-y-0.5 text-[12px] text-white/80">
                    {dr.texts.map((t, j) => (
                      <li key={j} className={j === 0 ? "font-semibold text-white" : ""}>
                        <span className="mr-1.5 text-white/25">{j + 1}</span>
                        {t}
                      </li>
                    ))}
                  </ol>
                </div>
              );
            })}
          </div>
          {d.pick && (
            <div className="mt-2 text-[12px] text-white/50">
              <span className="text-white/35">why {d.pick.selector ? `(${d.pick.selector})` : ""}:</span> {d.pick.reason}
            </div>
          )}
        </div>
      )}

      {/* Deck text when there was no persisted deck and no drafts (legacy path) */}
      {run.slides.length === 0 && d.drafts.length === 0 && deckTexts.length > 0 && (
        <div className="mt-4">
          <Label>Captions</Label>
          <ol className="mt-1 text-[12px] text-white/80">{deckTexts.map((t, i) => <li key={i}>{i + 1}. {t}</li>)}</ol>
        </div>
      )}

      {/* Collection notes */}
      {d.poolNotes.length > 0 && (
        <details className="mt-4">
          <summary className="cursor-pointer text-[12px] text-white/40">
            What the copy was told the {d.poolNotes.length} collection photos show
          </summary>
          <div className="mt-2 grid gap-x-4 gap-y-0.5 rounded-xl bg-[#1c1c1e] p-3 text-[12px] sm:grid-cols-2">
            {d.poolNotes.map((n) => (
              <div key={n.photo} className={n.hasText ? "text-white/30 line-through" : "text-white/70"}>
                <span className="mr-1.5 text-white/25">#{n.photo}</span>
                {n.note ?? "(no note)"}
                {n.hasText ? " · has text, excluded" : ""}
              </div>
            ))}
          </div>
        </details>
      )}

      {/* Raw text, collapsed */}
      {(d.copyPrompt || d.exemplars || d.blueprint || d.register) && (
        <div className="mt-4 space-y-2">
          {(d.blueprint || d.register) && (
            <div className="text-[12px] text-white/40">
              {d.register && <span>register — {d.register}</span>}
              {d.register && d.blueprint && <span> · </span>}
              {d.blueprint && <span>trend blueprint — {d.blueprint}</span>}
            </div>
          )}
          {d.copyPrompt && (
            <details>
              <summary className="cursor-pointer text-[12px] text-white/40">The exact prompt sent to the copy model</summary>
              <div className="mt-2"><Mono>{d.copyPrompt}</Mono></div>
            </details>
          )}
          {d.exemplars && (
            <details>
              <summary className="cursor-pointer text-[12px] text-white/40">Real hooks it was shown</summary>
              <div className="mt-2"><Mono>{d.exemplars}</Mono></div>
            </details>
          )}
        </div>
      )}
    </article>
  );
}

export default async function AdminDiagnosticsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; env?: string; page?: string; user?: string }>;
}) {
  const me = await getCachedUser();
  if (!isAdminEmail(me?.email)) notFound();

  const sp = await searchParams;
  const status = (STATUSES.find((s) => s.key === sp.status)?.key ?? "all") as RunStatus | "problems" | "all";
  const env = ENVS.includes(sp.env ?? "") ? (sp.env as string) : "all";
  const page = Math.max(1, Number(sp.page) || 1);
  const userId = sp.user && /^[0-9a-f-]{36}$/i.test(sp.user) ? sp.user : undefined;

  const { runs, total } = await listRunsDetailed(createAdminClient(), {
    status,
    env,
    userId,
    page,
    perPage: PER_PAGE,
  });
  const pages = Math.max(1, Math.ceil(total / PER_PAGE));

  const link = (next: { status?: string; env?: string; page?: number }) => {
    const q = new URLSearchParams();
    const s = next.status ?? status;
    const e = next.env ?? env;
    const p = next.page ?? 1;
    if (s !== "all") q.set("status", s);
    if (e !== "all") q.set("env", e);
    if (userId) q.set("user", userId);
    if (p > 1) q.set("page", String(p));
    const qs = q.toString();
    return `/dashboard/admin/diagnostics${qs ? `?${qs}` : ""}`;
  };
  const pill = (active: boolean) =>
    `rounded-full px-3 py-1 text-xs transition-colors ${
      active ? "bg-white text-black" : "bg-white/[0.06] text-white/60 hover:bg-white/[0.1] hover:text-white"
    }`;

  return (
    <div className="mx-auto w-full max-w-5xl px-5 py-8 sm:px-8">
      <Link href="/dashboard/admin" className="text-sm text-white/40 transition-colors hover:text-white">
        ← Customers
      </Link>
      <div className="mt-4">
        <h1 className="font-tiktok text-2xl font-extrabold tracking-tight text-white">Diagnostics</h1>
        <p className="mt-1 text-sm text-white/40">
          {total} run{total === 1 ? "" : "s"}
          {userId ? " for this customer" : ""} · newest first · page {page} of {pages}
        </p>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-2">
        {STATUSES.map((s) => (
          <Link key={s.key} href={link({ status: s.key })} className={pill(s.key === status)}>
            {s.label}
          </Link>
        ))}
        <span className="mx-1 h-4 w-px bg-white/10" />
        {ENVS.map((e) => (
          <Link key={e} href={link({ env: e })} className={pill(e === env)}>
            {e}
          </Link>
        ))}
      </div>

      {runs.length === 0 ? (
        <div className="mt-8 rounded-2xl bg-white/[0.02] p-8 text-center text-sm text-white/40">
          No runs match.
        </div>
      ) : (
        <div className="mt-5 space-y-4">
          {runs.map((r) => (
            <Run key={r.id} run={r} />
          ))}
        </div>
      )}

      {pages > 1 && (
        <div className="mt-6 flex items-center justify-between text-sm">
          {page > 1 ? (
            <Link href={link({ page: page - 1 })} className="text-white/60 transition-colors hover:text-white">
              ← Newer
            </Link>
          ) : (
            <span />
          )}
          <span className="text-white/35">
            {page} / {pages}
          </span>
          {page < pages ? (
            <Link href={link({ page: page + 1 })} className="text-white/60 transition-colors hover:text-white">
              Older →
            </Link>
          ) : (
            <span />
          )}
        </div>
      )}
    </div>
  );
}
