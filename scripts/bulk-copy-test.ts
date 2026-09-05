// MASS COPY TEST — fire N decks through the REAL copy path and score them.
//
// WHY COPY-ONLY. Three of the four things we want to improve (AI-voice,
// virality shape, prompt adherence) live entirely in the caption text; only
// text PLACEMENT is a rendering concern. Images are also ~all of the cost and
// all of the latency: a stock deck runs a vision judge PER SLIDE. Skipping them
// makes a 30-deck sweep ~$1.60 and a couple of minutes instead of ~$5 and a
// long wait — so we can actually iterate on the prompts.
//
// It calls generateListicle() directly, the same function /api/generate calls,
// with the same trend exemplars / blueprint / register wiring the route builds.
// No HTTP, no auth, no credits, no DB writes.
//
//   npx tsx --env-file=.env.local scripts/bulk-copy-test.ts --n=30
//   npx tsx --env-file=.env.local scripts/bulk-copy-test.ts --n=6 --niche=gym
//
// Writes diagnostics/bulk/<stamp>/ — every prompt, every deck, and a REPORT.md
// with the mechanical scores aggregated.

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { generateListicle, type ListicleSlide } from "../lib/generate/listicle";
import { fetchTrendExemplars, exemplarsBlock } from "../lib/generate/trendExemplars";
import { fetchTrendBlueprint } from "../lib/generate/trendBlueprints";
import { fetchNicheRegister } from "../lib/generate/nicheRegister";
import { hookBankBlock } from "../lib/generate/hookBank";
import { scanDeckForAiLingo } from "../lib/generate/aiLingo";
import { resolveNiche } from "../lib/generate/nicheDetect";

const arg = (k: string, d = "") =>
  process.argv.find((a) => a.startsWith(`--${k}=`))?.split("=")[1] ?? d;
const has = (k: string) => process.argv.includes(`--${k}`);

const N = Number(arg("n", "10"));
const ONLY_NICHE = arg("niche");
const CONCURRENCY = Number(arg("concurrency", "4"));

/**
 * The test corpus. Deliberately spans niches and PROMPT SHAPES, because the
 * failures we have shipped were shape-specific, not topic-specific:
 * multi-part topics losing a part, vague subjects producing platitudes,
 * promotional prompts putting the brand in the hook, and questions never
 * getting answered. A corpus of only well-formed gym prompts would score well
 * and teach us nothing.
 */
const PROMPTS: { prompt: string; shape: string }[] = [
  // well-formed, specific — the happy path
  { prompt: "how to grow your arms with heavy dumbbell curls", shape: "specific" },
  { prompt: "5 beginner gym mistakes that stall your progress", shape: "specific-counted" },
  { prompt: "what to eat before a morning workout", shape: "specific" },
  { prompt: "how to get abs without doing endless crunches", shape: "specific" },
  // vague — the platitude trap
  { prompt: "my gym", shape: "vague" },
  { prompt: "fitness tips", shape: "vague" },
  { prompt: "cool cars", shape: "vague-offniche" },
  // multi-part — the coverage trap (run 69)
  { prompt: "how to lose fat with diet and exercise and what matters most", shape: "multi-part" },
  { prompt: "building muscle: training, food, and sleep", shape: "multi-part" },
  // question — must actually be answered
  { prompt: "is creatine actually worth taking", shape: "question" },
  { prompt: "why am i not getting stronger", shape: "question" },
  // promotional — brand must NOT be in the hook (run 63)
  { prompt: "Newman's Coffee is my brand, make a slideshow about it", shape: "promo" },
  { prompt: "promote my protein powder EdgeFuel", shape: "promo" },
  // other niches — is the machine general, or gym-shaped?
  { prompt: "3 espresso mistakes ruining your morning coffee", shape: "specific-offniche" },
  { prompt: "how to style baggy jeans for winter", shape: "specific-offniche" },
  { prompt: "what to look for when renting your first apartment", shape: "specific-offniche" },
  { prompt: "how to save money on groceries every week", shape: "specific-offniche" },
  { prompt: "why your skincare routine is not working", shape: "question-offniche" },
  { prompt: "best free apps for tracking your habits", shape: "specific-offniche" },
  { prompt: "how to take better photos with just your phone", shape: "specific-offniche" },
];

/* ── mechanical scorers — no model spend, so they can run on every deck ───── */

const FILLER = [
  "consistency is key", "consistency is what matters", "stay consistent",
  "game-changer", "level up", "unlock", "elevate", "the key is",
  "it's all about", "it all comes down to", "secret weapon", "must-have",
  "take it to the next level", "don't sleep on", "trust the process",
];

