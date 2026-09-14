import type { SupabaseClient } from "@supabase/supabase-js";

// Reads over `generation_runs` for the admin dashboard. Service-role client
// only — the table has no RLS policies on purpose (see the migration).

export type RunStatus = "ok" | "failed" | "rejected";

export interface RunSummary {
  id: string;
  userId: string | null;
  email: string | null;
  slideshowId: string | null;
  status: RunStatus;
  env: string;
  kind: string | null;
  copyPath: string | null;
  hook: string | null;
  prompt: string | null;
  failedAt: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  anomalies: string[];
  durationMs: number | null;
  createdAt: string;
}

export interface RunSlide {
  position: number;
  role: string | null;
  caption: string | null;
  body: string | null;
  textBg: boolean | null;
  /** Signed URL of the text-free background (1h). */
  url: string | null;
}

export interface RunDetail extends RunSummary {
  request: Record<string, unknown> | null;
  /** Stage name → payload; text stages are strings. Sorted by name (= order). */
  stages: [string, unknown][];
  notes: { section: string; body: string }[];
  timings: [string, number][];
  images: { name: string; bytes: number }[];
  errorStack: string | null;
  slideshowIds: string[];
  slides: RunSlide[];
}

type Row = {
  id: string;
  user_id: string | null;
  slideshow_id: string | null;
  status: RunStatus;
  env: string;
  kind: string | null;
  copy_path: string | null;
  hook: string | null;
  failed_at: string | null;
  error: { code?: string | null; message?: string; stack?: string | null } | null;
  request: Record<string, unknown> | null;
  anomalies: string[] | null;
  duration_ms: number | null;
  created_at: string;
};

const SUMMARY_COLS =
  "id, user_id, slideshow_id, status, env, kind, copy_path, hook, failed_at, error, request, anomalies, duration_ms, created_at";

/** Email per user id, from auth.users (the `profiles` mirror is null for a third of accounts). */
async function emailMap(admin: SupabaseClient, ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!ids.length) return out;
  const want = new Set(ids);
  // Small user base: one page covers everyone.
  const { data } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  for (const u of data?.users ?? []) if (want.has(u.id) && u.email) out.set(u.id, u.email);
  return out;
}

function toSummary(r: Row, emails: Map<string, string>): RunSummary {
  return {
    id: r.id,
    userId: r.user_id,
    email: r.user_id ? (emails.get(r.user_id) ?? null) : null,
    slideshowId: r.slideshow_id,
    status: r.status,
    env: r.env,
    kind: r.kind,
    copyPath: r.copy_path,
    hook: r.hook,
    prompt: typeof r.request?.prompt === "string" ? (r.request.prompt as string) : null,
    failedAt: r.failed_at,
    errorCode: r.error?.code ?? null,
    errorMessage: r.error?.message ?? null,
    anomalies: r.anomalies ?? [],
    durationMs: r.duration_ms,
    createdAt: r.created_at,
  };
}

export interface ListRunsOptions {
  userId?: string;
  /** "problems" = failed + rejected. */
  status?: RunStatus | "problems" | "all";
  /** "all" or one env value. */
  env?: string;
  limit?: number;
}

export async function listRuns(
  admin: SupabaseClient,
  opts: ListRunsOptions = {},
): Promise<RunSummary[]> {
  let q = admin
    .from("generation_runs")
    .select(SUMMARY_COLS)
    .order("created_at", { ascending: false })
    .limit(opts.limit ?? 100);
  if (opts.userId) q = q.eq("user_id", opts.userId);
  if (opts.status === "problems") q = q.neq("status", "ok");
  else if (opts.status && opts.status !== "all") q = q.eq("status", opts.status);
  if (opts.env && opts.env !== "all") q = q.eq("env", opts.env);
  const { data, error } = await q;
  if (error || !data) return [];
  const rows = data as unknown as Row[];
  const emails = await emailMap(admin, [...new Set(rows.map((r) => r.user_id).filter((x): x is string => !!x))]);
  return rows.map((r) => toSummary(r, emails));
}

export async function getRun(admin: SupabaseClient, id: string): Promise<RunDetail | null> {
  const { data, error } = await admin
    .from("generation_runs")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error || !data) return null;
  const r = data as Row & {
    stages: Record<string, unknown> | null;
    notes: { section: string; body: string }[] | null;
    timings: Record<string, number> | null;
    images: { name: string; bytes: number }[] | null;
  };
  const emails = await emailMap(admin, r.user_id ? [r.user_id] : []);
  const stages = Object.entries(r.stages ?? {}).sort(([a], [b]) => a.localeCompare(b));
  const extraIds = r.stages?.["06_slideshows.json"];
  const slideshowIds = Array.isArray(extraIds)
    ? extraIds.filter((x): x is string => typeof x === "string")
    : r.slideshow_id
      ? [r.slideshow_id]
      : [];

  let slides: RunSlide[] = [];
  if (r.slideshow_id) {
    const { data: rows } = await admin
      .from("slides")
      .select("position, role, caption, body, storage_path, text_bg")
      .eq("slideshow_id", r.slideshow_id)
      .order("position");
    const list = (rows ?? []) as {
      position: number;
      role: string | null;
      caption: string | null;
      body: string | null;
      storage_path: string | null;
      text_bg: boolean | null;
    }[];
    const paths = list.map((s) => s.storage_path).filter((p): p is string => !!p);
    const { data: signed } = paths.length
      ? await admin.storage.from("slideshows").createSignedUrls(paths, 3600)
      : { data: [] as { path: string | null; signedUrl: string }[] };
    const urlFor = new Map((signed ?? []).map((s) => [s.path, s.signedUrl]));
    slides = list.map((s) => ({
      position: s.position,
      role: s.role,
      caption: s.caption,
      body: s.body,
      textBg: s.text_bg,
      url: s.storage_path ? (urlFor.get(s.storage_path) ?? null) : null,
    }));
  }

  return {
    ...toSummary(r, emails),
    request: r.request,
    stages,
    notes: r.notes ?? [],
    timings: Object.entries(r.timings ?? {}).sort(([, a], [, b]) => a - b),
    images: r.images ?? [],
    errorStack: r.error?.stack ?? null,
    slideshowIds,
    slides,
  };
}
