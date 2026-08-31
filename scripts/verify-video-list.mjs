// Does /v2/video/list/ return PHOTO posts? — the go/no-go for the scope
// revision in docs/tiktok-scope-revision.md. Our posts are photo slideshows;
// if the endpoint only lists videos, per-post analytics is impossible via the
// official API and the revision should request user.info.stats only.
//
//   node scripts/verify-video-list.mjs
//
// Runs the WHOLE check against the SANDBOX app, entirely outside the app and
// outside Vercel — production keys and live users are never involved. The
// script does the OAuth dance manually: it prints an authorize URL, you open
// it, log in as the sandbox Target User account, approve, and paste back the
// URL you land on (the code is in its query string). Then it exchanges the
// code and calls user/info + video/list, and prints the verdict.
//
// Needs in .env.local (or real env vars — those win):
//   TIKTOK_SANDBOX_KEY     the sandbox app's client key  (sbaw…)
//   TIKTOK_SANDBOX_SECRET  the sandbox app's client secret
// Optional:
//   TIKTOK_SANDBOX_REDIRECT  a redirect URI registered in the SANDBOX app's
//                            Login Kit (default: https://www.slidelabs.ai/privacy
//                            — a static page, so the code survives in the URL bar)
//
// Sandbox portal prerequisites (portal → the sandbox app):
//   - Login Kit + Display API products added
//   - Scopes: user.info.basic, user.info.stats, video.list (sandbox grants
//     scopes instantly, no review)
//   - The redirect URI above registered under Login Kit
//   - The test TikTok account added as a Target User, and that account has
//     photo posts on its profile
//
// Never prints a key or a secret.

import { createHash, randomBytes } from "node:crypto";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

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
  for (const k of ["TIKTOK_SANDBOX_KEY", "TIKTOK_SANDBOX_SECRET", "TIKTOK_SANDBOX_REDIRECT"]) {
    if (process.env[k]) merged[k] = process.env[k];
  }
  return merged;
}

const env = loadEnv();
const key = (env.TIKTOK_SANDBOX_KEY ?? "").trim();
const secret = (env.TIKTOK_SANDBOX_SECRET ?? "").trim();
const redirectUri = (env.TIKTOK_SANDBOX_REDIRECT ?? "https://www.slidelabs.ai/privacy").trim();

if (!key || !secret) {
  console.error("Set TIKTOK_SANDBOX_KEY and TIKTOK_SANDBOX_SECRET in .env.local first.");
  process.exit(1);
}
if (!key.startsWith("sb")) {
  // The whole point is to keep production out of this; a production key here
  // means the wrong value was pasted (the sandbox prefix is sbaw…).
  console.error(`TIKTOK_SANDBOX_KEY doesn't look like a sandbox key (got "${key.slice(0, 4)}…").`);
  process.exit(1);
}

// PKCE, TikTok flavor: the challenge is HEX-encoded SHA256, NOT RFC 7636's
// base64url — same deviation utils/tiktok.ts documents.
const verifier = randomBytes(32).toString("hex");
const challenge = createHash("sha256").update(verifier).digest("hex");
const state = randomBytes(8).toString("hex");

const authorize =
  "https://www.tiktok.com/v2/auth/authorize/?" +
  new URLSearchParams({
    client_key: key,
    response_type: "code",
    scope: "user.info.basic,user.info.stats,video.list",
    redirect_uri: redirectUri,
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  }).toString();

console.log("\n1. Open this URL in a browser, log in as the sandbox Target User");
console.log("   account, and approve. The consent screen should say \"(Sandbox)\" —");
console.log("   here that is CORRECT (this probe is sandbox-only by design).\n");
console.log(authorize);
console.log(`\n2. You'll land on ${redirectUri}?code=… — copy the FULL URL from`);
console.log("   the address bar and paste it here.\n");

const rl = createInterface({ input: stdin, output: stdout });
const pasted = (await rl.question("Redirected URL: ")).trim();
rl.close();

