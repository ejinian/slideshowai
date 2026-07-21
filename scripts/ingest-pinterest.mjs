// Pinterest aesthetic-pool ingest: Apify search scraper → 1080x1920 center-crop
// JPEG → `library` Storage bucket → library_images row (source: "pinterest").
//
//   node scripts/ingest-pinterest.mjs                          # all collections, 150 each
//   node scripts/ingest-pinterest.mjs --per-niche=60           # smaller first run
//   node scripts/ingest-pinterest.mjs --collections=gym,cafe   # subset
//
// Resumable: already-ingested pins (by pin id) are skipped, so re-running tops
// collections up. Cost: fetch_cat~pinterest-search-scraper bills ~$0.1-0.2 per
// 1k pins scraped — a full default run is well under $1.
//
// These images have NO stock license (they're public Pinterest pins) — they
// feed the "aesthetic pool" the generation judge prefers for vibe/hook slides.
// Requires: APIFY_TOKEN, NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY in
// .env.local, and the 20260707140000_library_images.sql migration.

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
const APIFY = env.APIFY_TOKEN;
const BASE = env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = env.SUPABASE_SECRET_KEY;
if (!APIFY) {
  console.error("APIFY_TOKEN missing from .env.local");
  process.exit(1);
}
const H = { apikey: KEY, Authorization: `Bearer ${KEY}` };

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    return m ? [m[1], m[2] ?? true] : [a, true];
  }),
);
const PER_NICHE = parseInt(args["per-niche"] ?? "150", 10);
const ONLY = args.collections ? String(args.collections).split(",") : null;

const ACTOR = "fetch_cat~pinterest-search-scraper";
const TARGET_W = 1080;
const TARGET_H = 1920;
// Pinterest sources run smaller than Pexels originals; accept a mild upscale
// but skip genuinely soft thumbnails.
const MIN_SOURCE_W = 700;
const MIN_SOURCE_H = 900;

// The whole point of this pool: the viral photo-dump aesthetic Pexels doesn't
// have. Queries chase vibe, not subjects — subject-specific matching stays on
// the live Pexels search.
const QUERIES = {
  gym: [
    "gym aesthetic", "gym photo dump", "gym motivation dark aesthetic",
    "workout aesthetic", "gym fits", "fitness girl aesthetic",
  ],
  food: [
    "restaurant aesthetic", "food photo dump", "dinner party aesthetic",
    "brunch aesthetic", "pasta aesthetic", "dessert aesthetic",
  ],
  fashion: [
    "outfit inspo", "streetwear aesthetic", "fit check",
    "vintage fashion aesthetic", "capsule wardrobe", "fashion photo dump",
  ],
  realestate: [
    "dream house aesthetic", "modern home interior aesthetic", "cozy apartment aesthetic",
    "luxury home aesthetic", "house exterior aesthetic", "interior design inspo",
  ],
  beauty: [
    "skincare aesthetic", "beauty routine aesthetic", "vanity aesthetic",
    "makeup flatlay aesthetic", "self care aesthetic", "glow up aesthetic",
  ],
  cafe: [
    "cafe aesthetic", "coffee shop aesthetic", "latte art aesthetic",
    "coffee photo dump", "matcha aesthetic", "cozy cafe interior",
  ],
  ecommerce: [
    "product photography aesthetic", "small business packaging aesthetic", "candle aesthetic",
    "jewelry flatlay aesthetic", "unboxing aesthetic", "shop small aesthetic",
  ],
};

