// Exercises the generation_runs sink end to end WITHOUT a model call: creates
// a run, logs stages the way the route does, finishes; a second run that fails
// mid-pipeline; a third rejected at a gate — then reads all three back.
//
//   npx tsx --env-file=.env.local scripts/probe-diagnostics.ts
//
// Before the migration has run this must print "table missing → writes were
// silently dropped" and exit 0: that is the deploy-before-migrate contract.
// After it, three rows come back with the expected status/failed_at/anomalies.
// Pass --keep to leave the rows in place (they are tagged by env).
//
// Under `tsx` NODE_ENV is unset, so only the DB sink is on — exactly the prod
// shape. Run with NODE_ENV=development to also exercise the folder sink.

import { createRun, logFailure } from "../lib/generate/diagnostics";
import { createAdminClient } from "../utils/supabase/admin";

async function main() {
  const keep = process.argv.includes("--keep");
  const admin = createAdminClient();
  const marker = `probe-${Date.now()}`;
  console.log("sink env:", process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "(unset → DB only)");

  // ── Run 1: a success ────────────────────────────────────────────────────
  const ok = await createRun("stock", {
    userId: null,
    request: { prompt: marker, slideCount: 5, backgroundMode: "collection" },
    copyPath: "lean",
  });
  if (!ok) throw new Error("createRun returned null — no sink enabled?");
  await ok.json("01_request.json", { prompt: marker });
  await ok.text("02_lean_prompt.txt", "SYSTEM…\nUSER…");
  await ok.json("03_lean_candidates.json", { candidates: [["a", "b"], ["c", "d"]] });
  await ok.json("03b_lean_pick.json", { pick: 1, reason: "shorter, one argument" });
  await ok.image("images/slide_1_title", Buffer.alloc(120_000));
  await ok.json("05_anomalies.json", { flags: ["**TEST FLAG** — probe"] });
  ok.add("Request", "- topic: probe");
  await ok.finish();
  // attach() is skipped here on purpose: slideshow_id is a real FK and there
  // is no deck. The route always attaches a row it just inserted.

  // ── Run 2: a failure mid-pipeline ───────────────────────────────────────
  const bad = await createRun("upload", { userId: null, request: { prompt: marker }, copyPath: "lean" });
  await bad!.json("01_request.json", { prompt: marker });
  await bad!.text("02_lean_prompt.txt", "…");
  await bad!.fail({ code: "images_unavailable", message: "Could not load background images.", stack: null });

  // ── Run 3: a gate rejection (no logger) ─────────────────────────────────
  await logFailure("generate:gate", { userId: null, prompt: marker, code: "quota_exceeded" });

  // ── Read back ───────────────────────────────────────────────────────────
  const { data, error } = await admin
    .from("generation_runs")
    .select("id, status, kind, copy_path, failed_at, error, anomalies, images, timings, duration_ms, env")
    .contains("request", { prompt: marker })
    .order("created_at");

  if (error) {
    if (/generation_runs/.test(error.message) && /not find|does not exist|schema cache/i.test(error.message)) {
      console.log("table missing → writes were silently dropped (expected before the migration). OK");
      return;
    }
    throw error;
  }

  console.log(`rows written: ${data.length} (expect 3)`);
  for (const r of data) {
    console.log(
      `  ${r.status.padEnd(8)} kind=${r.kind} path=${r.copy_path ?? "-"} failed_at=${r.failed_at ?? "-"} ` +
        `err=${r.error?.code ?? "-"} anomalies=${r.anomalies?.length ?? 0} images=${r.images?.length ?? 0} ` +
        `stages_timed=${Object.keys(r.timings ?? {}).length} ${r.duration_ms}ms env=${r.env}`,
    );
  }
  const statuses = data.map((r) => r.status).sort().join(",");
  if (statuses !== "failed,ok,rejected") throw new Error(`expected failed,ok,rejected — got ${statuses}`);
  const failed = data.find((r) => r.status === "failed")!;
  if (failed.failed_at !== "02_lean_prompt.txt") {
    throw new Error(`failed_at should be the last stage, got ${failed.failed_at}`);
  }
  console.log("sink OK");

  if (!keep) {
    await admin.from("generation_runs").delete().in("id", data.map((r) => r.id));
    console.log("probe rows deleted (--keep to retain)");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
