// Render a website-link designed deck locally, without the app or a login —
// for the Higgsfield backdrop experiment (lib/generate/higgsfield.ts).
//
//   npx tsx --env-file=.env.local scripts/try-site-deck.mts <url> [--standin] [--plain]
//
// Backdrop source:
//   default    Higgsfield Soul, when HIGGSFIELD_ART=on + HIGGSFIELD_API_KEY_ID/SECRET
//              are set (otherwise the deck renders on the plain gradient)
//   --standin  same scene prompt through OpenAI gpt-image-1 — previews the look
//              with no Higgsfield key
//   --plain    force the plain gradient (the shipped look) for a side-by-side
//
// Output: diagnostics/site-deck-preview/<host>[-plain|-standin].jpg (contact
// sheet) + <host>-backdrop.jpg. Spends ~2-6¢ of OpenAI per run, plus one
// Higgsfield generation when that path is used.
import { mkdirSync, writeFileSync } from "node:fs";
import OpenAI from "openai";
import sharp from "sharp";
import { fetchWebsite, downloadSiteImages, photoFact } from "../lib/generate/website.ts";
import { generateSiteExplainer } from "../lib/generate/siteExplainer.ts";
import { backdropPrompt, generateBackdrop, higgsfieldEnabled } from "../lib/generate/higgsfield.ts";

const args = process.argv.slice(2);
const url = args.find((a) => !a.startsWith("--"));
if (!url) {
  console.error("usage: npx tsx --env-file=.env.local scripts/try-site-deck.mts <url> [--standin] [--plain]");
  process.exit(1);
}
const standin = args.includes("--standin");
const plain = args.includes("--plain");

const r = await fetchWebsite(url);
if (!r.ok) {
  console.error("could not read the site:", r.error);
  process.exit(1);
}
const photos = await downloadSiteImages(r.site, 14);
console.log(`${r.site.name} · ${r.site.domain} · ${photos.length} photos`);

const subject = [r.site.name, r.site.description, r.site.text.slice(0, 600)].filter(Boolean).join(". ");
let backdrop: Buffer | null = null;
if (!plain) {
  if (standin) {
    const prompt = await backdropPrompt(subject);
    console.log("scene prompt:", prompt);
    const img = await new OpenAI().images.generate({ model: "gpt-image-1", prompt, size: "1024x1536", quality: "medium" });
    backdrop = Buffer.from(img.data![0].b64_json!, "base64");
  } else if (higgsfieldEnabled()) {
    const prompt = await backdropPrompt(subject);
    console.log("scene prompt:", prompt);
    const bd = await generateBackdrop(prompt);
    console.log(`higgsfield: ${bd.status} in ${bd.ms}ms${bd.error ? ` — ${bd.error}` : ""}`);
    backdrop = bd.image;
  } else {
    console.log("Higgsfield is off (set HIGGSFIELD_ART=on + key id/secret) — rendering the plain look. Use --standin to preview without a key.");
  }
}

const deck = await generateSiteExplainer(
  r.site,
  photos.map((p) => p.buffer),
  photos.map((p) => photoFact(r.site, p.alt)),
  6,
  "",
  null,
  { backdrop },
);
if (!deck) {
  console.error("the designed lane failed for this site (the app would fall back to the photos + captions deck)");
  process.exit(1);
}

const dir = "diagnostics/site-deck-preview";
mkdirSync(dir, { recursive: true });
const tag = `${r.site.domain}${plain ? "-plain" : standin ? "-standin" : backdrop ? "-higgsfield" : "-plain"}`;
const tiles = await Promise.all(deck.backgrounds.map((b) => sharp(b).resize(360, 640).toBuffer()));
const rows = Math.ceil(tiles.length / 3);
await sharp({ create: { width: 370 * 3, height: 660 * rows, channels: 3, background: "#222" } })
  .composite(tiles.map((t, i) => ({ input: t, left: (i % 3) * 370, top: Math.floor(i / 3) * 660 })))
  .jpeg({ quality: 88 })
  .toFile(`${dir}/${tag}.jpg`);
if (backdrop) writeFileSync(`${dir}/${r.site.domain}-backdrop.jpg`, await sharp(backdrop).jpeg().toBuffer());
console.log(`wrote ${dir}/${tag}.jpg — "${deck.title}"`);