/** A caption a stranger cannot act on: no number, no named thing, no verb-first
 *  instruction. Deliberately a HEURISTIC — CLAUDE.md is explicit that
 *  specificity is judgement, not a quota — so this is reported as a rate to
 *  compare prompts against each other, never as a pass/fail on one slide. */
function isVague(text: string): boolean {
  const t = text.toLowerCase();
  if (/\d/.test(t)) return false;                       // any number
  if (/\b(grams?|g|lbs?|reps?|sets?|mins?|minutes?|weeks?|days?)\b/.test(t)) return false;
  return !/^(do|use|eat|swap|stop|start|add|drop|try|keep|hit|train|walk|take|set|put|pick|cut|skip)\b/.test(t);
}

interface DeckScore {
  slides: number;
  avgWords: number;
  maxWords: number;
  hookWords: number;
  hookHasNumber: boolean;
  youRate: number;         // share of slides addressing "you"
  vagueRate: number;       // share of slides with nothing actionable
  fillerHits: string[];
  aiLingoHits: string[];
  exclamations: number;
  titleCase: number;       // slides starting with a capital — voice rule says none
  topicOverlap: number;    // share of topic content-words appearing in the deck
}

const STOP = new Set("a an the and or of to for with your you my our in on at is are be how what why".split(" "));

function scoreDeck(deck: ListicleSlide[], topic: string): DeckScore {
  const texts = deck.map((s) => s.text ?? "").filter(Boolean);
  const words = texts.map((t) => t.trim().split(/\s+/).length);
  const hook = texts[0] ?? "";
  const joined = texts.join(" ").toLowerCase();

  const topicWords = topic
    .toLowerCase()
    .split(/\W+/)
    .filter((w) => w.length > 3 && !STOP.has(w));
  const covered = topicWords.filter((w) => joined.includes(w.slice(0, Math.max(4, w.length - 2))));

  return {
    slides: texts.length,
    avgWords: words.length ? +(words.reduce((a, b) => a + b, 0) / words.length).toFixed(1) : 0,
    maxWords: words.length ? Math.max(...words) : 0,
    hookWords: hook ? hook.trim().split(/\s+/).length : 0,
    hookHasNumber: /\d/.test(hook),
    youRate: texts.length ? +(texts.filter((t) => /\byou(r|rs)?\b/i.test(t)).length / texts.length).toFixed(2) : 0,
    vagueRate: texts.length ? +(texts.filter(isVague).length / texts.length).toFixed(2) : 0,
    fillerHits: FILLER.filter((f) => joined.includes(f)),
    aiLingoHits: scanDeckForAiLingo(deck).flatMap((h) => h.tells).slice(0, 5),
    exclamations: (joined.match(/!/g) ?? []).length,
    titleCase: texts.filter((t) => /^[A-Z]/.test(t.trim())).length,
    topicOverlap: topicWords.length ? +(covered.length / topicWords.length).toFixed(2) : 1,
  };
}

