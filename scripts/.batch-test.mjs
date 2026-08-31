// Copy-only batch test: 9 prompts x short+long through the REAL production
// path (niche detect -> trend exemplars -> blueprint -> generateListicle).
// No images, no billing — just the text, dumped as JSON for review.
import { writeFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";
const { resolveNiche } = await import("../lib/generate/nicheDetect.ts");
const { fetchTrendExemplars, exemplarsBlock } = await import("../lib/generate/trendExemplars.ts");
const { fetchTrendBlueprint } = await import("../lib/generate/trendBlueprints.ts");
const { hookBankBlock } = await import("../lib/generate/hookBank.ts");
const { generateListicle } = await import("../lib/generate/listicle.ts");

const PROMPTS = [
  "mistakes that are stalling your arm growth",
  "how to actually meal prep for the week without hating it",
  "espresso drinks to order when you hate bitter coffee",
  "how to build outfits that look expensive on a budget",
  "the skincare routine order most people get wrong",
  "why your product photos are killing your sales",
  "red flags to look for before renting an apartment",
  "a focus app that blocks tiktok until you finish your work",
  "why you should journal before bed", // "other" niche — no trend steering
];

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);
const results = [];
for (const prompt of PROMPTS) {
  const { slug, label } = resolveNiche(undefined, prompt);
  const ex = await fetchTrendExemplars(sb, slug, 8);
  const exemplars = exemplarsBlock(ex);
  const bp = await fetchTrendBlueprint(sb, slug);
  const hooks = hookBankBlock(true);
  for (const detail of ["short", "long"]) {
    const t0 = Date.now();
    try {
      const decks = await generateListicle({
        niche: label, description: prompt, slideCount: 6, slideshowCount: 1,
        exemplars, hooks, format: bp?.format ?? null, detail,
      }, null);
      results.push({
        prompt, niche: label, detail,
        blueprint: bp ? { author: bp.author, shape: bp.shape } : null,
        secs: Math.round((Date.now() - t0) / 1000),
        slides: decks[0].map((s) => ({ text: s.text, body: s.body ?? null })),
      });
      console.log(`ok  ${label.padEnd(18)} ${detail.padEnd(5)} ${prompt.slice(0, 40)}`);
    } catch (e) {
      results.push({ prompt, niche: label, detail, error: String(e).slice(0, 200) });
      console.log(`ERR ${label} ${detail} ${prompt.slice(0, 40)}: ${String(e).slice(0, 80)}`);
    }
  }
}
await writeFile("diagnostics/batch-test.json", JSON.stringify(results, null, 1));
console.log("wrote diagnostics/batch-test.json —", results.length, "decks");