let code;
try {
  const u = new URL(pasted);
  code = u.searchParams.get("code");
  const gotState = u.searchParams.get("state");
  if (gotState && gotState !== state) {
    console.error("State mismatch — that URL is from a different run. Re-run and use the fresh link.");
    process.exit(1);
  }
} catch {
  code = pasted; // allow pasting the bare code too
}
if (!code) {
  console.error("No ?code= in that URL. TikTok appends it on approval — check for an error param instead.");
  process.exit(1);
}

// Token endpoint responses are FLAT (not nested under data) — the documented
// recurring bug. Errors arrive as top-level {error, error_description}.
const tokenRes = await fetch("https://open.tiktokapis.com/v2/oauth/token/", {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({
    client_key: key,
    client_secret: secret,
    code,
    grant_type: "authorization_code",
    redirect_uri: redirectUri,
    code_verifier: verifier,
  }),
});
const token = await tokenRes.json();
if (!token.access_token) {
  console.error(`Token exchange failed: ${token.error ?? tokenRes.status} — ${token.error_description ?? ""}`);
  process.exit(1);
}
console.log(`\nToken OK (scopes granted: ${token.scope ?? "?"})`);

const auth = { Authorization: `Bearer ${token.access_token}` };

const infoFields = "display_name,follower_count,following_count,likes_count,video_count";
const info = await fetch(
  `https://open.tiktokapis.com/v2/user/info/?fields=${encodeURIComponent(infoFields)}`,
  { headers: auth },
).then((r) => r.json());
const u = info.data?.user ?? {};
console.log(
  `\nuser.info.stats → @${u.display_name ?? "?"}: ` +
    `${u.follower_count ?? "?"} followers, ${u.likes_count ?? "?"} likes, ` +
    `${u.video_count ?? "?"} posts total` +
    (info.error?.code && info.error.code !== "ok" ? `  (ERROR: ${info.error.code})` : ""),
);

const listFields = "id,title,video_description,create_time,view_count,like_count,comment_count,share_count";
const list = await fetch(
  `https://open.tiktokapis.com/v2/video/list/?fields=${encodeURIComponent(listFields)}`,
  { method: "POST", headers: { ...auth, "Content-Type": "application/json" }, body: JSON.stringify({ max_count: 20 }) },
).then((r) => r.json());

if (list.error?.code && list.error.code !== "ok") {
  console.error(`\nvideo.list ERROR: ${list.error.code} — ${list.error.message ?? ""}`);
  process.exit(1);
}
const videos = list.data?.videos ?? [];
console.log(`\nvideo.list → ${videos.length} item(s):`);
for (const v of videos) {
  const when = v.create_time ? new Date(v.create_time * 1000).toISOString().slice(0, 10) : "?";
  const text = (v.video_description || v.title || "").replace(/\s+/g, " ").slice(0, 60);
  console.log(`  ${when}  views=${v.view_count ?? "—"} likes=${v.like_count ?? "—"}  "${text}"`);
}

mkdirSync(path.join(here, "..", "diagnostics"), { recursive: true });
const dump = path.join(here, "..", "diagnostics", "video-list-probe.json");
writeFileSync(dump, JSON.stringify({ info, list }, null, 2));
console.log(`\nFull responses: ${dump}`);

// The verdict needs a human eye: compare the account's photo posts on its
// PROFILE against the list above. Counting can't do it alone — video_count
// may or may not include photos, which is itself part of the answer.
console.log(
  videos.length === 0
    ? "\nVERDICT: video.list returned NOTHING. If the account's posts are all photo\nslideshows, the endpoint excludes photos → submit user.info.stats only."
    : "\nVERDICT: compare these items against the account's profile. If its photo\nslideshows appear above (with real view counts), video.list covers photos →\nsubmit BOTH scopes. If only videos appear, submit user.info.stats only.",
);
