import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { extractReadableText } from "./pageText";

// Product-page → structured product data. Server-only (does DNS + raw fetches
// against a URL the user typed, so it must never run in the browser).
//
// Three tiers, most-reliable first, measured against 14 live stores:
//   1. Shopify's public product JSON  — 7/9 stores, ~110-280ms, no API key
//   2. JSON-LD `Product` in the HTML  — 2/9 (Gymshark 403s tier 1), ~900ms
//   3. OpenGraph meta                 — last resort, always yields *something*
// One store in twelve (hiutdenim) publishes no structured data at all; that
// returns `no_product_data` and the UI falls back to "describe it yourself".

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

const TIMEOUT_MS = 12_000;
const MAX_REDIRECTS = 5;
const MAX_HTML_BYTES = 3_000_000; // heavy Shopify themes run ~90KB-1.5MB

export interface ProductData {
  tier: "shopify-json" | "json-ld" | "opengraph";
  url: string;
  title: string;
  description: string;
  vendor: string | null;
  productType: string | null;
  tags: string[];
  priceMin: number | null;
  priceMax: number | null;
  currency: string | null;
  inStock: boolean | null;
  optionNames: string[];
  images: string[];
  /** Selling copy read off the product page itself (theme sections, benefits). */
  pageText: string;
  /** The store homepage's positioning — brand context, never the subject. */
  brandText: string;
}

/** What a tier parser yields; the page/brand copy is added by extractProduct. */
type ProductCore = Omit<ProductData, "pageText" | "brandText">;

export type ExtractError =
  | "bad_url"
  | "blocked_host"
  | "unreachable"
  | "captcha"
  | "no_product_data";

export type ExtractResult =
  | ({ ok: true } & ProductData)
  | { ok: false; error: ExtractError; status?: number };

// ---------------------------------------------------------------------------
// SSRF: the URL is untrusted user input, so every hop is validated before we
// open a socket. Public DNS names that resolve to private space are the whole
// attack, hence the resolve-then-check rather than a string test on the host.
// ---------------------------------------------------------------------------

function isPrivateAddress(ip: string): boolean {
  if (isIP(ip) === 6) {
    const v6 = ip.toLowerCase();
    if (v6 === "::1" || v6 === "::") return true;
    if (v6.startsWith("fe80") || v6.startsWith("fc") || v6.startsWith("fd")) return true;
    // IPv4-mapped (::ffff:10.0.0.1) — unwrap and fall through to the v4 rules.
    const mapped = v6.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateAddress(mapped[1]);
    return false;
  }
  const p = ip.split(".").map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return true; // unparseable → refuse
  }
  const [a, b] = p;
  if (a === 10 || a === 127 || a === 0) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 169 && b === 254) return true; // link-local, incl. cloud metadata
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a >= 224) return true; // multicast + reserved
  return false;
}

async function assertPublicHost(u: URL): Promise<boolean> {
  if (u.protocol !== "https:" && u.protocol !== "http:") return false;
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host)) return !isPrivateAddress(host);
  if (/^(localhost|.*\.local|.*\.internal)$/i.test(host)) return false;
  try {
    const addrs = await lookup(host, { all: true });
    if (addrs.length === 0) return false;
    return addrs.every((a) => !isPrivateAddress(a.address));
  } catch {
    return false;
  }
}

