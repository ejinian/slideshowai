// Build the fine-tuning set for the LEAN copy model from the transcribed
// trend corpus (trending_posts.slide_texts).
//
//   node scripts/build-finetune-set.mjs            # label + write JSONL
//   node scripts/build-finetune-set.mjs --dry      # no model calls, counts only
//
// Why: 24k characters of rules could not make the copy model sound like a
// real creator — rules subtract, they don't add. ~700 real transcribed decks
// can teach register and specificity directly. Each deck gets a labeler pass
// (gpt-4.1-mini, structured output) that (a) decides whether it is a deck a
// creator could have typed a topic for — value, story, listicle, how-to — and
// not engagement bait / lyrics / a "Slideshow idea!" template / a photo dump,
// and (b) infers that topic, phrased the way a user types it into the box.
//
// Output (gitignored, under diagnostics/finetune/):
//   labeled.jsonl   every row + verdict, for inspection
//   train.jsonl     OpenAI chat-format examples (90%)
//   valid.jsonl     held-out 10%
// The system prompt is lib/generate/leanSystem.json — the SAME string the
// runtime sends (lib/generate/leanCopy.ts), which is what makes the tune apply.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import OpenAI from "openai";

const env = Object.fromEntries(
  readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split("\n")
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "")]),
);
const DRY = process.argv.includes("--dry");
const OUT = new URL("../diagnostics/finetune/", import.meta.url);
mkdirSync(OUT, { recursive: true });

const { system: SYSTEM } = JSON.parse(
  readFileSync(new URL("../lib/generate/leanSystem.json", import.meta.url), "utf8"),
);

const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY);
const openai = new OpenAI({ apiKey: env.OPENAI_API_KEY });

// Emoji bake as tofu in our renderer, so the model must never learn to write
// them. Strip at the corpus boundary (same rule as exemplarsBlock).
const EMOJI = /[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu;
const clean = (t) => t.replace(EMOJI, "").replace(/[^\S\n]{2,}/g, " ").trim();

async function fetchAll() {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb
      .from("trending_posts")
      .select("id,niche,title,slide_texts,views,views_per_hour,author")
      .not("slide_texts", "is", null)
      .order("id")
      .range(from, from + 999);
    if (error) throw error;
    rows.push(...data);
    if (data.length < 1000) break;
  }
  return rows;
}

const LABEL_SYSTEM =
  "You curate real TikTok photo slideshows into a training set for a caption writer. " +
  "You see one post's on-slide text, slide by slide, plus its description.\n" +
  "keep=true for a deck a creator could have typed a short topic for and then " +
  "written: advice, a how-to, a listicle, a comparison, a before/after, a product " +
  "breakdown, a blunt opinion. MOST real decks are SHORT — 2-8 words a slide, one " +
  "point each, no sentences — and those are exactly what we want; a deck is a keep " +
  "as long as its slides each make a point a viewer can use. Length is never a reason " +
  "to drop.\n" +
  "keep=false ONLY for: engagement bait (\"Slideshow idea!\", \"i treated you\"), " +
  "song lyrics, a template someone fills with photos, captions that only label " +
  "photos (\"pic of me as a kid\"), pure hype with no content, fewer than 2 slides " +
  "of text, or obviously garbled transcription.\n" +
  "topic: what that creator would have typed into a 'what is your slideshow about' " +
  "box before writing it — 4-12 plain words, lowercase, specific (\"how i grew my " +
  "arms as a skinny beginner\", not \"fitness tips\"). Never a hashtag, never the " +
  "hook itself copied.";

const LABEL_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["keep", "topic", "why"],
  properties: {
    keep: { type: "boolean" },
    topic: { type: "string" },
    why: { type: "string" },
  },
};

async function label(row, texts) {
  const res = await openai.chat.completions.create({
    model: "gpt-4.1-mini",
    temperature: 0,
    messages: [
      { role: "system", content: LABEL_SYSTEM },
      {
        role: "user",
        content:
          `Niche bucket: ${row.niche}\nDescription: ${clean(row.title ?? "").slice(0, 200) || "(none)"}\n` +
          `Slides:\n` +
          texts.map((t, i) => `${i + 1}. ${t}`).join("\n"),
      },
    ],
    response_format: {
      type: "json_schema",
      json_schema: { name: "deck_label", strict: true, schema: LABEL_SCHEMA },
    },
  });
  return JSON.parse(res.choices[0]?.message?.content ?? "{}");
}

async function pool(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: n }, async () => {
      for (;;) {
        const k = i++;
        if (k >= items.length) return;
        out[k] = await fn(items[k], k);
      }
    }),
  );
  return out;
}

const rows = await fetchAll();
const decks = rows
  .map((r) => ({
    row: r,
    texts: (Array.isArray(r.slide_texts) ? r.slide_texts : [])
      .map((t) => (typeof t === "string" ? clean(t) : ""))
      .filter((t) => t.length > 0)
      .map((t) => t.slice(0, 600)),
  }))
  .filter((d) => d.texts.length >= 2 && d.texts.length <= 10);
console.log(`rows ${rows.length} → decks with ≥2 text slides: ${decks.length}`);
if (DRY) process.exit(0);

let done = 0;
const labeled = await pool(decks, 8, async (d) => {
  let v;
  try {
    v = await label(d.row, d.texts);
  } catch (e) {
    v = { keep: false, topic: "", why: `label error: ${e.message}` };
  }
  done++;
  if (done % 50 === 0) console.log(`labeled ${done}/${decks.length}`);
  return { id: d.row.id, niche: d.row.niche, views: d.row.views, texts: d.texts, ...v };
});

writeFileSync(new URL("labeled.jsonl", OUT), labeled.map((l) => JSON.stringify(l)).join("\n") + "\n");
const kept = labeled.filter((l) => l.keep && l.topic && l.topic.length >= 8);
console.log(`kept ${kept.length} of ${labeled.length}`);
const byNiche = {};
for (const k of kept) byNiche[k.niche] = (byNiche[k.niche] ?? 0) + 1;
console.log(byNiche);

// Deterministic shuffle → 90/10 split.
const seeded = kept
  .map((k, i) => ({ k, s: Math.sin(i * 9301 + 49297) }))
  .sort((a, b) => a.s - b.s)
  .map((x) => x.k);
const example = (k) => ({
  messages: [
    { role: "system", content: SYSTEM },
    { role: "user", content: `Topic: ${k.topic}\nSlides: ${k.texts.length}` },
    { role: "assistant", content: JSON.stringify({ slides: k.texts }) },
  ],
});
const cut = Math.floor(seeded.length * 0.9);
writeFileSync(new URL("train.jsonl", OUT), seeded.slice(0, cut).map((k) => JSON.stringify(example(k))).join("\n") + "\n");
writeFileSync(new URL("valid.jsonl", OUT), seeded.slice(cut).map((k) => JSON.stringify(example(k))).join("\n") + "\n");
const tokens = seeded.reduce((a, k) => a + (SYSTEM.length + k.topic.length + k.texts.join("").length) / 4, 0);
console.log(`train ${cut}, valid ${seeded.length - cut}, ~${Math.round(tokens / 1000)}k tokens/epoch`);
console.log("sample kept:");
for (const k of seeded.slice(0, 3)) console.log(`  [${k.niche}] ${k.topic}\n    ${k.texts.join("\n    ")}`);
