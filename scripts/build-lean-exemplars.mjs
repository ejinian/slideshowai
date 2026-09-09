// Turn the labeled corpus (diagnostics/finetune/labeled.jsonl, from
// scripts/build-finetune-set.mjs) into the retrieval index the LEAN copy path
// reads at runtime: lib/generate/data/leanExemplars.json.
//
//   node scripts/build-lean-exemplars.mjs
//
// Why a committed file and not a table: OpenAI closed self-serve fine-tuning
// (403 training_not_available, 2026-09-09), so the corpus is used in-context
// instead — the nearest real decks by TOPIC are shown whole as exemplars.
// Retrieval needs an embedding per deck; 128-dim text-embedding-3-small
// vectors for ~320 decks are ~300KB, small enough to ship in the bundle and
// avoid a migration + a per-request DB read. Re-run after re-labeling.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import OpenAI from "openai";

const env = Object.fromEntries(
  readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split("\n")
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "")]),
);
const openai = new OpenAI({ apiKey: env.OPENAI_API_KEY });
const DIMS = 128;

const labeled = readFileSync(new URL("../diagnostics/finetune/labeled.jsonl", import.meta.url), "utf8")
  .split("\n")
  .filter(Boolean)
  .map((l) => JSON.parse(l))
  .filter((l) => l.keep && l.topic && l.topic.length >= 8);
console.log("exemplars:", labeled.length);

// Embed the topic plus the hook — the hook carries the angle the topic alone
// can flatten ("gym motivation" vs "my cousin dragged me to the gym at 12am").
const inputs = labeled.map((l) => `${l.topic}\n${l.texts[0]}`);
const out = [];
for (let i = 0; i < inputs.length; i += 100) {
  const res = await openai.embeddings.create({
    model: "text-embedding-3-small",
    input: inputs.slice(i, i + 100),
    dimensions: DIMS,
  });
  for (const e of res.data) out.push(e.embedding.map((x) => Math.round(x * 1000) / 1000));
  console.log("embedded", Math.min(i + 100, inputs.length));
}

const rows = labeled.map((l, i) => ({
  id: l.id,
  niche: l.niche,
  views: l.views ?? 0,
  topic: l.topic,
  texts: l.texts,
  emb: out[i],
}));
mkdirSync(new URL("../lib/generate/data/", import.meta.url), { recursive: true });
const dest = new URL("../lib/generate/data/leanExemplars.json", import.meta.url);
writeFileSync(dest, JSON.stringify({ dims: DIMS, model: "text-embedding-3-small", rows }));
console.log("wrote", dest.pathname, `${Math.round(readFileSync(dest).length / 1024)}KB`);
