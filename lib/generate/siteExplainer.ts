import sharp from "sharp";
import { tryCopyModel } from "./copyModel";
import { DISPLAY_FAMILY, MONO_FAMILY } from "./fonts";
import { SLIDE_W } from "./layout";
import type { RunLogger } from "./diagnostics";
import {
  ART_BOTTOM,
  CONTENT_W,
  PAD,
  TOP,
  esc,
  finishSlide,
  footer,
  headline,
  measure,
  monoText,
  placeArt,
  plain,
  roundedRect,
  themeFrom,
  wrap,
  type Ctx,
  type ExplainerDeck,
  type Theme,
} from "./productExplainer";
import { siteShortName, websiteFacts, type Website } from "./website";
import { backdropTheme, logBackdrop, startBackdrop } from "./higgsfield";

// SITE EXPLAINER — the designed carousel a website link produces.
//
// The product explainer's sibling (same canvas, Anton headlines with one
// accent word, Space Mono detail, fact cards — the "MEET LOOSEY GOOSEY"
// reference deck), built for a business instead of a packshot: the site's own
// photos are rounded cards, and a GALLERY slide puts four of them in a grid,
// each with the fact that belongs to it ("$1,460,000 · calabasas · aug 2026").
//
// Like the product deck, every word is baked into the background and the live
// captions are empty. Two things are mechanical rather than asked for:
//   • every NUMBER on a slide must appear in the site's own text — a card,
//     stat or bullet carrying an unverifiable number is dropped, and an
//     unverifiable number in a headline fails the lane (the photo + caption
//     deck is the fallback);
//   • the hook never names the business.

type SiteKind = "hook" | "idea" | "gallery" | "grid" | "stats" | "cta";

interface RawCard {
  title: string;
  meta: string;
  body: string;
  photo: number;
}
interface RawSlide {
  kind: SiteKind;
  headline: string;
  accent: string;
  sub: string;
  bullets: { lead: string; rest: string }[];
  cards: RawCard[];
  stats: { value: string; label: string }[];
  pill: string;
  photo: number;
}

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["slides"],
  properties: {
    slides: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["kind", "headline", "accent", "sub", "bullets", "cards", "stats", "pill", "photo"],
        properties: {
          kind: { type: "string", enum: ["hook", "idea", "gallery", "grid", "stats", "cta"] },
          headline: { type: "string" },
          accent: { type: "string" },
          sub: { type: "string" },
          bullets: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["lead", "rest"],
              properties: { lead: { type: "string" }, rest: { type: "string" } },
            },
          },
          cards: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["title", "meta", "body", "photo"],
              properties: {
                title: { type: "string" },
                meta: { type: "string" },
                body: { type: "string" },
                photo: { type: "integer" },
              },
            },
          },
          stats: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["value", "label"],
              properties: { value: { type: "string" }, label: { type: "string" } },
            },
          },
          pill: { type: "string" },
          photo: { type: "integer" },
        },
      },
    },
  },
} as const;

/**
 * Numbers worth a stats card: prices, percentages, counts of 2+ digits — not
 * years, not "02 / Experience" section numbers. A site with fewer than three
 * gets no stats slide (the model would have nothing true to put on it).
 */
export function richNumberCount(text: string): number {
  const found = new Set<string>();
  for (const m of text.matchAll(/\$[\d,]+(?:\.\d+)?|\b\d+(?:\.\d+)?%|\b[1-9]\d{1,2}(?:,\d{3})+\b|\b[1-9]\d+\+?(?![\d,])/g)) {
    const t = m[0];
    if (/^(19|20)\d\d$/.test(t)) continue;
    found.add(t);
  }
  return found.size;
}

/**
 * Slide kinds for a deck of N, given what the site can actually fill. A
 * GALLERY needs four unused photos (two at a pinch); a portfolio with one
 * headshot gets text-only fact GRIDS instead — the 2026-10-07 amitai.tech run
 * had 2,700 characters of real copy and one photo, and the old plan (a
 * gallery whatever the photo count) failed the whole lane into a 2-slide
 * fallback deck. STATS only when the site states numbers.
 */
