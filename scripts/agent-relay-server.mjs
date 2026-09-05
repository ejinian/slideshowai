// A stand-in for the OpenAI chat-completions endpoint that PARKS each request
// on disk and waits for something else to answer it.
//
// WHY THIS EXISTS: we want to run the real generation pipeline — including its
// validator/retry loop, which is most of what we are actually testing — while a
// Claude subagent plays the part of gpt-4o. Subagents can only be spawned by an
// agent session, never by a script, so the script cannot call the model. This
// inverts the dependency: the pipeline runs here, blocks on an HTTP request, and
// a SEPARATE session picks the prompt up off disk and writes the answer back.
//
// ⚠️ THE ANSWERING SESSION MUST BE STARTED IN THE BATCH DIRECTORY, NOT THE REPO.
// Project context (CLAUDE.md / AGENTS.md / MEMORY.md) is injected into every
// subagent from its parent session, and a subagent that has read our caption
// doctrine writes to the rules instead of to the prompt — measured 2026-09-05:
// against a prompt stating "6 to 12 words, 14 at the very most" it produced a
// deck capped at exactly 10 words with exactly 3 of 5 slides saying "you", which
// are MAX_CAPTION_WORDS and secondPersonCap(5) — numbers that appear nowhere in
// that prompt. Contaminated agents score themselves against the answer key, and
// the whole sweep comes back clean and meaningless.
//
// Usage:
//   node scripts/agent-relay-server.mjs [--dir=<batch dir>] [--port=8765] [--wait=1800]
//
// Then point the pipeline at it:
//   GEN_BASE_URL=http://127.0.0.1:8765/v1 \
//   GEN_COPY_TIMEOUT_MS=1800000 \
//   OPENAI_API_KEY=relay-stub \
//   npx tsx --env-file=.env.local scripts/bulk-copy-test.ts --n=30

import { createServer } from "node:http";
import { mkdir, writeFile, readFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const arg = (name, fallback) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};

const DIR = path.resolve(arg("dir", "/Users/ejinian/Desktop/slidelabs-batch"));
const PORT = Number(arg("port", "8765"));
const WAIT_MS = Number(arg("wait", "1800")) * 1000;
const POLL_MS = 750;

const PENDING = path.join(DIR, "pending");
const DONE = path.join(DIR, "done");
const LOG = path.join(DIR, "log");

let seq = 0;

/** Split the two messages back out for the human-readable prompt file. */
function renderPrompt(body) {
  const sys = body.messages?.find((m) => m.role === "system")?.content ?? "";
  const usr = body.messages?.find((m) => m.role === "user")?.content ?? "";
  return `===== SYSTEM =====\n${sys}\n\n===== USER =====\n${usr}\n`;
}

/** Wait for done/<id>.json to appear. Returns its parsed contents, or null. */
async function awaitAnswer(id, deadline) {
  const file = path.join(DONE, `${id}.json`);
  while (Date.now() < deadline) {
    if (existsSync(file)) {
      // A writer may still be mid-write; a failed parse just means "not yet".
      try {
        return JSON.parse(await readFile(file, "utf8"));
      } catch {
        /* keep waiting */
      }
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
  return null;
}

const server = createServer(async (req, res) => {
  if (!req.url?.includes("/chat/completions") || req.method !== "POST") {
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: { message: "relay: only POST /v1/chat/completions" } }));
    return;
  }

  const chunks = [];
  for await (const c of req) chunks.push(c);
  let body;
  try {
    body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    res.writeHead(400, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: { message: "relay: unparseable request body" } }));
    return;
  }

  const id = String(++seq).padStart(3, "0");
  const schema = body.response_format?.json_schema?.schema ?? null;

  await writeFile(path.join(PENDING, `${id}.txt`), renderPrompt(body));
  await writeFile(
    path.join(PENDING, `${id}.schema.json`),
    JSON.stringify(schema, null, 2),
  );
  // Full payload kept for forensics — never shown to the answering session,
  // because it names the real model and would tip it off.
  await writeFile(path.join(LOG, `${id}.request.json`), JSON.stringify(body, null, 2));

  const isRetry = /Your previous attempt was rejected/.test(
    body.messages?.find((m) => m.role === "user")?.content ?? "",
  );
  console.log(
    `[relay] ${id} parked${isRetry ? " (RETRY — a validator rejected the last deck)" : ""}` +
      ` · ${(body.messages?.map((m) => m.content.length).reduce((a, b) => a + b, 0) / 4) | 0} tok`,
  );

  const answer = await awaitAnswer(id, Date.now() + WAIT_MS);
  if (!answer) {
    console.log(`[relay] ${id} TIMED OUT after ${WAIT_MS / 1000}s`);
    res.writeHead(504, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: { message: `relay: no answer for ${id}`, type: "timeout" } }));
    return;
  }

  // The pipeline reads exactly one field — choices[0].message.content — but the
  // response is shaped as a full completion so the openai client parses it and
  // so anything added later (usage accounting, finish_reason checks) still works.
  const payload = {
    id: `chatcmpl-relay-${id}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: body.model ?? "relay",
    choices: [
      {
        index: 0,
        message: { role: "assistant", content: JSON.stringify(answer), refusal: null },
        finish_reason: "stop",
        logprobs: null,
      },
    ],
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
  };
  console.log(`[relay] ${id} answered (${answer.slides?.length ?? "?"} slides)`);
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify(payload));
});

for (const d of [PENDING, DONE, LOG]) await mkdir(d, { recursive: true });
// Refuse to start on a dirty batch dir — a stale done/001.json would be handed
// straight back as the answer to a brand-new prompt 001, silently.
for (const d of [PENDING, DONE]) {
  const left = (await readdir(d)).filter((f) => !f.startsWith("."));
  if (left.length) {
    console.error(
      `[relay] ${path.relative(DIR, d)}/ is not empty (${left.length} files).\n` +
        `        Clear it before starting, or answers from the last run will be\n` +
        `        served to this one.`,
    );
    process.exit(1);
  }
}

server.listen(PORT, "127.0.0.1", () => {
  console.log(`[relay] listening  http://127.0.0.1:${PORT}/v1`);
  console.log(`[relay] batch dir  ${DIR}`);
  console.log(`[relay] wait       ${WAIT_MS / 1000}s per request\n`);
});
