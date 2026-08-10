// Go/no-go probe for a copy-model provider, before you trust a generation to it.
//
//   node scripts/check-copy-model.mjs          # whatever GEN_PROVIDER says
//   node scripts/check-copy-model.mjs xai      # force a provider
//   node scripts/check-copy-model.mjs xai grok-4-fast   # ...and a model id
//
// Answers the three things that decide whether lib/generate/copyModel.ts can
// point at a provider, none of which are safe to assume from docs:
//   1. Which model ids this key can actually reach.
//   2. Whether STRICT json_schema works — listicle.ts depends on it
//      (`strict: true` + `additionalProperties: false`). If this fails, the
//      deck comes back unvalidated and isValid()/normalize() carry the weight.
//   3. Whether it can SEE images — imageFirst.ts is a vision call, and its
//      fallback to copy-first is silent.
//
// Costs a fraction of a cent. Reads .env.local; never prints a key.

import { readFileSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split("\n")
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => [
      l.slice(0, l.indexOf("=")).trim(),
      l.slice(l.indexOf("=") + 1).trim(),
    ]),
);

const PROVIDERS = {
  openai: { base: "https://api.openai.com/v1", keyVar: "OPENAI_API_KEY", model: "gpt-4o" },
  xai: { base: "https://api.x.ai/v1", keyVar: "XAI_API_KEY", model: "grok-4" },
};

const arg = (process.argv[2] ?? env.GEN_PROVIDER ?? "openai").toLowerCase();
const name = arg === "grok" ? "xai" : arg;
const p = PROVIDERS[name];
if (!p) throw new Error(`Unknown provider "${arg}" (expected: openai | xai)`);

const key = env[p.keyVar];
if (!key) throw new Error(`${p.keyVar} missing from .env.local`);
const model = process.argv[3] ?? env.XAI_MODEL ?? p.model;

const auth = { Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
const post = (path, body) =>
  fetch(`${p.base}${path}`, { method: "POST", headers: auth, body: JSON.stringify(body) });

console.log(`provider=${name}  base=${p.base}  model=${model}\n`);

/* 1 — what can this key reach? */
const models = await fetch(`${p.base}/models`, { headers: auth });
if (!models.ok) {
  console.log(`[models] ${models.status} — ${(await models.text()).slice(0, 200)}`);
} else {
  const ids = ((await models.json()).data ?? []).map((m) => m.id).sort();
  console.log(`[models] ${ids.length} available: ${ids.join(", ")}`);
  console.log(ids.includes(model) ? `  "${model}" OK` : `  ⚠️  "${model}" NOT in the list`);
}

/* 2 — strict json_schema, the thing listicle.ts is built on */
const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["slides"],
  properties: {
    slides: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["role", "text"],
        properties: { role: { type: "string" }, text: { type: "string" } },
      },
    },
  },
};

async function trySchema(strict) {
  const res = await post("/chat/completions", {
    model,
    messages: [
      {
        role: "system",
        content:
          "You write TikTok photo-mode slideshow captions. No exclamation marks, no Title Case, no em dashes, no emoji. Be specific and blunt.",
      },
      {
        role: "user",
        content:
          'Write 3 slides for "how to actually get your first 1000 followers". Roles: title, reason, cta.',
      },
    ],
    response_format: {
      type: "json_schema",
      json_schema: { name: "listicle", strict, schema: SCHEMA },
    },
  });
  return { ok: res.ok, status: res.status, body: await res.text() };
}

let r = await trySchema(true);
console.log(`\n[strict json_schema] ${r.ok ? "OK" : `FAILED ${r.status}`}`);
if (!r.ok) {
  console.log(`  ${r.body.slice(0, 300)}`);
  r = await trySchema(false);
  console.log(`[non-strict json_schema] ${r.ok ? "OK" : `FAILED ${r.status}`}`);
  if (!r.ok) console.log(`  ${r.body.slice(0, 300)}`);
}
if (r.ok) {
  const text = JSON.parse(r.body).choices?.[0]?.message?.content ?? "";
  console.log("  captions (eyeball the voice — this is the whole point):");
  for (const s of JSON.parse(text).slides ?? []) {
    console.log(`    [${s.role}] ${s.text}`);
  }
}

/* 3 — vision, which imageFirst.ts needs and fails over from silently */
// 1x1 red PNG. We only care whether the endpoint accepts an image part.
const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const visionBody = (capField) => ({
  model,
  [capField]: 16,
  messages: [
    {
      role: "user",
      content: [
        { type: "text", text: "Reply with the single word: seen" },
        { type: "image_url", image_url: { url: PNG, detail: "low" } },
      ],
    },
  ],
});
// Newer OpenAI models renamed max_tokens → max_completion_tokens and 400 on the
// old name. That is a PARAMETER error, not "this model can't see" — reporting it
// as a vision failure would wrongly condemn a perfectly good vision model.
let vision = await post("/chat/completions", visionBody("max_tokens"));
let vb = await vision.text();
if (!vision.ok && vb.includes("max_completion_tokens")) {
  vision = await post("/chat/completions", visionBody("max_completion_tokens"));
  vb = await vision.text();
}
console.log(
  `\n[vision] ${vision.ok ? "OK — image parts accepted" : `FAILED ${vision.status}`}`,
);
if (!vision.ok) {
  console.log(`  ${vb.slice(0, 300)}`);
  console.log("  ⚠️  imageFirst.ts (uploads) would silently fall back to copy-first.");
}