/** Fetch with manual redirect handling so every hop gets the SSRF check. */
async function safeFetch(
  input: string,
): Promise<{ ok: boolean; status: number; body?: string; finalUrl: string; blocked?: boolean }> {
  let current: URL;
  try {
    current = new URL(input);
  } catch {
    return { ok: false, status: 0, finalUrl: input };
  }

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (!(await assertPublicHost(current))) {
      return { ok: false, status: 0, finalUrl: current.href, blocked: true };
    }
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(current.href, {
        signal: ctl.signal,
        redirect: "manual",
        headers: { "user-agent": UA, accept: "text/html,application/json,*/*" },
      });
    } catch {
      return { ok: false, status: 0, finalUrl: current.href };
    } finally {
      clearTimeout(timer);
    }

    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc) return { ok: false, status: res.status, finalUrl: current.href };
      try {
        current = new URL(loc, current);
      } catch {
        return { ok: false, status: res.status, finalUrl: current.href };
      }
      continue;
    }

    // Cap the read so a hostile/huge page can't exhaust memory. The body is
    // kept even on an error status: a 403 is exactly where the bot-wall markup
    // lives, and that's what tells us "blocked" rather than "broken".
    const buf = await res.arrayBuffer();
    const text = new TextDecoder().decode(
      buf.byteLength > MAX_HTML_BYTES ? buf.slice(0, MAX_HTML_BYTES) : buf,
    );
    return { ok: res.ok, status: res.status, body: text, finalUrl: current.href };
  }
  return { ok: false, status: 0, finalUrl: current.href };
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