function planKinds(count: number, photos: number, numbers: number): SiteKind[] {
  const n = Math.min(Math.max(count, 3), 10);
  let spare = Math.max(0, photos - 1); // the hook takes one
  const dataSlide = (): SiteKind => {
    if (spare >= 4) {
      spare -= 4;
      return "gallery";
    }
    if (spare >= 2 && spare < 4) {
      spare = 0;
      return "gallery";
    }
    return "grid";
  };
  if (n === 3) return ["hook", dataSlide(), "cta"];
  const middle: SiteKind[] = ["idea", dataSlide()];
  if (numbers >= 3) middle.push("stats");
  while (middle.length < n - 2) {
    // Two data slides in a row earn a second "idea" break (at most two).
    const ideas = middle.filter((k) => k === "idea").length;
    const lastTwoData = middle.slice(-2).every((k) => k === "grid" || k === "gallery");
    middle.push(ideas < 2 && lastTwoData ? "idea" : dataSlide());
  }
  return ["hook", ...middle.slice(0, n - 2), "cta"];
}

const SYSTEM =
  "You write the text for a designed carousel about a real local business, built " +
  "from its own website: dark slides, a big condensed UPPERCASE headline with one " +
  "accent word, small monospaced detail text, fact cards with the business's own " +
  "photos. The register is a person laying out what this business actually does " +
  "and has done, plainly — curious, a little dry, never an ad voice. Lowercase for " +
  "all detail text; the headline is rendered uppercase automatically, so write it " +
  "in normal case.\n" +
  "HARD RULES:\n" +
  "• FACTS ONLY. Every claim comes from the WEBSITE FACTS or a photo's label. " +
  "Never invent prices, numbers, dates, reviews, ratings, awards, years or " +
  "places. Every number you write must be copied EXACTLY as the facts write it " +
  "(\"$1,460,000\", never \"$1.46M\"); a slide carrying a number that is not in " +
  "the facts is thrown away.\n" +
  "• REAL RESULTS BEAT SLOGANS. A slogan lifted from the site ('personal " +
  "representation', 'two generations, one commitment') is ad copy — at most one " +
  "in the whole deck. Prefer concrete things: what sold, for how much, where, how " +
  "big, what they offer.\n" +
  "• HEADLINES: 2-6 words, no punctuation except a question mark on the CTA, and " +
  "`accent` is ONE word (or two adjacent words) copied exactly from the headline.\n" +
  "• NO emoji, no arrows, no special symbols — plain ASCII letters, digits, " +
  "commas, periods, apostrophes, parentheses, hyphens, $ and the dot separator ' · '.\n" +
  "• The HOOK headline never names the business. It names the most striking real " +
  "result or the category ('what $2,080,000 buys in calabasas', 'homes we sold " +
  "this year'). The business's name appears from slide 2 on.\n" +
  "• PHOTOS are numbered; a photo's label (when given) is what it shows and the " +
  "fact it belongs to. Use each photo ONCE across the deck. A card about a " +
  "labelled photo states THAT photo's fact, never another's. Never use a photo " +
  "that is a logo, a graphic or mostly text.\n" +
  "• Per slide kind:\n" +
  "  hook    — headline + `sub`: one casual line, 6-12 words, how you came across " +
  "them (e.g. 'found this father-son team's site. swipe') + `photo`: the most " +
  "striking photo.\n" +
  "  idea    — headline like 'meet <name>' + `sub` ('here's what they do') + 3-4 " +
  "`bullets` {lead: 2-4 words, the fact} {rest: up to 8 words, plain context} + " +
  "`photo`.\n" +
  "  gallery — headline (e.g. 'just sold', 'on the market now') + EXACTLY 4 " +
  "`cards` (or 2 if fewer photos are left), each about ONE photo: {photo: its " +
  "number} {title: the ONE fact people would screenshot, 1-3 words — for a " +
  "sale or a listing that is the PRICE ('$1,460,000'), otherwise the name} {meta: " +
  "2-5 words of detail, e.g. 'calabasas · aug 24, 2026'} {body: 2-5 words, e.g. " +
  "the street or '4 bed · 2 bath'}.\n" +
  "  grid    — headline (e.g. 'what i build', 'what they offer') + EXACTLY 4 " +
  "`cards` WITHOUT photos (photo -1): {title: 1-3 words, a name or the fact} " +
  "{meta: 2-5 words of detail, e.g. 'cto · practiceai'} {body: 2-5 words, what " +
  "it is or what it did}. Four different concrete things from the facts.\n" +
  "  stats   — headline (e.g. 'the numbers') + 2 `stats` {value: a number copied " +
  "from the facts, e.g. '$2,080,000' or '12'} {label: 2-5 words, what it is} + " +
  "optional `sub` (one line) + `photo`.\n" +
  "  cta     — headline (e.g. 'want a home like this?') + `pill`: 3-7 words telling " +
  "people how to reach them ('dm us', 'call raz · 818-612-8283', 'link in bio') " +
  "+ `sub`: one short line, e.g. the website domain + `photo`.\n" +
  "Fields a kind does not use must be \"\", [] or -1.";