/* ── run ──────────────────────────────────────────────────────────────────── */

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error("Run with --env-file=.env.local");
  const supabase = createClient(url, key, { auth: { persistSession: false } });

  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const out = path.join(process.cwd(), "diagnostics", "bulk", stamp);
  await mkdir(out, { recursive: true });

  const jobs = Array.from({ length: N }, (_, i) => PROMPTS[i % PROMPTS.length])
    .filter((j) => !ONLY_NICHE || resolveNiche(undefined, j.prompt).slug === ONLY_NICHE);

  console.log(`${jobs.length} decks, concurrency ${CONCURRENCY}, judge=${has("judge")}\n`);

  const results: { i: number; prompt: string; shape: string; niche: string; deck: ListicleSlide[]; score: DeckScore }[] = [];
  let cursor = 0;
  let failed = 0;

  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, jobs.length) }, () =>
      (async () => {
        for (;;) {
          const i = cursor++;
          if (i >= jobs.length) return;
          const { prompt, shape } = jobs[i];
          const { slug: nicheSlug, label: niche } = resolveNiche(undefined, prompt);
          try {
            // Same inputs the route assembles, so this measures the real thing.
            const [exemplarRows, blueprint, register] = await Promise.all([
              fetchTrendExemplars(supabase, nicheSlug, 8).catch(() => null),
              fetchTrendBlueprint(supabase, nicheSlug).catch(() => null),
              fetchNicheRegister(supabase, nicheSlug).catch(() => null),
            ]);
            const decks = await generateListicle({
              niche,
              description: prompt,
              slideCount: 6,
              slideshowCount: 1,
              exemplars: exemplarRows ? exemplarsBlock(exemplarRows) : "",
              hooks: hookBankBlock(),
              format: blueprint?.format ?? null,
              register,
              detail: "short",
            });
            const deck = decks[0];
            results.push({ i, prompt, shape, niche, deck, score: scoreDeck(deck, prompt) });
            console.log(`  ${String(i + 1).padStart(2)}. [${niche}] ${deck[0]?.text ?? "(no hook)"}`);
          } catch (e) {
            failed++;
            console.log(`  ${String(i + 1).padStart(2)}. FAILED — ${e instanceof Error ? e.message : e}`);
          }
        }
      })(),
    ),
  );

  results.sort((a, b) => a.i - b.i);
  await writeFile(path.join(out, "decks.json"), JSON.stringify(results, null, 2));

  // ── report ──
  const s = results.map((r) => r.score);
  const avg = (f: (x: DeckScore) => number) =>
    s.length ? +(s.reduce((a, x) => a + f(x), 0) / s.length).toFixed(2) : 0;
  const pct = (f: (x: DeckScore) => boolean) =>
    s.length ? Math.round((s.filter(f).length / s.length) * 100) : 0;

  const byShape = new Map<string, DeckScore[]>();
  for (const r of results) {
    byShape.set(r.shape, [...(byShape.get(r.shape) ?? []), r.score]);
  }

  const lines = [
    `# Bulk copy test — ${results.length} decks (${failed} failed)`,
    ``,
    `Copy path only: no images, no DB writes, no credits. Same exemplars /`,
    `blueprint / register the route assembles.`,
    ``,
    `## Aggregate`,
    ``,
    `| Metric | Value | What it tells us |`,
    `|---|---|---|`,
    `| avg words/slide | ${avg((x) => x.avgWords)} | register adherence |`,
    `| max words seen | ${Math.max(...s.map((x) => x.maxWords), 0)} | cap leaks |`,
    `| avg hook words | ${avg((x) => x.hookWords)} | hook length |`,
    `| hooks with a number | ${pct((x) => x.hookHasNumber)}% | listicle monoculture |`,
    `| avg "you" rate | ${avg((x) => x.youRate)} | lecture tone |`,
    `| avg VAGUE rate | ${avg((x) => x.vagueRate)} | **the value doctrine, measured** |`,
    `| decks w/ filler | ${pct((x) => x.fillerHits.length > 0)}% | cliché leakage |`,
    `| decks w/ aiLingo | ${pct((x) => x.aiLingoHits.length > 0)}% | tell taxonomy hits |`,
    `| decks w/ "!" | ${pct((x) => x.exclamations > 0)}% | banned outside showcase |`,
    `| decks w/ Capitalised slide | ${pct((x) => x.titleCase > 0)}% | lowercase rule leaks |`,
    `| avg topic overlap | ${avg((x) => x.topicOverlap)} | **prompt adherence** |`,
    ``,
    `## By prompt shape`,
    ``,
    `| Shape | n | vague | topic overlap | avg words |`,
    `|---|---|---|---|---|`,
    ...[...byShape.entries()].map(([shape, arr]) => {
      const a = (f: (x: DeckScore) => number) =>
        +(arr.reduce((t, x) => t + f(x), 0) / arr.length).toFixed(2);
      return `| ${shape} | ${arr.length} | ${a((x) => x.vagueRate)} | ${a((x) => x.topicOverlap)} | ${a((x) => x.avgWords)} |`;
    }),
    ``,
    `## Every deck`,
    ``,
    ...results.flatMap((r) => [
      `### ${r.i + 1}. [${r.niche} · ${r.shape}] "${r.prompt}"`,
      `vague ${r.score.vagueRate} · overlap ${r.score.topicOverlap} · ${r.score.avgWords}w avg` +
        (r.score.fillerHits.length ? ` · FILLER: ${r.score.fillerHits.join(", ")}` : "") +
        (r.score.aiLingoHits.length ? ` · AI-LINGO: ${r.score.aiLingoHits.join(", ")}` : ""),
      ``,
      ...r.deck.map((sl, k) => `${k + 1}. ${sl.text}${sl.body ? `\n   > ${sl.body.replace(/\n/g, " ")}` : ""}`),
      ``,
    ]),
  ];

  await writeFile(path.join(out, "REPORT.md"), lines.join("\n"));
  console.log(`\nWrote ${out}/REPORT.md`);
  console.log(`vague ${avg((x) => x.vagueRate)} · overlap ${avg((x) => x.topicOverlap)} · numbered hooks ${pct((x) => x.hookHasNumber)}%`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
