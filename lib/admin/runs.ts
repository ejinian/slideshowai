import type { SupabaseClient } from "@supabase/supabase-js";
import { bgPathFrom } from "@/lib/generate/renderSlide";

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

type FullRow = Row & {
  stages: Record<string, unknown> | null;
  notes: { section: string; body: string }[] | null;
  timings: Record<string, number> | null;
  images: { name: string; bytes: number }[] | null;
};

/** The deck's slides with 1h signed background URLs; [] when there is no deck. */
async function slidesFor(admin: SupabaseClient, slideshowId: string | null): Promise<RunSlide[]> {
  if (!slideshowId) return [];
  const { data: rows } = await admin
    .from("slides")
    .select("position, role, caption, body, storage_path, text_bg")
    .eq("slideshow_id", slideshowId)
    .order("position");
  const list = (rows ?? []) as {
    position: number;
    role: string | null;
    caption: string | null;
    body: string | null;
    storage_path: string | null;
    text_bg: boolean | null;
  }[];
  // `storage_path` names the slide (`N.jpg`), but text is never baked into
  // storage: the only object that exists is the text-free background,
  // `N-bg.jpg`. Signing the slide path returned nothing and every deck showed
  // "no image" until 2026-09-24.
  const bgPaths = list.map((s) => (s.storage_path ? bgPathFrom(s.storage_path) : null));
  const paths = bgPaths.filter((p): p is string => !!p);
  const { data: signed } = paths.length
    ? await admin.storage.from("slideshows").createSignedUrls(paths, 3600)
    : { data: [] as { path: string | null; signedUrl: string }[] };
  const urlFor = new Map((signed ?? []).filter((s) => s.signedUrl).map((s) => [s.path, s.signedUrl]));
  return list.map((s, i) => ({
    position: s.position,
    role: s.role,
    caption: s.caption,
    body: s.body,
    textBg: s.text_bg,
    url: bgPaths[i] ? (urlFor.get(bgPaths[i]) ?? null) : null,
  }));
}

function toDetail(r: FullRow, emails: Map<string, string>, slides: RunSlide[]): RunDetail {
  const stages = Object.entries(r.stages ?? {}).sort(([a], [b]) => a.localeCompare(b));
  const extraIds = r.stages?.["06_slideshows.json"];
  const slideshowIds = Array.isArray(extraIds)
    ? extraIds.filter((x): x is string => typeof x === "string")
    : r.slideshow_id
      ? [r.slideshow_id]
      : [];
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

export async function getRun(admin: SupabaseClient, id: string): Promise<RunDetail | null> {
  const { data, error } = await admin
    .from("generation_runs")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error || !data) return null;
  const r = data as FullRow;
  const emails = await emailMap(admin, r.user_id ? [r.user_id] : []);
  return toDetail(r, emails, await slidesFor(admin, r.slideshow_id));
}

/** A page of FULL runs (every stage, the deck's slides) — the readable
 *  diagnostics view. ~50KB a row, so pages stay small. */