async function scrape(queries, perQuery) {
  const res = await fetch(
    `https://api.apify.com/v2/acts/${ACTOR}/run-sync-get-dataset-items?token=${APIFY}&timeout=240`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ queries, maxResultsPerQuery: perQuery }),
    },
  );
  if (!res.ok) throw new Error(`apify ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

async function existingIds(collection) {
  const ids = new Set();
  for (let from = 0; ; from += 1000) {
    const res = await fetch(
      `${BASE}/rest/v1/library_images?select=source_id&collection=eq.${collection}&source=eq.pinterest&limit=1000&offset=${from}`,
      { headers: H },
    );
    if (!res.ok) throw new Error(`library_images not readable (${res.status})`);
    const rows = await res.json();
    rows.forEach((r) => ids.add(r.source_id));
    if (rows.length < 1000) break;
  }
  return ids;
}

// Pinterest CDN serves sized renditions; /originals/ is the full-size asset.
function bestUrls(pin) {
  const given = pin.imageUrl || pin.thumbnailUrl || "";
  if (!given) return [];
  const orig = given.replace(/\/\d+x(\d+)?\//, "/originals/");
  return orig !== given ? [orig, given] : [given];
}

async function ingestOne(collection, pin, query) {
  for (const src of bestUrls(pin)) {
    try {
      const res = await fetch(src, { signal: AbortSignal.timeout(30_000) });
      if (!res.ok) continue;
      const buf = Buffer.from(await res.arrayBuffer());
      const meta = await sharp(buf).metadata();
      if ((meta.width ?? 0) < MIN_SOURCE_W || (meta.height ?? 0) < MIN_SOURCE_H) continue;

      const jpeg = await sharp(buf)
        .resize(TARGET_W, TARGET_H, { fit: "cover", position: "attention" })
        .jpeg({ quality: 84 })
        .toBuffer();

      const path = `${collection}/pin-${pin.pinId}.jpg`;
      const up = await fetch(`${BASE}/storage/v1/object/library/${path}`, {
        method: "POST",
        headers: { ...H, "Content-Type": "image/jpeg", "x-upsert": "true" },
        body: jpeg,
      });
      if (!up.ok) throw new Error(`upload failed ${up.status}: ${await up.text()}`);

      const row = {
        collection,
        path,
        url: `${BASE}/storage/v1/object/public/library/${path}`,
        width: TARGET_W,
        height: TARGET_H,
        source: "pinterest",
        source_id: String(pin.pinId),
        source_url: pin.pinUrl ?? "",
        photographer: pin.creatorName ?? pin.creator?.name ?? "",
        alt: `${pin.title ?? ""} ${pin.description ?? ""}`.trim().slice(0, 300),
        query,
        source_w: meta.width ?? 0,
        source_h: meta.height ?? 0,
        avg_color: pin.dominantColor ?? "",
      };
      const ins = await fetch(`${BASE}/rest/v1/library_images?on_conflict=source,source_id`, {
        method: "POST",
        headers: { ...H, "Content-Type": "application/json", Prefer: "resolution=merge-duplicates" },
        body: JSON.stringify([row]),
      });
      if (!ins.ok) throw new Error(`row insert failed ${ins.status}: ${await ins.text()}`);
      return true;
    } catch (e) {
      if (String(e).includes("failed")) throw e;
      // download/decode issue — try the next URL variant
    }
  }
  return false;
}

let grandTotal = 0;
for (const [collection, queries] of Object.entries(QUERIES)) {
  if (ONLY && !ONLY.includes(collection)) continue;
  const have = await existingIds(collection);
  // Heavy overfetch: only ~30% of pins survive the size floor (measured on the
  // first gym run) — pins are billed at ~$0.0002 so scraping 3.5x is pennies.
  const perQuery = Math.min(500, Math.ceil((PER_NICHE * 3.5) / queries.length));
  console.log(`\n── ${collection}: have ${have.size}, want +${Math.max(0, PER_NICHE - have.size)} (scraping ${queries.length} queries × ${perQuery})`);
  if (have.size >= PER_NICHE) continue;

  // One sync Apify run per query — a whole collection in one run blows the
  // 240s sync-endpoint timeout. A failed query logs and skips, not aborts.
  const pins = [];
  for (const q of queries) {
    try {
      const batch = await scrape([q], perQuery);
      pins.push(...batch);
      console.log(`   "${q}": ${batch.length} pins`);
    } catch (e) {
      console.error(`   "${q}" failed: ${e.message.slice(0, 120)}`);
    }
  }
  console.log(`   scraped ${pins.length} pins`);
  let added = 0;
  for (const pin of pins) {
    if (have.size + added >= PER_NICHE) break;
    if (!pin?.pinId || have.has(String(pin.pinId))) continue;
    have.add(String(pin.pinId));
    try {
      if (await ingestOne(collection, pin, pin.searchQuery ?? pin.query ?? "")) {
        added++;
        if (added % 20 === 0) console.log(`   +${added}`);
      }
    } catch (e) {
      console.error(`   ${pin.pinId}: ${e.message}`);
    }
  }
  grandTotal += added;
  console.log(`   ${collection} done: +${added}`);
}
console.log(`\nIngested ${grandTotal} Pinterest images total.`);
