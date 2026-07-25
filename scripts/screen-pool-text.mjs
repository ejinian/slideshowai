// One-off screen of the Pinterest aesthetic pool for baked-in text.
//
//   node scripts/screen-pool-text.mjs                 # screen + flag
//   node scripts/screen-pool-text.mjs --dry-run       # report only, no writes
//   node scripts/screen-pool-text.mjs --collections=beauty,gym
//
// WHY: pool images with graphic text overlays ("Midnight Skincare Routine"
// cards, quote typography) collide with our own baked captions and crop
// mid-word at 9:16 — and the generation judge demonstrably rubber-stamps them
// despite a prompt-level veto (2026-07-24 diagnostics, Runs 1 & 8 both picked
// the same truncated-text pin). So the pool itself gets cleaned once here.
//
// Flagged rows have `source` flipped "pinterest" → "pinterest_text", which
// removes them from generation automatically (lib/generate/liveImages.ts
// pinterestPool filters source=eq.pinterest) — no app code involved, and fully
// reversible with one UPDATE. Storage objects are left untouched.
//
// Flag = graphic/overlay typography, text cards, watermarks, big logos.
// NOT flagged: incidental small product-label text in a natural scene.
// Requires OPENAI_API_KEY, NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY.

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const sharp = require("sharp");

const env = Object.fromEntries(
  readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split("\n")
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
);
const BASE = env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = env.SUPABASE_SECRET_KEY;
const OPENAI_KEY = env.OPENAI_API_KEY;
if (!BASE || !KEY || !OPENAI_KEY) {
  console.error("Need NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY, OPENAI_API_KEY in .env.local");
  process.exit(1);
}
const H = { apikey: KEY, Authorization: `Bearer ${KEY}` };

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    return m ? [m[1], m[2] ?? true] : [a, true];
  }),
);
const DRY = !!args["dry-run"];
const ONLY = args.collections ? String(args.collections).split(",") : null;
// gpt-4o-mini missed doodle/handwriting overlays on the first pass (2026-07-24,
// the "Morning Routine" tray pin) — default to full gpt-4o for reliability.
const MODEL = args.model ? String(args.model) : "gpt-4o";

const BATCH = 8;
const THUMB_W = 320;

async function fetchRows() {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const q =
      `${BASE}/rest/v1/library_images?select=id,url,collection&source=eq.pinterest` +
      (ONLY ? `&collection=in.(${ONLY.join(",")})` : "") +
      `&limit=1000&offset=${from}`;
    const res = await fetch(q, { headers: H });
    if (!res.ok) throw new Error(`fetch rows: ${res.status} ${await res.text()}`);
    const page = await res.json();
    rows.push(...page);
    if (page.length < 1000) return rows;
  }
}

async function thumb(url) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    if (!r.ok) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    const out = await sharp(buf)
      .resize({ width: THUMB_W, withoutEnlargement: true })
      .jpeg({ quality: 60 })
      .toBuffer();
    return `data:image/jpeg;base64,${out.toString("base64")}`;
  } catch {
    return null;
  }
}

async function judgeBatch(items) {
  const content = [
    {
      type: "text",
      text:
        "For each numbered image, decide if it contains BAKED-IN TEXT that would " +
        "clash with a caption overlaid on top: graphic/overlay typography, quote " +
        "or title cards, HANDWRITTEN or doodle-style annotations and lettering, " +
        "watermarks, prominent logos or logo walls. Small incidental product-label " +
        "text on packaging inside a natural scene does NOT count. Return has_text " +
        "per image, in order.",
    },
  ];
  items.forEach((it, i) => {
    content.push({ type: "text", text: `Image ${i}:` });
    content.push({ type: "image_url", image_url: { url: it.thumb, detail: "low" } });
  });
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_KEY}` },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: "user", content }],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "text_flags",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            required: ["has_text"],
            properties: { has_text: { type: "array", items: { type: "boolean" } } },
          },
        },
      },
    }),
    signal: AbortSignal.timeout(90_000),
  });
  if (res.status === 429) throw Object.assign(new Error("rate limited"), { retryable: true });
  if (!res.ok) throw new Error(`openai: ${res.status} ${await res.text()}`);
  const json = await res.json();
  const flags = JSON.parse(json.choices[0].message.content).has_text ?? [];
  return items.map((_, i) => flags[i] === true);
}

async function judgeWithRetry(items) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await judgeBatch(items);
    } catch (e) {
      if (!e.retryable || attempt >= 4) throw e;
      await new Promise((r) => setTimeout(r, 20_000));
    }
  }
}

async function flagRow(id) {
  const res = await fetch(`${BASE}/rest/v1/library_images?id=eq.${id}`, {
    method: "PATCH",
    headers: { ...H, "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify({ source: "pinterest_text" }),
  });
  if (!res.ok) throw new Error(`patch ${id}: ${res.status} ${await res.text()}`);
}

const rows = await fetchRows();
console.log(`${rows.length} pinterest pool rows${ONLY ? ` in ${ONLY.join(",")}` : ""}${DRY ? " (dry run)" : ""}`);

let flagged = 0;
let skipped = 0;
for (let i = 0; i < rows.length; i += BATCH) {
  const batch = rows.slice(i, i + BATCH);
  const withThumbs = (
    await Promise.all(batch.map(async (r) => ({ ...r, thumb: await thumb(r.url) })))
  ).filter((r) => r.thumb);
  skipped += batch.length - withThumbs.length;
  if (withThumbs.length === 0) continue;
  let flags;
  try {
    flags = await judgeWithRetry(withThumbs);
  } catch (e) {
    console.error(`batch at ${i} failed, skipping: ${e.message}`);
    skipped += withThumbs.length;
    continue;
  }
  for (let k = 0; k < withThumbs.length; k++) {
    if (!flags[k]) continue;
    flagged++;
    console.log(`  FLAG [${withThumbs[k].collection}] ${withThumbs[k].url.split("/").pop()}`);
    if (!DRY) await flagRow(withThumbs[k].id);
  }
  process.stdout.write(`  …${Math.min(i + BATCH, rows.length)}/${rows.length}\r`);
  // ~6k tokens per batch against a 200k TPM cap — pace to stay under it.
  await new Promise((r) => setTimeout(r, 2500));
}
console.log(`\ndone: ${flagged} flagged${DRY ? " (dry run — nothing written)" : " → source=pinterest_text"}, ${skipped} unreadable/skipped`);
