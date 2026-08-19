// Go/no-go on the TikTok image proxy, before anyone films a demo.
//
//   node scripts/check-proxy.mjs                       # newest slideshow, prod
//   node scripts/check-proxy.mjs <slideshowId> [pos]   # a specific slide
//   node scripts/check-proxy.mjs --base=http://localhost:3000
//
// This makes the EXACT request TikTok's servers make when they pull a slide:
// a GET to /api/tiktok/img/<id>/<pos> signed with the same HMAC. That matters
// because the whole failure mode on 2026-08-10 was invisible from our side —
// the proxy 500'd with an empty body on every request, TikTok silently gave up,
// and posts sat in PROCESSING_DOWNLOAD forever with no error recorded anywhere.
// Nothing in the app tells you the proxy is reachable; this does.
//
// Reads .env.local for the signing secret and (optionally) Supabase, so it can
// pick a real slideshow for you. Real env vars win, so you can point it at a
// different secret without editing the file:
//
//   TIKTOK_CLIENT_SECRET=... node scripts/check-proxy.mjs
//
// Never prints a key or a secret.

import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

// .env.local sits next to the script in a normal checkout, but this repo is
// often driven from a git worktree, where it stays in the main working tree.
const here = path.dirname(fileURLToPath(import.meta.url));
function loadEnv() {
  const merged = {};
  for (const file of [path.join(here, "..", ".env.local"), path.join(process.cwd(), ".env.local")]) {
    let raw;
    try {
      raw = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    for (const line of raw.split("\n")) {
      const i = line.indexOf("=");
      if (i < 0 || line.trim().startsWith("#")) continue;
      merged[line.slice(0, i).trim()] ??= line.slice(i + 1).trim();
    }
  }
  // A real env var always beats the file.
  for (const k of ["TIKTOK_CLIENT_KEY", "TIKTOK_CLIENT_SECRET", "NEXT_PUBLIC_APP_URL", "SUPABASE_SECRET_KEY"]) {
    if (process.env[k]) merged[k] = process.env[k];
  }
  return merged;
}

const env = loadEnv();
const args = process.argv.slice(2);
const baseArg = args.find((a) => a.startsWith("--base="))?.slice(7);
const rest = args.filter((a) => !a.startsWith("--"));
const base = (baseArg || env.NEXT_PUBLIC_APP_URL || "https://www.slidelabs.ai").replace(/\/+$/, "");

const secret = env.TIKTOK_CLIENT_SECRET;
if (!secret || secret.includes("your_")) {
  console.error("TIKTOK_CLIENT_SECRET is not set locally — nothing to sign with.");
  process.exit(2);
}

// Mirrors signedProxyToken in utils/tiktok.ts. If these ever drift, this script
// reports a false 401 and the real proxy is fine, so keep them identical.
function sign(id, pos) {
  const expiry = Math.floor(Date.now() / 1000) + 2 * 60 * 60;
  const token = createHmac("sha256", secret).update(`${id}:${pos}:${expiry}`).digest("hex");
  return `token=${token}&exp=${expiry}`;
}

async function sb(pathAndQuery) {
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const key = env.SUPABASE_SECRET_KEY;
  if (!url || !key) return null;
  const res = await fetch(`${url}/rest/v1/${pathAndQuery}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  return res.ok ? res.json() : null;
}

// The newest slideshow that actually has a slide 0 with a background — an empty
// deck would fail the check for a reason that has nothing to do with config.
async function newestSlideshow() {
  const decks = await sb("slideshows?select=id,title,created_at&order=created_at.desc&limit=10");
  if (!decks?.length) return null;
  const ids = decks.map((d) => d.id).join(",");
  const slides = await sb(`slides?slideshow_id=in.(${ids})&position=eq.0&select=slideshow_id,storage_path`);
  const usable = new Set((slides ?? []).filter((s) => s.storage_path).map((s) => s.slideshow_id));
  return decks.find((d) => usable.has(d.id)) ?? null;
}

let id = rest[0];
let pos = rest[1] ?? "0";
let label = "";
if (!id) {
  const deck = await newestSlideshow();
  if (!deck) {
    console.error(
      "No slideshow id given and none could be read from Supabase.\n" +
        "Pass one: node scripts/check-proxy.mjs <slideshowId> [pos]",
    );
    process.exit(2);
  }
  id = deck.id;
  label = ` (${deck.title})`;
}

const url = `${base}/api/tiktok/img/${id}/${pos}?${sign(id, pos)}`;
console.log(`GET ${base}/api/tiktok/img/${id}/${pos}${label}`);

let res;
try {
  res = await fetch(url);
} catch (e) {
  console.error(`UNREACHABLE — ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
}

const type = res.headers.get("content-type") ?? "";
const buf = Buffer.from(await res.arrayBuffer());
const kb = `${Math.round(buf.byteLength / 1024)}KB`;

if (res.ok && type.startsWith("image/")) {
  console.log(`OK — ${type.split(";")[0]} ${kb}. TikTok can pull this slide.`);

  // A reachable proxy is only half of "safe to film". The demo video submitted
  // on 2026-08-19 was rejected because the consent screen in it read
  // "SlideShowAI (Sandbox)" — the pipeline worked perfectly, for the wrong app.
  // Nothing in the product shows which app is configured, and by the time the
  // word "(Sandbox)" is on screen it is already in the footage.
  //
  // The OK above is what makes this checkable from here: the proxy verified an
  // HMAC we signed with the LOCAL TIKTOK_CLIENT_SECRET, so the deployment signs
  // with that same secret. If the local key beside it is a sandbox key, the
  // credentials in front of the camera are the sandbox app's.
  const clientKey = env.TIKTOK_CLIENT_KEY;
  const isLocal = /^https?:\/\/(localhost|127\.0\.0\.1)/.test(base);
  if (!clientKey || clientKey.includes("your_")) {
    console.log("\n  (TIKTOK_CLIENT_KEY is not set locally, so which TikTok app is");
    console.log("   configured could not be checked — do that before filming.)");
  } else if (clientKey.startsWith("sb") && !isLocal) {
    console.log(`\nSANDBOX APP — do not film. The key is \`${clientKey.slice(0, 6)}…\`.`);
    console.log("  The consent screen will read \"(Sandbox)\" and the recording is");
    console.log("  inadmissible for the audit no matter how the rest of the flow goes.");
    console.log("\n  → Set TIKTOK_CLIENT_KEY and TIKTOK_CLIENT_SECRET in Vercel to the");
    console.log("    PRODUCTION app's pair, redeploy, reconnect TikTok, then re-run this.");
    process.exit(1);
  } else if (!isLocal) {
    console.log(`Production app \`${clientKey.slice(0, 6)}…\` — the consent screen will not say "(Sandbox)".`);
  }
  process.exit(0);
}

// Everything below is a failure, and WHICH failure is the whole point: the
// three look identical from the modal ("Network error") but have three
// unrelated fixes.
const body = buf.toString("utf8").trim();
let parsed = null;
try {
  parsed = JSON.parse(body);
} catch {}

console.log(`FAILED — HTTP ${res.status}${type ? ` ${type.split(";")[0]}` : ""}`);
if (parsed?.detail) {
  console.log(`  ${parsed.error}`);
  console.log(`  ${parsed.detail}`);
  console.log("\n  → A server env var is missing. Set it in Vercel for the PRODUCTION");
  console.log("    environment specifically, then redeploy — env changes need one.");
} else if (parsed?.error) {
  console.log(`  ${parsed.error}`);
  if (res.status === 401) {
    console.log("\n  → The token was rejected, which means the secret IS set on the server;");
    console.log("    it just isn't the same one this machine signed with. Expected if prod");
    console.log("    holds the production app's secret and .env.local still holds sandbox.");
  }
} else if (!body) {
  console.log("  (empty body)");
  console.log("\n  → An empty 500 is the pre-4f55991 shape: the deploy predates the fix that");
  console.log("    names config errors. Redeploy, then run this again for the real reason.");
} else {
  console.log(`  ${body.slice(0, 300)}`);
}
process.exit(1);