// ---------------------------------------------------------------------------
// Number guard
// ---------------------------------------------------------------------------

const digits = (s: string) => s.replace(/[,$\s]/g, "");

function numbersIn(text: string): string[] {
  return (text.match(/\d[\d,]*(?:\.\d+)?/g) ?? []).map(digits);
}

/** Every number in `text` appears in the facts. */
function verified(text: string, factDigits: string): boolean {
  return numbersIn(text).every((n) => factDigits.includes(n));
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

async function photoCard(
  ctx: Ctx,
  photo: Buffer,
  x: number,
  y: number,
  w: number,
  h: number,
  radius: number,
  roundBottom = true,
): Promise<void> {
  const r = radius;
  const shape = roundBottom
    ? `<rect width="${w}" height="${h}" rx="${r}" ry="${r}" fill="#fff"/>`
    : `<path d="M0 ${r} Q0 0 ${r} 0 H${w - r} Q${w} 0 ${w} ${r} V${h} H0 Z" fill="#fff"/>`;
  const mask = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">${shape}</svg>`);
  const card = await sharp(photo)
    .resize(w, h, { fit: "cover", position: "attention" })
    .composite([{ input: mask, blend: "dest-in" }])
    .png()
    .toBuffer();
  ctx.layers.push({ input: card, left: Math.round(x), top: Math.round(y) });
}

function fitDisplay(text: string, start: number, maxW: number, min: number): number {
  let size = start;
  while (measure(text, DISPLAY_FAMILY, size) > maxW && size > min) size -= 4;
  return size;
}

async function renderSlide(
  slide: RawSlide,
  index: number,
  total: number,
  theme: Theme,
  photos: Buffer[],
  backdrop: Buffer | null = null,
): Promise<Buffer> {
  const ctx: Ctx = { theme, svg: [], layers: [], backdrop };
  const sub = plain(slide.sub, 90).toLowerCase();
  const hero = slide.photo >= 0 ? (photos[slide.photo] ?? null) : null;
  const art = { cutout: null, photo: hero };

  switch (slide.kind) {
    case "hook": {
      let y = headline(ctx, slide.headline, slide.accent, TOP, 3);
      if (sub) {
        y += 36;
        const lines = wrap(sub, MONO_FAMILY, 30, CONTENT_W).slice(0, 2);
        lines.forEach((ln, li) => monoText(ctx, PAD, y + li * 42, ln, 30, theme.muted));
        y += (lines.length - 1) * 42;
      }
      await placeArt(ctx, art, { cx: SLIDE_W / 2, bottom: ART_BOTTOM, maxW: CONTENT_W, maxH: Math.min(1000, ART_BOTTOM - y - 90), native: true });
      break;
    }
    case "idea": {
      let y = headline(ctx, slide.headline, slide.accent, TOP, 2);
      if (sub) {
        y += 34;
        monoText(ctx, PAD, y, sub, 30, theme.muted);
      }
      y += 48;
      const bullets = slide.bullets
        .slice(0, 4)
        .map((b) => ({ lead: plain(b.lead, 40).toLowerCase(), rest: plain(b.rest, 80).toLowerCase() }))
        .filter((b) => b.lead);
      if (bullets.length) {
        const inner = CONTENT_W - 80;
        const size = 32, lh = 46;
        const rows = bullets.map((b) => wrap(b.rest ? `${b.lead} · ${b.rest}` : b.lead, MONO_FAMILY, size, inner));
        const cardH = 56 + rows.reduce((a, r) => a + r.length * lh + 24, 0);
        roundedRect(ctx, PAD, y, CONTENT_W, cardH, 28, theme.card, theme.stroke);
        let ty = y + 40 + Math.round(size * 0.8);
        rows.forEach((lines, bi) => {
          const lead = bullets[bi].lead;
          lines.forEach((ln, li) => {
            if (li === 0 && ln.toLowerCase().startsWith(lead)) {
              ctx.svg.push(
                `<text x="${PAD + 40}" y="${ty}" font-family="${MONO_FAMILY}" font-size="${size}"><tspan font-weight="bold" fill="${theme.accent}">${esc(lead)}</tspan><tspan fill="${theme.muted}">${esc(ln.slice(lead.length))}</tspan></text>`,
              );
            } else monoText(ctx, PAD + 40, ty, ln, size, theme.muted);
            ty += lh;
          });
          ty += 24;
        });
        y += cardH;
      }
      await placeArt(ctx, art, { cx: SLIDE_W / 2, bottom: ART_BOTTOM, maxW: CONTENT_W, maxH: ART_BOTTOM - y - 60, native: true });
      break;
    }
    case "grid": {
      // Text-only fact cards (no photos) — what a site with few photos gets.
      let y = headline(ctx, slide.headline, slide.accent, TOP, 2);
      y += 56;
      const cards = slide.cards.slice(0, 4);
      const gap = 24, cw = (CONTENT_W - gap) / 2, ch = 360;
      cards.forEach((c, i) => {
        const cx = PAD + (i % 2) * (cw + gap);
        const cy = y + Math.floor(i / 2) * (ch + gap);
        roundedRect(ctx, cx, cy, cw, ch, 24, theme.card, theme.stroke);
        const title = wrap(plain(c.title, 30).toUpperCase(), DISPLAY_FAMILY, 54, cw - 64).slice(0, 2);
        const ts = title.length > 1 ? 50 : fitDisplay(title[0] ?? "", 58, cw - 64, 34);
        title.forEach((ln, li) =>
          ctx.svg.push(
            `<text x="${cx + 32}" y="${cy + 36 + Math.round(ts * 0.86) + li * Math.round(ts * 0.95)}" font-family="${DISPLAY_FAMILY}" font-size="${ts}" fill="${theme.accent}">${esc(ln)}</text>`,
          ),
        );
        const metaY = cy + 36 + Math.round(ts * 0.86) + (title.length - 1) * Math.round(ts * 0.95) + 40;
        wrap(plain(c.meta, 44).toLowerCase(), MONO_FAMILY, 24, cw - 64)
          .slice(0, 2)
          .forEach((ln, li) => monoText(ctx, cx + 32, metaY + li * 32, ln, 24, theme.muted));
        const body = wrap(plain(c.body, 60).toLowerCase(), MONO_FAMILY, 29, cw - 64).slice(0, 3);
        const by = cy + ch - 36 - (body.length - 1) * 38;
        body.forEach((ln, li) => monoText(ctx, cx + 32, by + li * 38, ln, 29, theme.text));
      });
      break;
    }
    case "gallery": {
      let y = headline(ctx, slide.headline, slide.accent, TOP, 2);
      y += 56;
      const cards = slide.cards.filter((c) => photos[c.photo]).slice(0, 4);
      const n = cards.length >= 4 ? 4 : Math.min(2, cards.length);
      const gap = 24, cw = (CONTENT_W - gap) / 2;
      const rowsN = n === 4 ? 2 : 1;
      const avail = ART_BOTTOM - y;
      const ch = Math.min(rowsN === 2 ? 520 : 760, Math.floor((avail - (rowsN - 1) * gap) / rowsN));
      const photoH = Math.round(ch * (rowsN === 2 ? 0.5 : 0.62));
      for (let i = 0; i < n; i++) {
        const c = cards[i];
        const cx = PAD + (i % 2) * (cw + gap);
        const cy = y + Math.floor(i / 2) * (ch + gap);
        roundedRect(ctx, cx, cy, cw, ch, 24, theme.card, theme.stroke);
        await photoCard(ctx, photos[c.photo], cx + 1, cy + 1, Math.round(cw - 2), photoH, 23, false);
        const title = plain(c.title, 24).toUpperCase();
        const ts = fitDisplay(title, 58, cw - 56, 32);
        const tY = cy + photoH + 24 + Math.round(ts * 0.86);
        ctx.svg.push(
          `<text x="${cx + 28}" y="${tY}" font-family="${DISPLAY_FAMILY}" font-size="${ts}" fill="${theme.accent}">${esc(title)}</text>`,
        );
        const meta = wrap(plain(c.meta, 40).toLowerCase(), MONO_FAMILY, 23, cw - 56).slice(0, 2);
        meta.forEach((ln, li) => monoText(ctx, cx + 28, tY + 38 + li * 30, ln, 23, theme.muted));
        const body = wrap(plain(c.body, 50).toLowerCase(), MONO_FAMILY, 27, cw - 56).slice(0, 2);
        const by = cy + ch - 30 - (body.length - 1) * 36;
        body.forEach((ln, li) => monoText(ctx, cx + 28, by + li * 36, ln, 27, theme.text));
      }
      break;
    }
    case "stats": {
      let y = headline(ctx, slide.headline, slide.accent, TOP, 2);
      y += 56;
      const stats = slide.stats.slice(0, 2);
      const gap = 24, n = Math.max(1, stats.length);
      const cw = n === 1 ? 640 : (CONTENT_W - gap) / 2, chh = 320;
      const x0 = n === 1 ? Math.round((SLIDE_W - cw) / 2) : PAD;
      stats.forEach((s, i) => {
        const cx = x0 + i * (cw + gap);
        roundedRect(ctx, cx, y, cw, chh, 28, theme.card, theme.stroke);
        const value = plain(s.value, 16).toUpperCase();
        const vs = fitDisplay(value, 150, cw - 64, 60);
        const vy = y + 60 + Math.round(vs * 0.86);
        ctx.svg.push(
          `<text x="${cx + cw / 2}" y="${vy}" text-anchor="middle" font-family="${DISPLAY_FAMILY}" font-size="${vs}" fill="${theme.accent}">${esc(value)}</text>`,
        );
        wrap(plain(s.label, 40).toLowerCase(), MONO_FAMILY, 27, cw - 64)
          .slice(0, 2)
          .forEach((ln, li) => monoText(ctx, cx + cw / 2, vy + 60 + li * 36, ln, 27, theme.muted, "normal", "middle"));
      });
      y += stats.length ? chh + 40 : 0;
      if (sub) {
        let ss = 26;
        while (measure(sub, MONO_FAMILY, ss) > CONTENT_W - 64 && ss > 18) ss -= 1;
        const w = Math.min(CONTENT_W, measure(sub, MONO_FAMILY, ss) + 64);
        roundedRect(ctx, Math.round((SLIDE_W - w) / 2), y, Math.round(w), 60, 30, "transparent", theme.stroke);
        monoText(ctx, SLIDE_W / 2, y + 39, sub, ss, theme.text, "normal", "middle");
        y += 60;
      }
      await placeArt(ctx, art, { cx: SLIDE_W / 2, bottom: ART_BOTTOM, maxW: CONTENT_W, maxH: ART_BOTTOM - y - 60, native: true });
      break;
    }
    case "cta": {
      let y = headline(ctx, slide.headline, slide.accent, TOP, 2);
      y += 44;
      const pill = plain(slide.pill, 60).toLowerCase();
      if (pill) {
        let ps = 32;
        while (measure(pill, MONO_FAMILY, ps, "bold") > CONTENT_W - 48 && ps > 22) ps -= 2;
        const pw = Math.round(measure(pill, MONO_FAMILY, ps, "bold") + 56);
        roundedRect(ctx, PAD, y, pw, 70, 35, theme.accent);
        monoText(ctx, PAD + 28, y + 46, pill, ps, "#0b0f0a", "bold");
        y += 70;
      }
      if (sub) {
        y += 44;
        monoText(ctx, PAD, y, sub, 28, theme.muted);
      }
      await placeArt(ctx, art, { cx: SLIDE_W / 2, bottom: ART_BOTTOM, maxW: CONTENT_W, maxH: Math.min(1000, ART_BOTTOM - y - 80), native: true });
      break;
    }
  }
  footer(ctx, index, total);
  return finishSlide(ctx);
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export async function generateSiteExplainer(
  site: Website,
  photos: Buffer[],
  labels: (string | null)[],
  count: number,
  angle: string,
  diag?: RunLogger | null,
  /** Local experiments: a backdrop image to use instead of calling Higgsfield. */
  opts: { backdrop?: Buffer | null } = {},
): Promise<ExplainerDeck | null> {
  const cm = tryCopyModel({ timeoutMs: 60_000 });
  if (!cm || photos.length === 0) return null;
  // Higgsfield experiment (off unless HIGGSFIELD_ART=on locally): one
  // generated backdrop for the deck, started now so it runs alongside the
  // copy call. The site's own photos are never sent to it.
  const backdropJob = startBackdrop(
    [site.name, site.description, site.text.slice(0, 600)].filter(Boolean).join(". "),
    opts.backdrop,
  ).catch(() => null);
  const kinds = planKinds(count, photos.length, richNumberCount(websiteFacts(site)));
  const name = siteShortName(site);
  const factBlob = [websiteFacts(site), ...labels.filter(Boolean)].join("\n");
  const factDigits = digits(factBlob);

  const thumbs = await Promise.all(
    photos.map((b) => sharp(b).resize({ width: 384, withoutEnlargement: true }).jpeg({ quality: 62 }).toBuffer()),
  );
  const content: Array<
    | { type: "text"; text: string }
    | { type: "image_url"; image_url: { url: string; detail: "low" } }
  > = [
    {
      type: "text",
      text:
        (angle.trim() ? `THE CREATOR'S ANGLE (their own words, keep the spirit): ${plain(angle, 200)}\n\n` : "") +
        `WEBSITE FACTS (the only source of truth):\n${websiteFacts(site)}\n\n` +
        `Write EXACTLY ${kinds.length} slides, in this order of kinds: ${kinds.join(", ")}.\n` +
        `The business's name for slides 2+: "${name}".\n` +
        `PHOTOS (${photos.length}, numbered 0..${photos.length - 1}):`,
    },
  ];
  thumbs.forEach((t, i) => {
    const label = labels[i]?.replace(/\s+/g, " ").trim();
    content.push({ type: "text", text: label ? `Photo ${i} — label: "${label}"` : `Photo ${i}:` });
    content.push({ type: "image_url", image_url: { url: `data:image/jpeg;base64,${t.toString("base64")}`, detail: "low" } });
  });

  let raw: RawSlide[];
  try {
    const completion = await cm.client.chat.completions.create({
      model: cm.model,
      temperature: 0.7,
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content },
      ],
      response_format: { type: "json_schema", json_schema: { name: "site_explainer", strict: true, schema: SCHEMA } },
    });
    const text = completion.choices[0]?.message?.content ?? "{}";
    if (diag) await diag.text("03_site_explainer_raw.json", text);
    raw = (JSON.parse(text) as { slides?: RawSlide[] }).slides ?? [];
  } catch (e) {
    if (diag) await diag.text("03_site_explainer_raw.json", `MODEL CALL FAILED: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }
  if (raw.length === 0) return null;

  const dropped: string[] = [];
  const okNum = (where: string, t: string) => {
    if (verified(t, factDigits)) return true;
    dropped.push(`${where}: "${t}"`);
    return false;
  };
  const validPhoto = (p: unknown) => (Number.isInteger(p) && (p as number) >= 0 && (p as number) < photos.length ? (p as number) : -1);

  // Force the planned structure; keep the model's text by position, minus
  // anything carrying a number the site never states.
  const slides: RawSlide[] = kinds.map((kind, i) => {
    const r = raw[i];
    return {
      kind,
      headline: plain(r?.headline ?? "", 60),
      accent: plain(r?.accent ?? "", 30),
      sub: okNum(`slide ${i + 1} sub`, r?.sub ?? "") ? (r?.sub ?? "") : "",
      bullets: (Array.isArray(r?.bullets) ? r.bullets : []).filter((b) => okNum(`slide ${i + 1} bullet`, `${b.lead} ${b.rest}`)),
      cards: (Array.isArray(r?.cards) ? r.cards : [])
        .map((c) => ({ ...c, photo: validPhoto(c.photo) }))
        .filter((c) => okNum(`slide ${i + 1} card`, `${c.title} ${c.meta} ${c.body}`)),
      stats: (Array.isArray(r?.stats) ? r.stats : []).filter((s) => numbersIn(s.value).length > 0 && okNum(`slide ${i + 1} stat`, `${s.value} ${s.label}`)),
      pill: okNum(`slide ${i + 1} pill`, r?.pill ?? "") ? (r?.pill ?? "") : "",
      photo: validPhoto(r?.photo),
    };
  });
  if (slides.some((s) => !s.headline)) return null;
  // A headline is the slide; an invented number there fails the whole lane.
  if (slides.some((s, i) => !okNum(`slide ${i + 1} headline`, s.headline))) {
    if (diag) await diag.json("03_site_explainer.json", { failed: "unverified number in a headline", dropped });
    return null;
  }
  // The hook never names the business.
  const nameWords = name.split(/\s+/).filter((w) => w.length >= 3 && !/^(the|and|team|group|co|inc|llc)$/i.test(w));
  for (const w of nameWords) {
    if (slides[0].headline.toLowerCase().includes(w)) {
      slides[0].headline = slides[0].headline.replace(new RegExp(w, "ig"), "").replace(/\s{2,}/g, " ").trim();
    }
  }
  if (!slides[0].headline) return null;

  // Photos: one use per deck where possible. Gallery cards fill from unused
  // photos; a hero slot that repeats a used photo takes an unused one.
  const used = new Set<number>();
  const nextUnused = () => {
    for (let i = 0; i < photos.length; i++) if (!used.has(i)) return i;
    return -1;
  };
  for (const s of slides) {
    if (s.kind === "gallery") {
      const seen = new Set<number>();
      s.cards = s.cards.filter((c) => {
        if (c.photo < 0 || used.has(c.photo) || seen.has(c.photo)) return false;
        seen.add(c.photo);
        return true;
      });
      s.cards.forEach((c) => used.add(c.photo));
    }
  }
  for (const s of slides) {
    if (s.kind === "gallery") continue;
    if (s.kind === "grid") {
      s.photo = -1;
      continue;
    }
    if (s.photo < 0 || used.has(s.photo)) {
      const u = nextUnused();
      // Out of photos: the hook always gets one, the CTA reuses the hook's
      // (a personal site's one headshot opens and closes the deck), and an
      // idea/stats slide simply renders without art.
      s.photo =
        u >= 0
          ? u
          : s.kind === "hook"
            ? (s.photo >= 0 ? s.photo : 0)
            : s.kind === "cta"
              ? slides[0].photo
              : -1;
    }
    if (s.photo >= 0) used.add(s.photo);
  }
  // A stats slide whose every number failed verification has nothing on it.
  const emptyStats = slides.filter((s) => s.kind === "stats" && s.stats.length === 0);
  if (emptyStats.length) {
    dropped.push(`removed ${emptyStats.length} stats slide(s) with no verified number`);
    slides.splice(0, slides.length, ...slides.filter((s) => !emptyStats.includes(s)));
  }
  // A text grid needs at least two cards to read as a grid.
  if (slides.some((s) => s.kind === "grid" && s.cards.length < 2)) {
    if (diag) await diag.json("03_site_explainer.json", { failed: "grid with < 2 cards", slides, dropped });
    return null;
  }
  // A gallery with fewer than 2 usable cards is not a gallery.
  if (slides.some((s) => s.kind === "gallery" && s.cards.length < 2)) {
    if (diag) await diag.json("03_site_explainer.json", { failed: "gallery with < 2 usable cards", slides, dropped });
    return null;
  }

  const bd = await backdropJob;
  await logBackdrop(diag, bd);
  // The hook photo sets the hue either way — the art changes the canvas, not
  // the deck's colour (a desaturated backdrop fell back to default green).
  const photoTheme = await themeFrom(photos[slides[0].photo] ?? photos[0]);
  const theme = bd?.image ? backdropTheme(photoTheme) : photoTheme;
  const backgrounds: Buffer[] = [];
  for (let i = 0; i < slides.length; i++) {
    backgrounds.push(await renderSlide(slides[i], i, slides.length, theme, photos, bd?.image ?? null));
  }

  const lines = slides.map((s) =>
    [
      s.headline,
      s.sub,
      ...s.bullets.map((b) => `${b.lead} ${b.rest}`),
      ...s.cards.map((c) => `${c.title}: ${c.meta} ${c.body}`),
      ...s.stats.map((st) => `${st.value} ${st.label}`),
      s.pill,
    ]
      .map((t) => plain(t ?? "", 120))
      .filter(Boolean)
      .join(" · "),
  );

  if (diag) {
    await diag.json("03_site_explainer.json", {
      note: "SITE EXPLAINER — designed slides from a website; all text baked into the backgrounds, live captions empty.",
      model: cm.label,
      kinds,
      theme,
      slides,
      droppedForUnverifiedNumbers: dropped,
    });
  }

  return {
    backgrounds,
    slides: slides.map((s, i) => ({
      role: i === 0 ? "title" : s.kind === "cta" ? "cta" : "reason",
      number: null,
      text: "",
      imageKeywords: [],
    })),
    title: slides[0].headline.toLowerCase(),
    lines,
    theme,
    model: cm.label,
    kinds: slides.map((s) => (s.kind === "gallery" ? "grid" : s.kind === "stats" ? "price" : s.kind)),
  };
}
