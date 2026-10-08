import { assertPublicHost, stripHtml } from "@/lib/product/extract";

// Shopify link → the product it points at. Server-only (DNS + raw fetches
// against a URL the user typed; must never run in the browser).
//
// This is a READER. It returns product facts + photo URLs, and the generate
// route treats the photos exactly like user uploads (image-first captions).
// Nothing here writes copy, and the caption prompts don't know it exists —
// the one addition they see is a `productCta` on the request.
//
// Two shapes of link:
//   /products/<handle>  →  <store>/products/<handle>.json   (one product)
//   anything else       →  <store>/products.json            (the user picks)
// Both are Shopify's public storefront JSON — no API key, ~100-300ms.
// `/meta.json` (store name, currency, domain) doubles as the "is this even
// a Shopify store" check: a non-Shopify host answers it with HTML / 404.

const TIMEOUT_MS = 8_000;
const MAX_REDIRECTS = 3;
// products.json?limit=50 carries body_html for every product; heavy stores run
// ~1MB. A single product JSON is far smaller.
const MAX_JSON_BYTES = 4_000_000;
const MAX_IMAGE_BYTES = 12_000_000;
export const MAX_PRODUCT_IMAGES = 10;
const LIST_LIMIT = 50;

export interface ShopifyStore {
  name: string | null;
  /** Bare host of the store as the user reached it ("looseygoosey.com"). */
  domain: string;
  /** The *.myshopify.com host, when meta.json gives it. Images may live there. */
  myshopifyDomain: string | null;
  currency: string | null;
}

export interface ShopifyProduct {
  handle: string;
  /** Canonical product page on the store the user pasted. */
  url: string;
  title: string;
  vendor: string | null;
  productType: string | null;
  /** Lowest variant price, or null when the store publishes none. */
  price: number | null;
  /** Highest compare-at price that is above `price` (a real "was" price). */
  compareAtPrice: number | null;
  currency: string | null;
  available: boolean | null;
  /** body_html as plain text. */
  description: string;
  /** Up to MAX_PRODUCT_IMAGES gallery URLs, in the store's order. */
  images: string[];
  /** The store's variants (bundles, flavours, sizes) with their real prices —
   *  what the designed price slide prints. */
  variants: ShopifyVariant[];
}

export interface ShopifyVariant {
  title: string;
  price: number | null;
  compareAtPrice: number | null;
  available: boolean | null;
}

export type ShopifyError =
  | "bad_url"
  | "blocked_host"
  | "not_shopify"
  | "unreachable"
  | "not_found"
  | "no_products";

export type ShopifyResult =
  | { ok: true; kind: "product"; store: ShopifyStore; product: ShopifyProduct }
  | { ok: true; kind: "list"; store: ShopifyStore; products: ShopifyProduct[] }
  | { ok: false; error: ShopifyError; status?: number };

export const SHOPIFY_MESSAGES: Record<ShopifyError, string> = {
  bad_url: "Paste a full https:// link to a Shopify store.",
  blocked_host: "That link can't be opened.",
  not_shopify:
    "That doesn't look like a Shopify store. Paste a product page from a Shopify shop (or any page on it).",
  unreachable: "Couldn't reach that store — check the link and try again.",
  not_found: "That product isn't on the store anymore. Paste another product link.",
  no_products: "That store doesn't publish any products we can read.",
};

// ---------------------------------------------------------------------------
// Fetching — https only, every hop SSRF-checked, 8s, size-capped by streaming
// ---------------------------------------------------------------------------

async function readCapped(res: Response, cap: number): Promise<Buffer | null> {
  const len = Number(res.headers.get("content-length") ?? 0);
  if (len > cap) return null;
  const reader = res.body?.getReader();
  if (!reader) return Buffer.from(await res.arrayBuffer());
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > cap) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

export interface Fetched {
  ok: boolean;
  status: number;
  body: Buffer | null;
  contentType: string;
  blocked?: boolean;
  /** Body exceeded the cap. */
  tooLarge?: boolean;
}

/** https-only, SSRF-checked per hop, size-capped fetch. Shared with the
 *  website reader (lib/generate/website.ts). */
