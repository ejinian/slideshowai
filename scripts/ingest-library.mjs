// Background-library ingest: Pexels search → 1080x1920 center-crop JPEG →
// `library` Storage bucket → library_images row (with license provenance).
//
//   node scripts/ingest-library.mjs                          # all collections, 1000 each
//   node scripts/ingest-library.mjs --per-niche=400          # smaller first run
//   node scripts/ingest-library.mjs --collections=gym,food   # subset
//
// Resumable: already-ingested photos (by pexels id) are skipped, so re-running
// tops collections up. Pexels API: 200 requests/hour — searches are paced and
// image downloads hit their CDN directly (not rate-limited).
// Requires: PEXELS_API_KEY, NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY in
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
const PEXELS = env.PEXELS_API_KEY;
const BASE = env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = env.SUPABASE_SECRET_KEY;
if (!PEXELS) {
  console.error("PEXELS_API_KEY missing from .env.local — get one free at pexels.com/api");
  process.exit(1);
}
const H = { apikey: KEY, Authorization: `Bearer ${KEY}` };

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    return m ? [m[1], m[2] ?? true] : [a, true];
  }),
);
const PER_NICHE = parseInt(args["per-niche"] ?? "1000", 10);
const ONLY = args.collections ? String(args.collections).split(",") : null;
// --backfill-meta: don't ingest anything new; re-walk the search queries and
// write alt/query/source dims onto EXISTING rows (needs the 20260714100000
// migration). Efficient: one search request covers 80 already-known photos.
const BACKFILL = Boolean(args["backfill-meta"]);

// Sources smaller than the export crop look soft/upscaled — skip them.
const MIN_SOURCE_W = 1080;
const MIN_SOURCE_H = 1440;

// ~15 queries per collection. Specific beats generic: the goal is a set that
// feels curated for TikTok slideshow backgrounds, not a pile of stock clichés.
const QUERIES = {
  gym: [
    "gym interior dark", "barbell close up", "dumbbells rack", "woman lifting weights",
    "man deadlift", "gym locker room", "running track sunrise", "boxing gym",
    "kettlebell workout", "gym chalk hands", "crossfit training", "treadmill gym",
    "muscle back workout", "gym mirror selfie aesthetic", "fitness silhouette",
  ],
  food: [
    "restaurant plating", "burger close up", "ramen bowl", "pasta dish dark",
    "chef cooking flames", "brunch table", "sushi platter", "street food market",
    "pizza oven fire", "dessert plating fine dining", "tacos close up",
    "restaurant interior moody", "steak searing", "food photography dark background", "cocktail bar drinks",
  ],
  fashion: [
    "fashion editorial", "streetwear outfit", "clothing rack boutique", "sneakers close up",
    "model portrait fashion", "denim texture", "handbag luxury", "fashion week street style",
    "minimalist outfit", "vintage clothing store", "sunglasses portrait",
    "tailor suit detail", "fashion flat lay", "runway model", "jewelry close up",
  ],
  realestate: [
    "modern house exterior", "living room interior design", "kitchen marble modern",
    "bedroom cozy interior", "house pool backyard", "apartment city view",
    "front door entrance home", "bathroom modern interior", "home office interior",
    "staircase design interior", "balcony view sunset", "luxury villa",
    "cabin exterior woods", "dining room interior", "keys door home",
  ],
  beauty: [
    "skincare products flat lay", "woman applying skincare", "makeup brushes close up",
    "lipstick swatch", "face serum dropper", "spa towels candles", "nail art close up",
    "perfume bottle aesthetic", "makeup mirror lights", "face mask skincare",
    "eyeshadow palette", "glowing skin portrait", "bath products aesthetic",
    "cosmetics pink background", "hair salon styling",
  ],
  luxury: [
    "luxury watch close up", "champagne glasses dark", "sports car night city",
    "private jet interior", "whiskey glass dark", "penthouse night view",
    "gold jewelry black background", "yacht deck sea", "designer suit cufflinks",
    "hotel lobby luxury", "diamond ring macro", "cigar lounge dark",
    "leather interior car", "rooftop pool night", "chess board dark aesthetic",
  ],
  cafe: [
    "latte art close up", "espresso machine barista", "coffee shop interior cozy",
    "croissant bakery", "pour over coffee", "cafe window seat", "coffee beans roasting",
    "matcha latte", "cafe counter pastries", "iced coffee aesthetic",
    "barista portrait", "coffee cup book cozy", "bakery display case",
    "cappuccino wooden table", "coffee shop neon sign",
  ],
  tech: [
    "laptop desk setup dark", "mechanical keyboard rgb", "smartphone close up",
    "headphones product shot", "code on screen", "gaming setup neon",
    "circuit board macro", "smartwatch wrist", "drone flying", "vr headset person",
    "server room", "tablet stylus design", "camera gear flat lay",
    "usb cables minimal", "robot technology",
  ],
  travel: [
    "tropical beach drone", "airplane window view", "hotel room ocean view",
    "mountain hiking sunrise", "city street night rain", "infinity pool resort",
    "suitcase packing flat lay", "temple asia travel", "desert road trip",
    "northern lights", "venice canals", "santorini greece", "tokyo street neon",
    "waterfall jungle", "campervan sunset",
  ],
};

const TARGET_W = 1080;
const TARGET_H = 1920;
const CONCURRENCY = 6;
const SEARCH_PAUSE_MS = 700; // stay well under 200 req/hr across the run

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function pexelsSearch(query, page) {
  for (;;) {
    const res = await fetch(
      `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&orientation=portrait&per_page=80&page=${page}`,
      { headers: { Authorization: PEXELS } },
    );
    if (res.status === 429) {
      console.log("  rate limited — waiting 60s");
      await sleep(60_000);
      continue;
    }
    if (!res.ok) throw new Error(`pexels ${res.status}: ${await res.text()}`);
    return res.json();
  }
}