export async function listRunsDetailed(
  admin: SupabaseClient,
  opts: Omit<ListRunsOptions, "limit"> & { page: number; perPage: number },
): Promise<{ runs: RunDetail[]; total: number }> {
  const from = (opts.page - 1) * opts.perPage;
  let q = admin
    .from("generation_runs")
    .select("*", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(from, from + opts.perPage - 1);
  if (opts.userId) q = q.eq("user_id", opts.userId);
  if (opts.status === "problems") q = q.neq("status", "ok");
  else if (opts.status && opts.status !== "all") q = q.eq("status", opts.status);
  if (opts.env && opts.env !== "all") q = q.eq("env", opts.env);
  const { data, error, count } = await q;
  if (error || !data) return { runs: [], total: 0 };
  const rows = data as unknown as FullRow[];
  const emails = await emailMap(admin, [...new Set(rows.map((r) => r.user_id).filter((x): x is string => !!x))]);
  const slides = await Promise.all(rows.map((r) => slidesFor(admin, r.slideshow_id)));
  return { runs: rows.map((r, i) => toDetail(r, emails, slides[i])), total: count ?? rows.length };
}

// ── Digest: the stages as plain rows a person can read ──────────────────────
// The stage payloads are what the pipeline dumped, in whatever shape each step
// uses. This reads the ones we know (every name seen in the table as of
// 2026-09-24) into one flat, readable record; anything unknown stays available
// as raw JSON on the run page. Tolerant of every field being missing — a
// failed run has only the early stages.

export interface RunDigest {
  /** The exact prompt sent to the copy model (whichever path ran). */
  copyPrompt: string | null;
  /** The real hooks shown as register examples. */
  exemplars: string | null;
  plannedHooks: string[];
  drafts: { texts: string[]; wordsPerSlide: number | null }[];
  pick: { index: number; reason: string; selector: string | null } | null;
  /** How each slide got its image, in slide order. */
  images: { slide: number; caption: string; how: string }[];
  poolNotes: { photo: number; note: string | null; hasText: boolean }[];
  poolRetry: { refused: string[]; rewritten: boolean; stillUnplaced: string[]; newDeck: string[] | null } | null;
  swap: { caption: string | null; outcome: string | null; source: string | null; keywords: string[] } | null;
  blueprint: string | null;
  register: string | null;
}

const asRecord = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
const asArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const asStr = (v: unknown): string | null => (typeof v === "string" ? v : null);
const asStrings = (v: unknown): string[] => asArray(v).filter((x): x is string => typeof x === "string");

export function digestRun(run: RunDetail): RunDigest {
  const s = new Map(run.stages);
  const g = (name: string) => s.get(name);

  const cands = asRecord(g("03_lean_candidates.json"));
  const wps = asArray(cands.wordsPerSlide).map((w) => (typeof w === "number" ? w : null));
  const drafts = asArray(cands.candidates).map((c, i) => ({
    texts: asStrings(c),
    wordsPerSlide: wps[i] ?? null,
  }));
  const pickRaw = asRecord(g("03b_lean_pick.json"));
  const pick =
    typeof pickRaw.pick === "number"
      ? { index: pickRaw.pick, reason: asStr(pickRaw.reason) ?? "", selector: asStr(pickRaw.selector) }
      : null;

  const notesRaw = asRecord(g("04a_pool_notes.json"));
  const poolNotes = asArray(notesRaw.photos).map((p) => {
    const r = asRecord(p);
    return {
      photo: typeof r.photo === "number" ? r.photo : -1,
      note: asStr(r.note),
      hasText: r.hasText === true,
    };
  });
  const noteFor = (i: number) => poolNotes.find((n) => n.photo === i)?.note ?? null;

  // Image decisions, whichever path ran. Later sources override earlier ones
  // for the same slide (an AI fill replaces a stock verdict).
  const images = new Map<number, { slide: number; caption: string; how: string }>();
  const put = (slide: number, caption: string, how: string) => images.set(slide, { slide, caption, how });
  const stock = g("04_stock_selection.json");
  for (const d of asArray(Array.isArray(stock) ? stock : asRecord(stock).slides)) {
    const r = asRecord(d);
    if (typeof r.slide !== "number") continue;
    const verdict = asStr(r.verdict) ?? "";
    put(r.slide + 1, asStr(r.caption) ?? "", `stock — ${verdict}${r.keywords ? ` · searched: ${asStrings(r.keywords).join(", ")}` : ""}`);
  }
  for (const a of asArray(asRecord(g("04c_ai_stock_fallback.json")).attempted)) {
    const r = asRecord(a);
    if (typeof r.slide !== "number") continue;
    put(r.slide + 1, asStr(r.caption) ?? "", `AI background — ${asStr(r.outcome) ?? ""} (the judge rejected every stock candidate)`);
  }
  for (const p of asArray(asRecord(g("04_pool_match.json")).perSlide)) {
    const r = asRecord(p);
    if (typeof r.slide !== "number") continue;
    const idx = typeof r.photoIndex === "number" ? r.photoIndex : -1;
    put(r.slide, asStr(r.caption) ?? "", idx >= 0 ? `collection photo #${idx}${noteFor(idx) ? ` — ${noteFor(idx)}` : ""}` : "unplaced");
  }
  for (const p of asArray(asRecord(g("04_photo_assignment.json")).perSlide)) {
    const r = asRecord(p);
    if (typeof r.slide !== "number") continue;
    put(r.slide, asStr(r.caption) ?? "", typeof r.photoIndex === "number" && r.photoIndex >= 0 ? `their upload #${r.photoIndex}` : "no upload fit — stock fill");
  }

  const retryRaw = asRecord(g("04b_pool_retry.json"));
  const poolRetry = retryRaw.refused
    ? {
        refused: asStrings(retryRaw.refused),
        rewritten: retryRaw.rewritten === true,
        stillUnplaced: asStrings(retryRaw.stillUnplaced),
        newDeck: retryRaw.newDeck ? asStrings(retryRaw.newDeck) : null,
      }
    : null;

  const swapRaw = asRecord(g("04_swap_selection.json") ?? g("04_swap_pool.json") ?? g("04_swap_ai.json"));
  const swap = Object.keys(swapRaw).length
    ? {
        caption: asStr(swapRaw.caption),
        outcome: asStr(swapRaw.outcome) ?? (swapRaw.picked != null ? `collection photo #${String(swapRaw.picked)}` : null),
        source: asStr(swapRaw.sourceUrl),
        keywords: asStrings(swapRaw.keywords),
      }
    : null;

  const bp = asRecord(g("01e_client_blueprint.json") ?? g("01e_trend_blueprint.json"));
  const blueprint = Object.keys(bp).length
    ? [asStr(bp.hookType), asStr(bp.author) && `@${asStr(bp.author)}`, asStr(bp.source)].filter(Boolean).join(" · ")
    : null;
  const reg = asRecord(asRecord(g("01f_niche_register.json")).register);
  const register =
    typeof reg.medianWords === "number"
      ? `${asStr(reg.trendNiche) ?? "niche"}: ~${reg.medianWords} words/slide, cap ${String(reg.wordCap)}`
      : null;

  return {
    copyPrompt: asStr(g("02_lean_prompt.txt") ?? g("02_imagefirst_prompt.txt") ?? g("02_copy_prompt.txt")),
    exemplars: asStr(g("01b_trend_exemplars.txt")),
    plannedHooks: asStrings(cands.plannedHooks),
    drafts,
    pick,
    images: [...images.values()].sort((a, b) => a.slide - b.slide),
    poolNotes,
    poolRetry,
    swap,
    blueprint,
    register,
  };
}