export async function safeFetch(input: string, accept: string, cap: number): Promise<Fetched> {
  let current: URL;
  try {
    current = new URL(input);
  } catch {
    return { ok: false, status: 0, body: null, contentType: "" };
  }
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    // https only — a redirect to http would downgrade the whole chain.
    if (current.protocol !== "https:" || !(await assertPublicHost(current))) {
      return { ok: false, status: 0, body: null, contentType: "", blocked: true };
    }
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(current.href, {
        signal: ctl.signal,
        redirect: "manual",
        headers: {
          "user-agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
          accept,
        },
      });
    } catch {
      clearTimeout(timer);
      return { ok: false, status: 0, body: null, contentType: "" };
    }
    try {
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get("location");
        if (!loc) return { ok: false, status: res.status, body: null, contentType: "" };
        try {
          current = new URL(loc, current);
        } catch {
          return { ok: false, status: res.status, body: null, contentType: "" };
        }
        continue;
      }
      const body = await readCapped(res, cap);
      return {
        ok: res.ok,
        status: res.status,
        body,
        contentType: res.headers.get("content-type") ?? "",
        tooLarge: body === null,
      };
    } catch {
      return { ok: false, status: res.status, body: null, contentType: "" };
    } finally {
      clearTimeout(timer);
    }
  }
  return { ok: false, status: 0, body: null, contentType: "" };
}

