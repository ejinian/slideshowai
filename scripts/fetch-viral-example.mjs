// Pull the slides of ONE TikTok photo post so a viral example can be added to
// lib/generate/viralExamples.ts without transcribing by hand.
//
//   node scripts/fetch-viral-example.mjs "https://www.tiktok.com/@user/photo/123..."
//
// Writes viral-examples/<handle>-<awemeId>/slide-01.jpg… in swipe order, plus a
// meta.json (caption, author, stats). Claude then READS those images, transcribes
// the on-slide text, and appends the entry — the human still picks which posts
// are worth adding; this just removes the grunt work.
//
// RESOLVERS, in order:
//   1. tikwm — free, keyless public resolver. No account, no cost. Default.
//   2. Apify ScrapTik — only if tikwm fails AND APIFY_TOKEN is set. Costs ~$0.002
//      and shares the monthly cap with the trends pipeline, so it's the fallback.
// Scraping the tiktok.com page ourselves is NOT an option: TikTok withholds the
// post payload from non-browser clients (the rehydration blob comes back with
// only app-context/i18n scopes), so it would mean defeating their bot detection.
//
// Deliberately single-URL: this is a curation tool, not a crawler.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ACTOR = "scraptik~tiktok-api";
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

// .env.local isn't auto-loaded in a bare node script (same approach as
// scripts/trial-scraptik.mjs).
function env(key) {
  try {
    const raw = readFileSync(join(ROOT, ".env.local"), "utf8");
    for (const line of raw.split("\n")) {
      if (!line.includes("=") || line.trim().startsWith("#")) continue;
      const k = line.slice(0, line.indexOf("=")).trim();
      if (k === key) return line.slice(line.indexOf("=") + 1).trim();
    }
  } catch {
    /* fall through */
  }
  return process.env[key];
}

/** Accepts a full URL or a bare aweme id. */
function parseTarget(input) {
  if (/^\d{6,}$/.test(input)) return { awemeId: input, handle: "unknown" };
  const id = input.match(/\/(?:photo|video)\/(\d+)/);
  const handle = input.match(/@([\w.-]+)/);
  if (!id) {
    throw new Error(
      "Could not find a post id in that input. Pass a /photo/<id> or /video/<id> URL, or the numeric id.",
    );
  }
  return { awemeId: id[1], handle: handle ? handle[1] : "unknown" };
}

// TikTok pairs a HEIC variant with a JPEG one; sharp can't decode HEIC and
// neither can most viewers. (Mirrors pickDecodableUrl in lib/trends.ts.)
function pickDecodable(urls) {
  if (!Array.isArray(urls) || urls.length === 0) return undefined;
  return urls.find((u) => /\.(jpe?g|webp|png)(\?|$)/i.test(u)) ?? urls[0];
}

/** Normalized shape every resolver returns. */
function shape({ images, desc, author, nickname, views, likes, createdAt, url }) {
  return { images, desc, author, nickname, views, likes, createdAt, url };
}

async function viaTikwm(rawUrl) {
  const res = await fetch(
    `https://www.tikwm.com/api/?url=${encodeURIComponent(rawUrl)}`,
    { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(45_000) },
  );
  if (!res.ok) throw new Error(`tikwm HTTP ${res.status}`);
  const j = await res.json();
  if (j.code !== 0) throw new Error(`tikwm: ${j.msg || "error"}`);
  const d = j.data ?? {};
  if (!Array.isArray(d.images) || d.images.length === 0) {
    throw new Error("tikwm: no slides (probably a video, not a photo post)");
  }
  return shape({
    images: d.images,
    desc: d.title ?? "",
    author: d.author?.unique_id ?? null,
    nickname: d.author?.nickname ?? null,
    views: d.play_count ?? null,
    likes: d.digg_count ?? null,
    createdAt: d.create_time ? new Date(d.create_time * 1000).toISOString() : null,
    url: rawUrl,
  });
}

/** ScrapTik nests the post differently per endpoint — unwrap by walking. */
function findAweme(payload, awemeId) {
  const seen = [];
  const walk = (node, depth) => {
    if (!node || typeof node !== "object" || depth > 6) return;
    if (Array.isArray(node)) return node.forEach((n) => walk(n, depth + 1));
    if (node.aweme_id || node.image_post_info || node.aweme_type != null) seen.push(node);
    Object.values(node).forEach((v) => walk(v, depth + 1));
  };
  walk(payload, 0);
  return (
    seen.find((p) => String(p.aweme_id) === String(awemeId)) ??
    seen.find((p) => p?.image_post_info?.images?.length > 0) ??
    seen[0]
  );
}