export function stripHtml(s = ""): string {
  return s
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6])>/gi, "\n")
    .replace(/<li[^>]*>/gi, "• ")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&(#39|rsquo|lsquo);/g, "'")
    .replace(/&(quot|ldquo|rdquo);/g, '"')
    .replace(/&#\d+;/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

/** Shopify returns `tags` as an array on some stores, a comma string on others. */
function normalizeTags(tags: unknown): string[] {
  if (Array.isArray(tags)) return tags.map(String).filter(Boolean).slice(0, 20);
  return String(tags ?? "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 20);
}

interface ShopifyVariant { price?: string; available?: boolean }
interface ShopifyProduct {
  title?: string;
  body_html?: string;
  vendor?: string;
  product_type?: string;
  tags?: unknown;
  variants?: ShopifyVariant[];
  options?: Array<{ name?: string }>;
  images?: Array<{ src?: string }>;
}

async function tierShopifyJson(u: URL): Promise<ProductCore | null> {
  const m = u.pathname.match(/\/products\/([^/?#]+)/);
  if (!m) return null;
  const handle = m[1].replace(/\.json$/i, "");
  const res = await safeFetch(`${u.origin}/products/${handle}.json`);
  if (!res.ok || !res.body) return null;
  let p: ShopifyProduct | undefined;
  try {
    p = (JSON.parse(res.body) as { product?: ShopifyProduct }).product;
  } catch {
    return null;
  }
  if (!p?.title) return null;
  const variants = p.variants ?? [];
  const prices = variants.map((v) => Number(v.price)).filter((n) => n > 0);
  return {
    tier: "shopify-json",
    url: u.href,
    title: p.title,
    description: stripHtml(p.body_html ?? ""),
    vendor: p.vendor ?? null,
    productType: p.product_type ?? null,
    tags: normalizeTags(p.tags),
    priceMin: prices.length ? Math.min(...prices) : null,
    priceMax: prices.length ? Math.max(...prices) : null,
    currency: null,
    inStock: variants.length ? variants.some((v) => v.available !== false) : null,
    optionNames: (p.options ?? []).map((o) => o.name ?? "").filter(Boolean),
    images: (p.images ?? []).map((i) => i.src ?? "").filter(Boolean),
  };
}

type LdNode = Record<string, unknown>;

function collectProducts(node: unknown, out: LdNode[]): void {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    node.forEach((n) => collectProducts(n, out));
    return;
  }
  const obj = node as LdNode;
  const t = obj["@type"];
  const types = (Array.isArray(t) ? t : [t]).map(String);
  if (types.includes("Product")) out.push(obj);
  Object.values(obj).forEach((v) => collectProducts(v, out));
}

function tierJsonLd(html: string, url: string): ProductCore | null {
  const found: LdNode[] = [];
  const re =
    /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    try {
      collectProducts(JSON.parse(m[1].trim()), found);
    } catch {
      /* malformed block — skip */
    }
  }
  const p = found[0];
  if (!p) return null;
  const name = typeof p.name === "string" ? p.name : "";
  if (!name) return null;
  const rawOffers = p.offers;
  const offer = (Array.isArray(rawOffers) ? rawOffers[0] : rawOffers) as
    | LdNode
    | undefined;
  const brand = p.brand;
  const images = ([] as unknown[])
    .concat((p.image as unknown) ?? [])
    .map((i) => (typeof i === "string" ? i : (i as LdNode)?.url))
    .filter((s): s is string => typeof s === "string");
  const price = offer?.price != null ? Number(offer.price) : null;
  return {
    tier: "json-ld",
    url,
    title: name,
    description: stripHtml(typeof p.description === "string" ? p.description : ""),
    vendor:
      typeof brand === "string"
        ? brand
        : ((brand as LdNode | undefined)?.name as string) ?? null,
    productType: typeof p.category === "string" ? p.category : null,
    tags: [],
    priceMin: Number.isFinite(price) ? price : null,
    priceMax: Number.isFinite(price) ? price : null,
    currency: typeof offer?.priceCurrency === "string" ? offer.priceCurrency : null,
    inStock:
      typeof offer?.availability === "string"
        ? /InStock/i.test(offer.availability)
        : null,
    optionNames: [],
    images,
  };
}

function meta(html: string, prop: string): string | null {
  const esc = prop.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const a = new RegExp(
    `<meta[^>]+(?:property|name)=["']${esc}["'][^>]+content=["']([^"']+)["']`,
    "i",
  );
  const b = new RegExp(
    `<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${esc}["']`,
    "i",
  );
  return html.match(a)?.[1] ?? html.match(b)?.[1] ?? null;
}

function tierOpenGraph(html: string, url: string): ProductCore | null {
  const title = meta(html, "og:title");
  if (!title) return null;
  const raw = meta(html, "product:price:amount") ?? meta(html, "og:price:amount");
  const price = raw ? Number(raw) : null;
  return {
    tier: "opengraph",
    url,
    title,
    description: stripHtml(meta(html, "og:description") ?? ""),
    vendor: meta(html, "og:site_name"),
    productType: null,
    tags: [],
    priceMin: Number.isFinite(price) ? price : null,
    priceMax: Number.isFinite(price) ? price : null,
    currency:
      meta(html, "product:price:currency") ?? meta(html, "og:price:currency"),
    inStock: null,
    optionNames: [],
    images: [meta(html, "og:image")].filter((s): s is string => !!s),
  };
}

/**
 * Normalized identity for an image URL: the bare filename, minus query string
 * and size suffix.
 *
 * Keyed on the FILENAME rather than the whole URL because Shopify serves the
 * identical file from both `cdn.shopify.com` and the store's own domain, so a
 * full-URL key let every photo through twice.
 */
function imageKey(url: string): string {
  const name = (url.split("?")[0].split("/").pop() ?? "").toLowerCase();
  return name.replace(
    /[_-](?:pico|icon|thumb|small|compact|medium|large|grande|\d{2,4}x\d{0,4})(?:_crop_[a-z]+)?(\.[a-z]+)$/i,
    "$1",
  );
}

// A candidate must share at least this fraction of the anchor's filename, as a
// literal prefix, to count as the same product.
const SAME_PRODUCT_PREFIX = 0.75;

/** Filename, lowercased, without directory, extension or size suffix. */
function fileStem(url: string): string {
  return imageKey(url).replace(/\.[a-z0-9]+$/i, "");
}

/**
 * Keep only the harvested images that belong to the SAME product as `anchor`.
 *
 * A product page is full of other products — related-item carousels, nav tiles,
 * "you may also like" — so this has to be strict. Two weaker rules were tried
 * and both shipped wrong products into a deck:
 *   • "share a long token" pulled a backpack and a t-shirt into a tumbler's
 *     deck, because every file on that store is named DeathWishCoffee_July2026_*
 *     and a long token is a BRAND as easily as a product.
 *   • weighting tokens by rarity inverted on a page whose images are mostly ONE
 *     product: the identifying word looked like boilerplate and everything real
 *     was dropped.
 *
 * A shared literal prefix covering most of the name is the signal that survives
 * both: one product's photos differ only in a short trailing suffix
 * (`…-KBBL.A`, `…-KBBL.B`), while a different product diverges early.
 */
function sameProductCluster(anchor: string, candidates: string[]): string[] {
  const stem = fileStem(anchor);
  if (stem.length < 8) return [];
  return candidates.filter((c) => {
    const other = fileStem(c);
    let i = 0;
    while (i < stem.length && i < other.length && stem[i] === other[i]) i++;
    // Measured against the SHORTER name so a long suffix on one side can't
    // by itself sink an otherwise identical stem.
    return i / Math.min(stem.length, other.length) >= SAME_PRODUCT_PREFIX;
  });
}

// Chrome/theme furniture that lives on every page and is never the product.
const NOT_PRODUCT =
  /(logo|icon|favicon|sprite|badge|payment|visa|mastercard|paypal|amex|klarna|afterpay|flag|avatar|placeholder|swatch|loader|spinner|arrow|chevron|star-|rating|trustpilot|banner|newsletter)/i;

/**
 * Pull product photography out of raw HTML.
 *
 * Needed in two situations: a store whose products.json is blocked (JSON-LD
 * carries exactly ONE image, which cannot fill a deck), and a store whose
 * gallery is genuinely thin while the page itself shows more.
 *
 * Deliberately host-agnostic — an earlier version only matched cdn.shopify.com,
 * which finds nothing on a store served from its own CDN. Size-variant suffixes
 * are collapsed so ~20 renditions of one photo (`...A_ZH_ZH_1080x.jpg`) count
 * once; that collapse recovered 6 distinct photos on a store that 403s tier 1.
 */
function harvestImages(html: string, pageUrl: string): string[] {
  const out = new Map<string, { url: string; w: number }>();
  let origin = "";
  try {
    origin = new URL(pageUrl).origin;
  } catch {
    /* ignore */
  }

  const consider = (rawUrl: string) => {
    let abs = rawUrl.trim();
    if (!abs || abs.startsWith("data:")) return;
    if (abs.startsWith("//")) abs = `https:${abs}`;
    else if (abs.startsWith("/")) abs = origin ? `${origin}${abs}` : "";
    if (!/^https?:\/\//i.test(abs)) return;
    if (!/\.(jpe?g|png|webp)(\?|$)/i.test(abs)) return;
    if (NOT_PRODUCT.test(abs)) return;

    const clean = abs.split("?")[0];
    const base = clean.replace(
      /[_-](?:pico|icon|thumb|small|compact|medium|large|grande|\d{2,4}x\d{0,4})(?:_crop_[a-z]+)?(\.[a-z]+)$/i,
      "$1",
    );
    const w = Number(clean.match(/[_-](\d{2,4})x\d{0,4}\./)?.[1] ?? 0);
    const prev = out.get(base);
    if (!prev || w > prev.w) out.set(base, { url: w ? clean : base, w });
  };

  // src / data-src / content attributes
  for (const m of html.matchAll(
    /(?:\bsrc|\bdata-src|\bdata-original|\bcontent)\s*=\s*["']([^"']+)["']/gi,
  )) {
    consider(m[1]);
  }
  // srcset — take every candidate; the collapse above dedupes renditions
  for (const m of html.matchAll(/\bsrcsets?\s*=\s*["']([^"']+)["']/gi)) {
    for (const part of m[1].split(",")) consider(part.trim().split(/\s+/)[0]);
  }
  // Bare URLs inside inline JSON blobs (theme state, product JSON, etc.)
  for (const m of html.matchAll(
    /https?:\\?\/\\?\/[^"'\\\s)<>]+?\.(?:jpe?g|png|webp)/gi,
  )) {
    consider(m[0].replace(/\\\//g, "/"));
  }

  return [...out.values()].map((v) => v.url);
}

/**
 * Is this a bot wall rather than a product page?
 *
 * Two distinct walls in the wild: TikTok Shop serves its own captcha, and
 * Cloudflare-fronted sites (kalodata.com among them) answer 403 with a
 * "Just a moment…" interstitial. Both are unreadable by design, and saying so
 * is far more useful than "couldn't reach that page".
 */
function looksBlocked(html: string): boolean {
  return (
    /<title>\s*(Just a moment|Security Check|Verify|Access Denied|Attention Required)/i.test(
      html,
    ) ||
    /oec-ttweb-captcha|captcha\/index\.js/i.test(html) ||
    /cf-browser-verification|cf_chl_opt|challenge-platform/i.test(html)
  );
}

export async function extractProduct(input: string): Promise<ExtractResult> {
  let u: URL;
  try {
    u = new URL(input.trim());
  } catch {
    return { ok: false, error: "bad_url" };
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") {
    return { ok: false, error: "bad_url" };
  }
  if (!(await assertPublicHost(u))) return { ok: false, error: "blocked_host" };

  // Merge extra photos into a set of known-good ones, keeping only those that
  // look like the SAME product and dropping renditions we already have.
  const mergeImages = (known: string[], extra: string[]): string[] => {
    const anchor = known[0];
    if (!anchor) return [...new Map(extra.map((u) => [imageKey(u), u])).values()];
    const seen = new Map(known.map((u) => [imageKey(u), u]));
    for (const u of sameProductCluster(anchor, extra)) {
      const k = imageKey(u);
      if (!seen.has(k)) seen.set(k, u);
    }
    return [...seen.values()];
  };

  // The gallery API, the product page and the store homepage, together.
  //
  // The API alone is a poor description of the product — its body_html measured
  // anywhere from 1029 characters to ZERO across live stores, because the real
  // benefits and specs live in theme sections. So the page is always read as a
  // page too, and the homepage supplies the brand's own positioning. All three
  // in parallel: the two extra requests cost roughly nothing over the slowest.
  const homeUrl = `${u.origin}/`;
  const [viaJson, page, home] = await Promise.all([
    tierShopifyJson(u),
    safeFetch(u.href),
    safeFetch(homeUrl),
  ]);

  const pageText = page.body ? extractReadableText(page.body, { limit: 2500 }) : "";
  // Homepage: only real sentences of positioning, and far less of it — this is
  // voice/context, never the subject. Brand blurbs usually also sit in the
  // product page's footer sections, so drop anything already captured above
  // rather than paying for it twice.
  const seenLines = new Set(pageText.split("\n").map((l) => l.trim().toLowerCase()));
  const brandText = home.body
    ? extractReadableText(home.body, { limit: 500, minLine: 40 })
        .split("\n")
        .filter((l) => !seenLines.has(l.trim().toLowerCase()))
        .join("\n")
    : "";

  // Tier 1 — the authoritative gallery.
  //
  // Images are deliberately NOT supplemented from the page here. Scraping extra
  // photos in only ever guessed which ones belong to this product, and a wrong
  // guess puts a competitor's item in someone's ad. When a store publishes one
  // photo (Feastables ships exactly one for a bundle) that is the honest
  // answer, and the caller warns that stock will fill the rest of the deck.
  if (viaJson) return { ok: true, ...viaJson, pageText, brandText };

  if (page.blocked) return { ok: false, error: "blocked_host" };
  if (page.body && looksBlocked(page.body)) return { ok: false, error: "captcha" };
  if (!page.ok || !page.body) {
    return { ok: false, error: "unreachable", status: page.status };
  }

  const harvested = harvestImages(page.body, page.finalUrl);

  const viaLd = tierJsonLd(page.body, page.finalUrl);
  if (viaLd) {
    return {
      ok: true,
      ...viaLd,
      images: mergeImages(viaLd.images, harvested),
      pageText,
      brandText,
    };
  }
  const viaOg = tierOpenGraph(page.body, page.finalUrl);
  if (viaOg) {
    return {
      ok: true,
      ...viaOg,
      images: mergeImages(viaOg.images, harvested),
      pageText,
      brandText,
    };
  }
  return { ok: false, error: "no_product_data" };
}
