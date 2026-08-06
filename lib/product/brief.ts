import type { ProductData } from "./extract";

// Turn scraped product data into the TOPIC brief that /api/generate already
// takes. Deliberately deterministic and free — no second model call in the
// paste path, so attaching a link stays ~1s.
//
// Why this shape: a deck that is purely an ad gets scrolled past, so the brief
// does NOT ask for one. It asks for the value post that the product happens to
// answer — which is exactly the structure the existing pipeline is already
// tuned for (numbered hook → concrete value slides → soft CTA). What we add is
// the FACTS, because specificity is what separates a deck someone acts on from
// "premium quality, great design" (see the virality model in CLAUDE.md).

const MAX_DESC = 700;

function money(p: ProductData): string | null {
  if (p.priceMin == null) return null;
  const cur = p.currency === "USD" ? "$" : p.currency ? `${p.currency} ` : "$";
  const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2));
  if (p.priceMax != null && p.priceMax !== p.priceMin) {
    return `${cur}${fmt(p.priceMin)}–${cur}${fmt(p.priceMax)}`;
  }
  return `${cur}${fmt(p.priceMin)}`;
}

/**
 * The description is the least reliable field we scrape — measured anywhere
 * from 0 to 1029 characters. Trim it to the part that carries product facts and
 * drop the store's boilerplate tail (shipping, returns, care instructions),
 * which is pure noise to a caption model.
 */
function usefulDescription(raw: string): string {
  if (!raw) return "";
  const cleaned = raw
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .filter(
      (l) =>
        !/^(free |fast )?(shipping|returns?|delivery|exchanges?)\b/i.test(l) &&
        !/^(care|wash|machine wash|do not )/i.test(l) &&
        !/^(sku|upc|barcode|model no)/i.test(l),
    )
    .join(" ");
  return cleaned.length > MAX_DESC ? `${cleaned.slice(0, MAX_DESC).trimEnd()}…` : cleaned;
}

/**
 * The product's name as a person would say it out loud.
 *
 * Store titles carry merchandising furniture — pipe separators and parenthetical
 * variant tails ("Men's Cruiser - Shadow Blue (Natural White Sole)") — that read
 * as a SKU on a slide. The CTA needs something a viewer can actually remember
 * and search for.
 */
function shortName(title: string, vendor: string | null): string {
  let cleaned = title
    .replace(/\s*[|｜]\s*/g, " ")
    .replace(/\s*\([^)]*\)\s*$/, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  // Lead with the brand when the title alone doesn't carry it — "Calming
  // Pouches" is not a searchable thing, "Loosey Goosey Calming Pouches" is.
  if (vendor && !cleaned.toLowerCase().includes(vendor.toLowerCase())) {
    cleaned = `${vendor} ${cleaned}`;
  }
  return cleaned.length > 60 ? cleaned.slice(0, 60).trimEnd() : cleaned;
}

/**
 * Price phrased for a slide.
 *
 * A range must never reach the CTA as "$15–$100": the model rewrote that as
 * "$15, $100", which reads as broken on screen. Variant ranges become
 * "from $15", the way every store writes them.
 */
function ctaPrice(p: ProductData): string | null {
  if (p.priceMin == null) return null;
  const cur = p.currency === "USD" || !p.currency ? "$" : `${p.currency} `;
  const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2));
  return p.priceMax != null && p.priceMax !== p.priceMin
    ? `from ${cur}${fmt(p.priceMin)}`
    : `${cur}${fmt(p.priceMin)}`;
}

/** Bare host for the CTA ("looseygoosey.com"), or null if the URL is unusable. */
function storeDomain(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./i, "") || null;
  } catch {
    return null;
  }
}

/**
 * The short, high-signal line describing what this product IS.
 *
 * Exists solely to feed niche detection. `/api/generate` derives the niche with
 * a keyword vote over its prompt, which is fine for a sentence a human typed but
 * catastrophic against a 3.5k-character scraped brief: one incidental "workout"
 * in a page's marketing copy out-voted everything and routed a deck about
 * nic-free calming pouches to the GYM aesthetic pool, so all six slides came
 * back as gym pins. Only the title, category and the store's own one-line
 * description are trustworthy signal here — never the scraped page text.
 */