async function viaApify(awemeId, rawUrl) {
  const token = env("APIFY_TOKEN");
  if (!token || token.includes("your_")) throw new Error("APIFY_TOKEN not set");
  const res = await fetch(
    `https://api.apify.com/v2/acts/${ACTOR}/run-sync-get-dataset-items?token=${token}&timeout=180`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ post_awemeId: awemeId }),
    },
  );
  if (!res.ok) throw new Error(`Apify HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const post = findAweme(await res.json(), awemeId);
  const raw = post?.image_post_info?.images ?? [];
  if (raw.length === 0) throw new Error("Apify: no slides on that post");
  return shape({
    images: raw.map((im) => pickDecodable(im?.display_image?.url_list)).filter(Boolean),
    desc: post.desc ?? "",
    author: post.author?.unique_id ?? null,
    nickname: post.author?.nickname ?? null,
    views: post.statistics?.play_count ?? null,
    likes: post.statistics?.digg_count ?? null,
    createdAt: post.create_time ? new Date(post.create_time * 1000).toISOString() : null,
    url: post.share_url?.split("?")[0] || rawUrl,
  });
}

const input = process.argv[2];
if (!input) {
  console.error('Usage: node scripts/fetch-viral-example.mjs "<tiktok photo url or aweme id>"');
  process.exit(1);
}
const { awemeId, handle } = parseTarget(input);
const canonical = `https://www.tiktok.com/@${handle}/photo/${awemeId}`;
console.log(`→ post ${awemeId} (@${handle})`);

let post = null;
for (const [name, fn] of [
  ["tikwm (free)", () => viaTikwm(handle === "unknown" ? input : canonical)],
  ["apify", () => viaApify(awemeId, canonical)],
]) {
  try {
    post = await fn();
    console.log(`  resolver: ${name}`);
    break;
  } catch (e) {
    console.warn(`  ${name} failed — ${e.message}`);
  }
}
if (!post) {
  console.error("\nAll resolvers failed.");
  process.exit(1);
}

const who = post.author || handle;
const outDir = join(ROOT, "viral-examples", `${who}-${awemeId}`);
mkdirSync(outDir, { recursive: true });

let saved = 0;
for (let i = 0; i < post.images.length; i++) {
  const url = post.images[i];
  try {
    const img = await fetch(url, {
      headers: { "User-Agent": UA, Referer: "https://www.tiktok.com/" },
      signal: AbortSignal.timeout(45_000),
    });
    if (!img.ok) throw new Error(`HTTP ${img.status}`);
    const buf = Buffer.from(await img.arrayBuffer());
    const ext = /\.webp(\?|$)/i.test(url) ? "webp" : /\.png(\?|$)/i.test(url) ? "png" : "jpg";
    const name = `slide-${String(i + 1).padStart(2, "0")}.${ext}`;
    writeFileSync(join(outDir, name), buf);
    saved++;
    console.log(`  ${name}  (${Math.round(buf.length / 1024)}kb)`);
  } catch (e) {
    console.warn(`  slide ${i + 1}: ${e.message}, skipped`);
  }
}

writeFileSync(
  join(outDir, "meta.json"),
  JSON.stringify(
    {
      url: post.url,
      awemeId,
      author: who,
      nickname: post.nickname,
      // The VIDEO DESCRIPTION — not the on-slide text. The words baked onto the
      // slides exist only in the images, which is why Claude reads them.
      description: post.desc,
      slideCount: post.images.length,
      views: post.views,
      likes: post.likes,
      postedAt: post.createdAt,
    },
    null,
    2,
  ),
);

console.log(`\n✓ ${saved}/${post.images.length} slides → viral-examples/${who}-${awemeId}/`);
console.log(`  caption: ${post.desc || "(none)"}`);
console.log(`  ${post.views ?? "?"} views · ${post.likes ?? "?"} likes`);
console.log("\nNext: have Claude read the slides and append to lib/generate/viralExamples.ts");