async function existingIds(collection) {
  const ids = new Set();
  for (let from = 0; ; from += 1000) {
    const res = await fetch(
      `${BASE}/rest/v1/library_images?select=source_id&collection=eq.${collection}&limit=1000&offset=${from}`,
      { headers: H },
    );
    if (!res.ok) throw new Error(`library_images not readable (${res.status}) — run the 20260707140000 migration first.`);
    const rows = await res.json();
    rows.forEach((r) => ids.add(r.source_id));
    if (rows.length < 1000) break;
  }
  return ids;
}

// Descriptive metadata shared by ingest and backfill. `query` is the search
// string that surfaced the photo — with alt text, it's what the relevance
// ranker matches captions against (lib/generate/imageSelection.ts).
function metaFields(photo, query) {
  return {
    alt: (photo.alt ?? "").slice(0, 300),
    query,
    source_w: photo.width ?? 0,
    source_h: photo.height ?? 0,
    avg_color: photo.avg_color ?? "",
  };
}

async function ingestOne(collection, photo, query) {
  const src = photo.src?.original;
  if (!src) return false;
  // Quality floor: skip soft/upscaled sources smaller than the export crop.
  if ((photo.width ?? 0) < MIN_SOURCE_W || (photo.height ?? 0) < MIN_SOURCE_H) return false;
  const res = await fetch(`${src}?auto=compress&w=1600`, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) return false;
  const jpeg = await sharp(Buffer.from(await res.arrayBuffer()))
    .resize(TARGET_W, TARGET_H, { fit: "cover", position: "attention" })
    .jpeg({ quality: 84 })
    .toBuffer();

  const path = `${collection}/${photo.id}.jpg`;
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
    source: "pexels",
    source_id: String(photo.id),
    source_url: photo.url ?? "",
    photographer: photo.photographer ?? "",
    ...metaFields(photo, query),
  };
  const ins = await fetch(`${BASE}/rest/v1/library_images?on_conflict=source,source_id`, {
    method: "POST",
    headers: { ...H, "Content-Type": "application/json", Prefer: "resolution=merge-duplicates" },
    body: JSON.stringify([row]),
  });
  if (!ins.ok) throw new Error(`row insert failed ${ins.status}: ${await ins.text()}`);
  return true;
}

// PATCH metadata onto an existing row (backfill mode — no image re-upload).
async function backfillOne(collection, photo, query) {
  const res = await fetch(
    `${BASE}/rest/v1/library_images?source=eq.pexels&source_id=eq.${photo.id}&collection=eq.${collection}`,
    {
      method: "PATCH",
      headers: { ...H, "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify(metaFields(photo, query)),
    },
  );
  if (!res.ok) throw new Error(`meta patch failed ${res.status}: ${await res.text()}`);
  return true;
}

let grandTotal = 0;
for (const [collection, queries] of Object.entries(QUERIES)) {
  if (ONLY && !ONLY.includes(collection)) continue;
  const have = await existingIds(collection);
  let added = 0;

  if (BACKFILL) {
    // Re-walk the searches; write metadata onto rows we already own.
    console.log(`\n=== ${collection}: backfilling metadata for ${have.size} rows`);
    const done = new Set();
    for (const q of queries) {
      for (let page = 1; page <= 5; page++) {
        const data = await pexelsSearch(q, page);
        await sleep(SEARCH_PAUSE_MS);
        const known = (data.photos ?? []).filter(
          (p) => have.has(String(p.id)) && !done.has(String(p.id)),
        );
        const queue = [...known];
        await Promise.all(
          Array.from({ length: CONCURRENCY }, async () => {
            for (;;) {
              const p = queue.shift();
              if (!p) return;
              try {
                await backfillOne(collection, p, q);
                done.add(String(p.id));
                added++;
              } catch (e) {
                console.log(`  skip ${p.id}: ${e.message.slice(0, 80)}`);
              }
            }
          }),
        );
        if (!data.next_page) break;
      }
      console.log(`  "${q}" → ${added}/${have.size} backfilled`);
    }
    grandTotal += added;
    console.log(`=== ${collection}: ${added}/${have.size} rows got metadata`);
    continue;
  }

  const target = Math.max(0, PER_NICHE - have.size);
  console.log(`\n=== ${collection}: have ${have.size}, targeting +${target}`);
  if (target === 0) continue;

  const perQuery = Math.ceil(target / queries.length);
  for (const q of queries) {
    if (added >= target) break;
    let got = 0;
    for (let page = 1; page <= 5 && got < perQuery && added < target; page++) {
      const data = await pexelsSearch(q, page);
      await sleep(SEARCH_PAUSE_MS);
      const fresh = (data.photos ?? []).filter((p) => !have.has(String(p.id)));
      const queue = [...fresh];
      await Promise.all(
        Array.from({ length: CONCURRENCY }, async () => {
          for (;;) {
            const p = queue.shift();
            if (!p || added >= target) return;
            try {
              if (await ingestOne(collection, p, q)) {
                have.add(String(p.id));
                added++;
                got++;
              }
            } catch (e) {
              console.log(`  skip ${p.id}: ${e.message.slice(0, 80)}`);
            }
          }
        }),
      );
      if (!data.next_page) break;
    }
    console.log(`  "${q}" → ${added}/${target}`);
  }
  grandTotal += added;
  console.log(`=== ${collection}: +${added} (now ~${have.size})`);
}
console.log(`\nDONE — ${grandTotal} ${BACKFILL ? "rows backfilled" : "images ingested"} this run.`);
