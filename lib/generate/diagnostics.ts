import { mkdir, writeFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { createAdminClient } from "@/utils/supabase/admin";

// Forensic record of a single generation run, so a bad slideshow can be
// diagnosed after the fact WITHOUT screenshots: the exact prompts sent to each
// model, each model's raw response, the per-slide image decisions.
//
// TWO SINKS BEHIND ONE INTERFACE. The ~30 call sites in /api/generate and
// lib/generate talk to `RunLogger` and never know where the bytes go:
//
//   * FOLDER — local dev only. diagnostics/Run_N_Diagnostics[_Stock]/ with a
//     file per stage plus the actual images (Vercel's FS is read-only, so this
//     sink is off there).
//   * DB — everywhere, unless DIAG_DB=off. One row in `generation_runs`
//     (migration 20260914120000) with every stage's payload under the file
//     name it would have had locally, images by NAME AND SIZE ONLY, and — the
//     part the folders never had — failures: the last stage that logged before
//     the throw, and the classified error. Local dev writes this row too
//     (tagged env=development), which is what keeps the two sinks honest: the
//     prod path is exercised on every local run.
//
// Both sinks are best-effort: every write is caught, and a missing table or a
// dead connection costs a diagnostics row, never a generation.

// Anchor dumps to THIS REPO's root — the nearest ancestor with a package.json —
// so they always land in <repo>/diagnostics, never in whatever cwd the dev
// server happened to start from. Falls back to cwd if no package.json is found.
function repoRoot(): string {
  let dir = process.cwd();
  for (let i = 0; i < 8; i++) {
    if (existsSync(path.join(dir, "package.json"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}

export type RunKind = "upload" | "stock";

/** What the route knows about a run before the pipeline starts. */
export interface RunContext {
  userId?: string | null;
  /** The request minus image bytes — the route's `requestSummary`. */
  request?: Record<string, unknown>;
  /** Which copy machinery is expected to run; attach() overrides with what shipped. */
  copyPath?: string | null;
}

export interface RunFailure {
  code?: string | null;
  message: string;
  stack?: string | null;
}

export interface RunLogger {
  /** Folder path when the folder sink is on, else "". */
  dir: string;
  /**
   * What this logger will actually keep. The route consults it before doing
   * work that exists ONLY to feed a sink — the per-slide composite renders in
   * `slides/` cost real CPU and only the folder wants them.
   */
  captures: { images: boolean };
  json(name: string, data: unknown): Promise<void>;
  text(name: string, body: string): Promise<void>;
  image(relName: string, buf: Buffer): Promise<void>;
  /** Collected notes, rendered into 00_SUMMARY.md by finish(). */
  add(section: string, body: string): void;
  /**
   * The deck this run produced, once it has a row. Called per deck on a
   * multi-deck run; the first id becomes the run's `slideshow_id`.
   */
  attach(
    slideshowId: string,
    meta?: { hook?: string | null; copyPath?: string | null },
  ): Promise<void>;
  /** The run threw. Flushes everything captured so far with the error. */
  fail(error: RunFailure): Promise<void>;
  finish(): Promise<void>;
}

function ext(buf: Buffer): string {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8) return "jpg";
  if (buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50) return "png";
  return "bin";
}

// ── Gates ───────────────────────────────────────────────────────────────────

/** Folder sink: LOCAL DEV ONLY. Both guards matter — VERCEL is set even if
 *  someone runs `next dev` on a Vercel machine. */
function folderEnabled(): boolean {
  if (process.env.NODE_ENV !== "development") return false;
  if (process.env.VERCEL || process.env.VERCEL_ENV) return false;
  return true;
}

/** DB sink: on everywhere unless switched off. Never in the e2e run (it mocks
 *  /api/generate, so this is belt and braces). */
function dbEnabled(): boolean {
  if (process.env.DIAG_DB === "off") return false;
  if (process.env.NODE_ENV === "test") return false;
  return true;
}

/** production | preview | development — what the row is tagged with. */
function runEnv(): string {
  if (process.env.VERCEL_ENV) return process.env.VERCEL_ENV;
  return process.env.NODE_ENV === "development" ? "development" : (process.env.NODE_ENV ?? "unknown");
}

/** Service-role client, or null when it can't be built (missing key). */
function adminOrNull(): ReturnType<typeof createAdminClient> | null {
  try {
    return createAdminClient();
  } catch {
    return null;
  }
}

// A single text stage should never approach this (the legacy prompt is ~22k
// chars); it exists so a runaway payload can't produce a multi-megabyte row.
const MAX_TEXT_STAGE = 120_000;
const MAX_JSON_STAGE = 400_000;

function boundedJson(data: unknown): unknown {
  try {
    const s = JSON.stringify(data);
    if (s.length <= MAX_JSON_STAGE) return data;
    return { truncated: true, bytes: s.length, head: s.slice(0, 2_000) };
  } catch {
    return { unserialisable: true };
  }
}

function boundedText(body: string): string {
  return body.length <= MAX_TEXT_STAGE
    ? body
    : `${body.slice(0, MAX_TEXT_STAGE)}\n\n[… truncated, ${body.length} chars total]`;
}

// ── Sinks ───────────────────────────────────────────────────────────────────

type Sink = Omit<RunLogger, "captures">;

async function folderSink(kind: RunKind): Promise<Sink | null> {
  const ROOT = path.join(repoRoot(), "diagnostics");
  try {
    await mkdir(ROOT, { recursive: true });
    const existing = await readdir(ROOT).catch(() => [] as string[]);
    // Number runs chronologically across BOTH kinds so ordering is unambiguous.
    const nums = existing
      .map((d) => /^Run_(\d+)_Diagnostics/.exec(d)?.[1])
      .filter((n): n is string => Boolean(n))
      .map(Number);
    const n = (nums.length ? Math.max(...nums) : 0) + 1;
    const dir = path.join(
      ROOT,
      `Run_${n}_Diagnostics${kind === "stock" ? "_Stock" : ""}`,
    );
    // `images/` = the text-free background chosen per slide (debugs image
    // SELECTION). `slides/` = the same slide composited WITH its caption, i.e.
    // exactly what the user sees (debugs typography, placement, and contrast).
    // Both are needed: a run can pick a perfect photo and still be unreadable.
    await mkdir(path.join(dir, "images"), { recursive: true });
    await mkdir(path.join(dir, "slides"), { recursive: true });
    if (kind === "upload") {
      await mkdir(path.join(dir, "uploads"), { recursive: true });
    }

    const sections: string[] = [];
    const summary = () =>
      writeFile(
        path.join(dir, "00_SUMMARY.md"),
        `# Generation run — ${kind === "stock" ? "Stock photos" : "Uploads"}\n\n${sections.join("\n")}`,
        "utf8",
      ).catch(() => {});

    return {
      dir,
      async json(name, data) {
        await writeFile(path.join(dir, name), JSON.stringify(data, null, 2), "utf8").catch(() => {});
      },
      async text(name, body) {
        await writeFile(path.join(dir, name), body, "utf8").catch(() => {});
      },
      async image(relName, buf) {
        await writeFile(path.join(dir, `${relName}.${ext(buf)}`), buf).catch(() => {});
      },
      add(section, body) {
        sections.push(`## ${section}\n\n${body}\n`);
      },
      async attach(slideshowId, meta) {
        sections.push(
          `## Persisted\n\n- slideshow: \`${slideshowId}\`${meta?.copyPath ? `\n- copy path: ${meta.copyPath}` : ""}\n`,
        );
        await summary();
      },
      async fail(error) {
        await writeFile(
          path.join(dir, "99_FAILURE.json"),
          JSON.stringify({ at: new Date().toISOString(), ...error }, null, 2),
          "utf8",
        ).catch(() => {});
        sections.push(`## FAILED\n\n- ${error.code ?? "error"}: ${error.message}\n`);
        await summary();
      },
      async finish() {
        await summary();
      },
    };
  } catch {
    return null;
  }
}

function dbSink(kind: RunKind, ctx: RunContext): Sink | null {
  const admin = adminOrNull();
  if (!admin) return null;

  const id = randomUUID();
  const started = Date.now();
  const stages: Record<string, unknown> = {};
  const timings: Record<string, number> = {};
  const notes: { section: string; body: string }[] = [];
  const images: { name: string; bytes: number }[] = [];
  const slideshowIds: string[] = [];
  let lastStage: string | null = null;
  let hook: string | null = null;
  let copyPath: string | null = ctx.copyPath ?? null;
  let failure: RunFailure | null = null;

  // Upsert by our own id: the first flush inserts, every later one patches.
  // finish() runs BEFORE the slideshow row exists, so success is a two-step —
  // flush at finish, patch the id on attach — and a throw during persistence
  // still lands as `failed` on the same row.
  const flush = async (status: "ok" | "failed") => {
    const anomalies = (() => {
      const a = stages["05_anomalies.json"] as { flags?: unknown } | undefined;
      return Array.isArray(a?.flags) ? a.flags.filter((f): f is string => typeof f === "string") : [];
    })();
    const row = {
      id,
      user_id: ctx.userId ?? null,
      slideshow_id: slideshowIds[0] ?? null,
      status,
      env: runEnv(),
      kind,
      copy_path: copyPath,
      hook,
      failed_at: status === "failed" ? lastStage : null,
      error: failure ? { code: failure.code ?? null, message: failure.message, stack: failure.stack ?? null } : null,
      request: ctx.request ?? null,
      stages: { ...stages, ...(slideshowIds.length > 1 ? { "06_slideshows.json": slideshowIds } : {}) },
      notes,
      anomalies,
      images,
      timings,
      duration_ms: Date.now() - started,
      finished_at: new Date().toISOString(),
    };
    try {
      await admin.from("generation_runs").upsert(row, { onConflict: "id" });
    } catch {
      /* diagnostics must never break a generation */
    }
  };

  return {
    dir: "",
    async json(name, data) {
      stages[name] = boundedJson(data);
      timings[name] = Date.now() - started;
      lastStage = name;
    },
    async text(name, body) {
      stages[name] = boundedText(body);
      timings[name] = Date.now() - started;
      lastStage = name;
    },
    async image(relName, buf) {
      images.push({ name: relName, bytes: buf.length });
    },
    add(section, body) {
      notes.push({ section, body });
    },
    async attach(slideshowId, meta) {
      slideshowIds.push(slideshowId);
      if (meta?.hook != null && hook == null) hook = meta.hook;
      if (meta?.copyPath) copyPath = meta.copyPath;
      await flush("ok");
    },
    async fail(error) {
      failure = error;
      await flush("failed");
    },
    async finish() {
      await flush("ok");
    },
  };
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * A logger for one run, or null when NO sink is on — so the route's existing
 * `if (diag)` guards keep meaning "is anyone listening".
 */
export async function createRun(
  kind: RunKind,
  ctx: RunContext = {},
): Promise<RunLogger | null> {
  const sinks: Sink[] = [];
  const folder = folderEnabled() ? await folderSink(kind) : null;
  if (folder) sinks.push(folder);
  const db = dbEnabled() ? dbSink(kind, ctx) : null;
  if (db) sinks.push(db);
  if (!sinks.length) return null;

  const all = (f: (s: Sink) => Promise<void> | void) =>
    Promise.all(sinks.map((s) => Promise.resolve(f(s)).catch(() => {}))).then(() => {});

  return {
    dir: folder?.dir ?? "",
    captures: { images: Boolean(folder) },
    json: (name, data) => all((s) => s.json(name, data)),
    text: (name, body) => all((s) => s.text(name, body)),
    image: (relName, buf) => all((s) => s.image(relName, buf)),
    add: (section, body) => {
      for (const s of sinks) s.add(section, body);
    },
    attach: (slideshowId, meta) => all((s) => s.attach(slideshowId, meta)),
    fail: (error) => all((s) => s.fail(error)),
    finish: () => all((s) => s.finish()),
  };
}

/**
 * FAILURE record for a request that never got a RunLogger — rejected BEFORE
 * the pipeline (billing gates, resolvers) or thrown outside it. Exists because
 * these used to leave NOTHING behind: Alen's "generating too fast" took a
 * production DB query to diagnose. Callers pass whatever they know: route,
 * the request STRIPPED of image payloads (counts, not megabytes of base64),
 * and the error. Locally also a JSON file under diagnostics/Failures/.
 *
 * A route containing ":gate" is recorded as `rejected` (we said no); anything
 * else as `failed` (we tried). Never throws. AWAIT it on paths that return
 * immediately — a fire-and-forget insert can be cut off when the function
 * freezes after the response.
 */
export async function logFailure(
  route: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const at = new Date().toISOString();
  if (folderEnabled()) {
    try {
      const dir = path.join(repoRoot(), "diagnostics", "Failures");
      await mkdir(dir, { recursive: true });
      const stamp = at.replace(/[:.]/g, "-");
      await writeFile(
        path.join(dir, `${stamp}_${route.replace(/[^\w-]/g, "_")}.json`),
        JSON.stringify({ route, at, ...payload }, null, 2),
      );
    } catch {
      /* diagnostics must never break a request */
    }
  }
  if (dbEnabled()) {
    const admin = adminOrNull();
    if (!admin) return;
    const { userId, code, message, stack, ...request } = payload as {
      userId?: string;
      code?: string;
      message?: string;
      stack?: string | null;
      [k: string]: unknown;
    };
    try {
      await admin.from("generation_runs").insert({
        id: randomUUID(),
        user_id: userId ?? null,
        status: route.includes(":gate") ? "rejected" : "failed",
        env: runEnv(),
        kind: route,
        failed_at: route,
        error: { code: code ?? null, message: message ?? code ?? "rejected", stack: stack ?? null },
        request,
        finished_at: at,
        duration_ms: 0,
      });
    } catch {
      /* diagnostics must never break a request */
    }
  }
}
