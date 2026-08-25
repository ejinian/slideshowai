// Zero-cost check on trend-blueprint selection: no OpenAI, no generation, no
// credits — just the real fetchTrendBlueprint against the live corpus, drawn
// repeatedly so the sampling is visible.
//
//   npx tsx --env-file=.env.local scripts/check-blueprints.ts [draws]
//
// What good looks like after the 2026-08-24 sampling change (docs/hook-scoring.md):
//   • several distinct posts per niche, not the same one every draw
//   • no [photo_dump] / [sentiment] / [engagement_bait] / [product_promo] shapes
import { createClient } from "@supabase/supabase-js";
import { fetchTrendBlueprint } from "../lib/generate/trendBlueprints";

const DRAWS = Number(process.argv[2]) || 30;
const NICHES = ["gym", "food", "cafe", "fashion", "beauty", "ecommerce", "realestate"];

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY;
if (!url || !key) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SECRET_KEY — pass --env-file=.env.local");
  process.exit(1);
}
const sb = createClient(url, key);

(async () => {
  for (const niche of NICHES) {
    const seen = new Map<string, number>();
    let hook: string | null = null;
    for (let i = 0; i < DRAWS; i++) {
      const bp = await fetchTrendBlueprint(sb, niche);
      const k = bp ? `${bp.author} [${bp.shape ?? "unknown"}]` : "(null — no blueprint)";
      seen.set(k, (seen.get(k) ?? 0) + 1);
      if (bp && !hook) hook = bp.format.exemplarCaption ?? null;
    }
    console.log(`\n=== ${niche} — ${DRAWS} draws, ${seen.size} distinct ===`);
    for (const [k, v] of [...seen.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${String(v).padStart(3)}x  ${k}`);
    }
    if (hook) console.log(`  sample hook: ${JSON.stringify(hook.slice(0, 80))}`);
  }
})();