async function fetchJson<T>(url: string): Promise<{ status: number; data: T | null; blocked?: boolean }> {
  const res = await safeFetch(url, "application/json,*/*", MAX_JSON_BYTES);
  if (res.blocked) return { status: 0, data: null, blocked: true };
  if (!res.ok || !res.body) return { status: res.status, data: null };
  // Shopify answers these with application/json; a non-Shopify host that
  // happens to serve HTML at /products.json fails the parse below anyway.
  try {
    return { status: res.status, data: JSON.parse(res.body.toString("utf8")) as T };
  } catch {
    return { status: res.status, data: null };
  }
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

interface RawVariant {
  title?: string;
  price?: string | number;
  compare_at_price?: string | number | null;
  available?: boolean;
}
interface RawProduct {
  handle?: string;
  title?: string;
  body_html?: string;
  vendor?: string;
  product_type?: string;
  variants?: RawVariant[];
  images?: Array<{ src?: string }>;
}
interface RawMeta {
  name?: string;
  currency?: string;
  domain?: string;
  myshopify_domain?: string;
}

function num(v: unknown): number | null {
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Is this image URL on a host we're willing to download from? */
export function allowedImageHost(imgUrl: string, store: ShopifyStore): boolean {
  let u: URL;
  try {
    u = new URL(imgUrl);
  } catch {
    return false;
  }
  if (u.protocol !== "https:") return false;
  const host = u.hostname.toLowerCase();
  const bare = (h: string) => h.replace(/^www\./, "");
  if (host === "cdn.shopify.com") return true;
  if (bare(host) === bare(store.domain)) return true;
  if (store.myshopifyDomain && host === store.myshopifyDomain.toLowerCase()) return true;
  return false;
}

function toProduct(p: RawProduct, origin: string, store: ShopifyStore): ShopifyProduct | null {
  const handle = (p.handle ?? "").trim();
  const title = (p.title ?? "").trim();
  if (!handle || !title) return null;
  const variants = p.variants ?? [];
  const prices = variants.map((v) => num(v.price)).filter((n): n is number => n !== null);
  const price = prices.length ? Math.min(...prices) : null;
  const compares = variants
    .map((v) => num(v.compare_at_price))
    .filter((n): n is number => n !== null && (price === null || n > price));
  // The store's images may be served from cdn.shopify.com or its own domain;
  // anything else (a theme's hotlinked asset) is dropped here, so the
  // download step only ever talks to the store.
  const images = (p.images ?? [])
    .map((i) => (i.src ?? "").trim())
    .filter((src) => src && allowedImageHost(src, store))
    .slice(0, MAX_PRODUCT_IMAGES);
  return {
    handle,
    url: `${origin}/products/${handle}`,
    title,
    vendor: p.vendor?.trim() || null,
    productType: p.product_type?.trim() || null,
    price,
    compareAtPrice: compares.length ? Math.max(...compares) : null,
    currency: store.currency,
    available: variants.length ? variants.some((v) => v.available !== false) : null,
    description: stripHtml(p.body_html ?? "").slice(0, 2000),
    images,
    variants: variants.slice(0, 12).map((v) => ({
      title: (v.title ?? "").trim(),
      price: num(v.price),
      compareAtPrice: num(v.compare_at_price),
      available: typeof v.available === "boolean" ? v.available : null,
    })),
  };
}

/** The product handle in a Shopify URL, or null for any other store page. */
export function productHandle(u: URL): string | null {
  const m = u.pathname.match(/\/products\/([^/?#]+)/);
  return m ? m[1].replace(/\.json$/i, "") : null;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export async function fetchShopify(input: string): Promise<ShopifyResult> {
  let u: URL;
  try {
    u = new URL(input.trim());
  } catch {
    return { ok: false, error: "bad_url" };
  }
  if (u.protocol !== "https:") return { ok: false, error: "bad_url" };
  if (!(await assertPublicHost(u))) return { ok: false, error: "blocked_host" };

  const handle = productHandle(u);
  const target = handle
    ? `${u.origin}/products/${encodeURIComponent(handle)}.json`
    : `${u.origin}/products.json?limit=${LIST_LIMIT}`;

  const [meta, main] = await Promise.all([
    fetchJson<RawMeta>(`${u.origin}/meta.json`),
    fetchJson<{ product?: RawProduct; products?: RawProduct[] }>(target),
  ]);
  if (main.blocked || meta.blocked) return { ok: false, error: "blocked_host" };

  // Shopify-ness: meta.json is the store's own identity card. If it's not
  // there AND the product call didn't answer as Shopify JSON either, this
  // simply isn't a Shopify store.
  const isShopifyMeta = !!meta.data && typeof meta.data === "object" && "myshopify_domain" in meta.data;
  const store: ShopifyStore = {
    name: meta.data?.name?.trim() || null,
    domain: u.hostname.toLowerCase(),
    myshopifyDomain: meta.data?.myshopify_domain?.toLowerCase() || null,
    currency: meta.data?.currency?.toUpperCase() || null,
  };

  if (!main.data) {
    if (main.status === 0) return { ok: false, error: "unreachable" };
    if (!isShopifyMeta) return { ok: false, error: "not_shopify", status: main.status };
    if (handle && main.status === 404) return { ok: false, error: "not_found", status: 404 };
    return { ok: false, error: "unreachable", status: main.status };
  }

  if (handle) {
    const product = main.data.product ? toProduct(main.data.product, u.origin, store) : null;
    if (!product) {
      return isShopifyMeta
        ? { ok: false, error: "not_found", status: main.status }
        : { ok: false, error: "not_shopify", status: main.status };
    }
    return { ok: true, kind: "product", store, product };
  }

  const list = Array.isArray(main.data.products) ? main.data.products : null;
  if (!list) return { ok: false, error: "not_shopify", status: main.status };
  const products = list
    .map((p) => toProduct(p, u.origin, store))
    .filter((p): p is ShopifyProduct => p !== null);
  if (products.length === 0) return { ok: false, error: "no_products" };
  return { ok: true, kind: "list", store, products };
}

// ---------------------------------------------------------------------------
// Images — only from cdn.shopify.com or the store itself
// ---------------------------------------------------------------------------

async function downloadImage(url: string): Promise<Buffer | null> {
  const res = await safeFetch(url, "image/*", MAX_IMAGE_BYTES);
  if (!res.ok || !res.body) return null;
  if (res.contentType && !/^image\//i.test(res.contentType)) return null;
  return res.body;
}

/**
 * Download a product's gallery, in order, up to `limit` usable files. Dead or
 * off-host URLs are skipped silently — one broken CDN link must never fail the
 * deck when the other photos are fine. Modest concurrency: Shopify's CDN is
 * happy with it, and 10 sequential downloads would add seconds to a run.
 */
export async function downloadProductImages(
  product: ShopifyProduct,
  store: ShopifyStore,
  limit: number,
): Promise<{ buffer: Buffer; url: string }[]> {
  const urls = product.images.filter((src) => allowedImageHost(src, store)).slice(0, limit);
  const results: ({ buffer: Buffer; url: string } | null)[] = new Array(urls.length).fill(null);
  let next = 0;
  const worker = async () => {
    while (next < urls.length) {
      const i = next++;
      const buffer = await downloadImage(urls[i]).catch(() => null);
      if (buffer && buffer.length > 0) results[i] = { buffer, url: urls[i] };
    }
  };
  await Promise.all(Array.from({ length: Math.min(3, urls.length) }, worker));
  return results.filter((r): r is { buffer: Buffer; url: string } => r !== null);
}

// ---------------------------------------------------------------------------
// Copy inputs
// ---------------------------------------------------------------------------

export function formatPrice(n: number | null, currency: string | null): string | null {
  if (n == null) return null;
  const cur = !currency || currency === "USD" ? "$" : `${currency} `;
  return `${cur}${Number.isInteger(n) ? String(n) : n.toFixed(2)}`;
}

/**
 * The product's name as a person would say it — no pipes, no variant tails,
 * no "+ Free Gifts" promo tail, and LOWERCASE: captions are all-lowercase by
 * house rule (cleanCaption strips only the sentence-initial capital, so a
 * Title-Case name handed to the model came back as "loosey Goosey Calming
 * Pouches" — half-cased, which reads as a typo).
 */
export function productShortName(p: ShopifyProduct): string {
  let cleaned = p.title
    .replace(/\s*[|｜]\s*/g, " ")
    .replace(/\s*\([^)]*\)\s*$/, "")
    .replace(/\s*\+\s*free\b.*$/i, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  if (p.vendor && !cleaned.toLowerCase().includes(p.vendor.toLowerCase())) {
    cleaned = `${p.vendor} ${cleaned}`;
  }
  cleaned = cleaned.toLowerCase();
  return cleaned.length > 60 ? cleaned.slice(0, 60).trimEnd() : cleaned;
}

/**
 * The short line that feeds niche detection. NEVER the full facts block —
 * /api/generate's keyword vote is built for a sentence a human typed, and
 * against a page of marketing copy one stray word decides the whole visual
 * direction (see the product-link notes in CLAUDE.md).
 */
export function productTopicLine(p: ShopifyProduct): string {
  return [p.title, p.productType, p.vendor, p.description.slice(0, 200)]
    .filter(Boolean)
    .join(". ");
}

const MAX_DESC = 900;

/** Drop the store's boilerplate tail (shipping, care, SKUs) from the description. */
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

/** A compact fact sheet — the only material the copy may draw on. */
export function productFacts(p: ShopifyProduct, store: ShopifyStore): string {
  const bits: string[] = [`Product: ${p.title}`];
  if (p.vendor) bits.push(`Brand: ${p.vendor}`);
  else if (store.name) bits.push(`Sold by: ${store.name}`);
  if (p.productType) bits.push(`Category: ${p.productType}`);
  const price = formatPrice(p.price, p.currency);
  const was = formatPrice(p.compareAtPrice, p.currency);
  if (price && was) bits.push(`Price: ${price} (marked down from ${was})`);
  else if (price) bits.push(`Price: ${price}`);
  if (p.available === false) bits.push("Currently sold out");
  const desc = usefulDescription(p.description);
  if (desc) bits.push(`What the store says about it: ${desc}`);
  return bits.join("\n");
}

/**
 * The TOPIC handed to the copy model for a Shopify-link deck. It lands in the
 * existing "TOPIC — what this WHOLE slideshow must be about:" slot, so it reads
 * as a subject brief. The CTA slide itself is specified structurally through
 * `productCta` on the request, not here.
 */
export function productTopic(p: ShopifyProduct, store: ShopifyStore, angle: string): string {
  const lines: string[] = [];
  lines.push(
    angle.trim()
      ? `${angle.trim()} — about a real product: ${p.title}.`
      : `A post that makes someone want to buy ${p.title}.`,
  );
  lines.push(
    "",
    "Write it as a VALUE post, not an ad: someone who never buys should still " +
      "finish it knowing something concrete about this kind of product. The " +
      "product is the answer the post arrives at, and the final slide tells " +
      "people where to get it.",
    "",
    "USE ONLY THE FACTS BELOW. Never invent specs, ingredients, materials, " +
      "results, reviews, ratings, discounts, awards or claims that are not in " +
      "them. If a fact is not listed, it does not exist for this post.",
    "",
    productFacts(p, store),
  );
  return lines.join("\n");
}