export function productTopicLine(p: ProductData): string {
  return [p.title, p.productType, p.vendor, p.description.slice(0, 200)]
    .filter(Boolean)
    .join(". ");
}

/** A compact, human-readable fact sheet — the raw material for specific slides. */
export function productFacts(p: ProductData): string {
  const bits: string[] = [`Product: ${p.title}`];
  if (p.vendor) bits.push(`Brand: ${p.vendor}`);
  if (p.productType) bits.push(`Category: ${p.productType}`);
  const price = money(p);
  if (price) bits.push(`Price: ${price}`);
  if (p.optionNames.length) bits.push(`Sold in: ${p.optionNames.join(", ")}`);
  if (p.inStock === false) bits.push("Currently out of stock");
  const desc = usefulDescription(p.description);
  if (desc) bits.push(`What the store says about it: ${desc}`);
  // The product page carries the benefits and specs the API leaves out — the
  // materials, the weights, the measurements. This is usually the richest
  // source of the concrete detail that makes a slide worth acting on.
  if (p.pageText) {
    bits.push(
      `From the product page (scraped, so it may include unrelated store text — ` +
        `use only what is clearly about this product, and ignore the rest):\n${p.pageText}`,
    );
  }
  if (p.brandText) {
    bits.push(
      `About the brand (background for tone only — the post is about the ` +
        `product, never about the company):\n${p.brandText}`,
    );
  }
  // Shopify `tags` are deliberately NOT used. Sampled across live stores they
  // are internal merchandising codes almost every time — "exclude_rebuy",
  // "hide reviews", "EC STOCK", "DNAM BRANDS", "OTG" — and a caption model
  // handed "DNAM BRANDS" will try to make it mean something.
  return bits.join("\n");
}

/**
 * The full topic brief handed to /api/generate as `prompt`. It lands in the
 * existing "TOPIC — what this WHOLE slideshow must be about:" slot, so it has
 * to read as a subject brief, not as instructions addressed to a user.
 */
export function buildProductBrief(p: ProductData, angle?: string): string {
  const name = p.title;
  const store = storeDomain(p.url);
  const cta = ctaPrice(p);
  const lines: string[] = [];

  lines.push(
    angle?.trim()
      ? `${angle.trim()} — built around a real product the creator sells: ${name}.`
      : `A post that makes someone want to buy ${name}.`,
  );

  lines.push(
    "",
    "Write it as a VALUE post, not an ad. Someone who never buys should still " +
      "finish it knowing something concrete and useful about this kind of product " +
      "— what to look for, what people get wrong, what actually matters. The " +
      `product is the answer the post arrives at, not the subject of every slide.`,
  );

  lines.push(
    "",
    "Use the real specifics below — the price, the materials, the numbers, the " +
      "actual use case. Never fall back on empty praise (\"premium quality\", " +
      "\"perfect for any occasion\", \"a must-have\"): those convert nobody. If a " +
      "fact is not given below, do not invent it — especially never invent " +
      "specs, claims, discounts or review counts.",
  );

  lines.push("", productFacts(p));

  // The closing instruction has to fight the generic CTA spec in listicle.ts
  // ("a short, soft call to action, e.g. 'follow for more' or 'link in bio'"),
  // which otherwise wins because it is the explicit per-slide structure. A CTA
  // that names nothing — "more about these in my bio" — wastes the one slide
  // whose entire job is converting: the viewer never learns WHAT to go buy.
  lines.push(
    "",
    `FINAL SLIDE — the call to action. LEAD with the product's name: ` +
      `"${shortName(name, p.vendor)}". A bare "link in bio" or "more about these ` +
      `in my bio" is a failed slide, because the viewer is left not knowing what ` +
      `to search for. Name it first, then say where to get it${
        store ? ` (${store})` : ""
      }. One short line.${
        cta ? ` You may add the price as exactly "${cta}" — never reword it.` : ""
      }`,
  );

  return lines.join("\n");
}
