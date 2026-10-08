import { createHash } from "node:crypto";
import sharp from "sharp";
import { extractReadableText } from "@/lib/product/pageText";
import { safeFetch } from "./shopify";

// Any website link → the business it belongs to. Server-only (DNS + raw
// fetches against a URL the user typed; must never run in the browser).
//
// The Shopify reader's sibling for sites with no storefront JSON — a realtor,
// a barber, a café. Same contract: a READER, not a generator. It returns the
// site's own words and photos; the generate route treats the photos exactly
// like user uploads (image-first captions) and the words become the topic. The
// caption prompts see only a `productCta` with kind "business".
//
// One page is read: the one the user pasted. Its text comes from
// extractReadableText in site mode (table rows stay whole, so "3663 Eddingham
// Avenue · Aug 24, 2026 · $1,460,000" survives as one fact). Its photos come
// from <img>/<source>/og:image/inline backgrounds, only on the site's own host
// or a known site-builder CDN, and only if they are real photographs: at least
// 480px on the short side, not a banner strip, not a transparent logo.

const MAX_HTML_BYTES = 3_000_000;
const MAX_IMAGE_BYTES = 12_000_000;
/** Candidates collected from the HTML before any download. */
const MAX_CANDIDATES = 24;
export const MAX_SITE_IMAGES = 10;
/** The designed carousel spends photos faster (a gallery slide takes four). */
export const MAX_SITE_IMAGES_DESIGNED = 14;
const MIN_SHORT_SIDE = 480;
const MAX_ASPECT = 2.6;
const MAX_TEXT = 2800;

export interface SiteImage {
  url: string;
  /** The page's alt text — on a business site it is often the subject
   *  ("3663 Eddingham Avenue"), which ties a photo to a fact. */
  alt: string | null;
}

export interface Website {
  /** The page as finally reached (after redirects / the www retry). */
  url: string;
  /** Bare host, no www ("raz4homes.com"). */
  domain: string;
  /** The business's name as the site states it ("Team Raz"). */
  name: string;
  /** Meta / OpenGraph description, when the site has one. */
  description: string | null;
  /** Readable copy from the page, junk removed, document order. */
  text: string;
  /** First tel: link on the page, formatted for a slide, or null. */
  phone: string | null;
  /** Photo candidates in document order (not yet size-checked). */
  images: SiteImage[];
}

export type WebsiteError = "bad_url" | "blocked_host" | "unreachable" | "not_html" | "captcha" | "no_content";

export type WebsiteResult = { ok: true; site: Website } | { ok: false; error: WebsiteError; status?: number };

export const WEBSITE_MESSAGES: Record<WebsiteError, string> = {
  bad_url: "Paste a full website link, like https://yourbusiness.com.",
  blocked_host: "That link can't be opened.",
  unreachable: "Couldn't reach that website — check the link and try again.",
  not_html: "That link isn't a web page. Paste the website's address instead.",
  captcha: "That website blocks automated readers, so we can't read it. Upload photos and describe it instead.",
  no_content: "That page has no text or photos we can read. Try the site's homepage.",
};

/**
 * What the user typed → an https URL, or null. Accepts a bare domain
 * ("www.raz4homes.com") since that is how people write a business site, and
 * upgrades http — the fetcher is https-only.
 */
export function normalizeSiteUrl(input: string): URL | null {
  let raw = input.trim();
  if (!raw) return null;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) raw = `https://${raw}`;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol === "http:") u.protocol = "https:";
  if (u.protocol !== "https:") return null;
  if (!u.hostname.includes(".")) return null;
  u.hash = "";
  return u;
}

const bareHost = (h: string) => h.toLowerCase().replace(/^www\./, "");

// ---------------------------------------------------------------------------
// HTML parsing
// ---------------------------------------------------------------------------

function decode(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&(#39|apos);/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, d) => {
      const c = Number(d);
      return c > 31 && c < 0x10ffff ? String.fromCodePoint(c) : "";
    })
    .trim();
}

function attrs(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /([a-zA-Z_:][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(tag))) out[m[1].toLowerCase()] = decode(m[2] ?? m[3] ?? m[4] ?? "");
  return out;
}

function metaContent(html: string, key: string): string | null {
  const re = /<meta\b[^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const a = attrs(m[0]);
    if ((a.property ?? a.name ?? "").toLowerCase() === key && a.content) return a.content;
  }
  return null;
}

const GENERIC_TITLE = /^(home|homepage|home page|welcome|index|official site|official website|main)$/i;

/** "Team Raz | Los Angeles Real Estate" → "Team Raz"; "Home - Acme Plumbing" → "Acme Plumbing". */
function siteName(html: string, domain: string): string {
  const og = metaContent(html, "og:site_name") ?? metaContent(html, "application-name");
  if (og && og.length <= 60) return og;
  const title = decode(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "");
  const parts = title
    .split(/\s+[|–—·:-]\s+|\s*\|\s*/)
    .map((p) => p.trim())
    .filter((p) => p && !GENERIC_TITLE.test(p));
  if (parts[0] && parts[0].length <= 60) return parts[0];
  const label = domain.split(".")[0];
  return label.charAt(0).toUpperCase() + label.slice(1);
}

/** The largest candidate in a srcset ("a.jpg 640w, b.jpg 1280w" → b.jpg). */
function largestFromSrcset(srcset: string): string | null {
  let best: { url: string; size: number } | null = null;
  for (const part of srcset.split(/,\s+(?=\S)/)) {
    const [url, desc] = part.trim().split(/\s+/);
    if (!url) continue;
    const size = desc ? parseFloat(desc) || 1 : 1;
    if (!best || size > best.size) best = { url, size };
  }
  return best?.url ?? null;
}

// Site builders serve images from a CDN, not the site's own host. Anything not
// on the site and not on one of these is someone else's image (a partner logo,
// a hotlinked badge) and is never downloaded.
const CDN_HOSTS = [
  "cdn.shopify.com",
  "framerusercontent.com",
  "res.cloudinary.com",
  "lh3.googleusercontent.com",
  "images.ctfassets.net",
  "cdn.sanity.io",
];
const CDN_SUFFIXES = [
  ".squarespace-cdn.com",
  ".squarespace.com",
  ".wixstatic.com",
  ".website-files.com",
  ".webflow.com",
  ".imgix.net",
  ".cloudfront.net",
  ".wp.com",
  ".wsimg.com",
  ".cdn-website.com",
  ".hubspotusercontent-na1.net",
  ".hubspotusercontent.net",
];

export function allowedSiteImageHost(imgUrl: string, siteDomain: string): boolean {
  let u: URL;
  try {
    u = new URL(imgUrl);
  } catch {
    return false;
  }
  if (u.protocol !== "https:") return false;
  const host = u.hostname.toLowerCase();
  const site = bareHost(siteDomain);
  if (bareHost(host) === site || host.endsWith(`.${site}`)) return true;
  if (CDN_HOSTS.includes(host)) return true;
  return CDN_SUFFIXES.some((s) => host.endsWith(s));
}

// Chrome, not photographs — judged on the file path, before any download.
const NOT_A_PHOTO =
  /(logo|icon|favicon|sprite|avatar|badge|payment|flag|emoji|placeholder|pixel|spinner|loader|arrow|social|facebook|instagram|twitter|linkedin|youtube|tiktok|yelp|google-?review|seal|trust|award-?badge)/i;

function collectImages(html: string, pageUrl: URL, domain: string): SiteImage[] {
  const out: SiteImage[] = [];
  const seen = new Set<string>();
  const push = (raw: string | null | undefined, alt: string | null) => {
    if (!raw || out.length >= MAX_CANDIDATES) return;
    const src = raw.trim();
    if (!src || src.startsWith("data:")) return;
    let u: URL;
    try {
      u = new URL(src, pageUrl);
    } catch {
      return;
    }
    if (u.protocol === "http:" && bareHost(u.hostname) === domain) u.protocol = "https:";
    if (/\.(svg|gif|ico)(\?|$)/i.test(u.pathname)) return;
    if (NOT_A_PHOTO.test(u.pathname)) return;
    if (!allowedSiteImageHost(u.href, domain)) return;
    // Same image at different sizes (?format=1500w, ?width=800) is one image.
    const key = `${u.hostname}${u.pathname}`.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ url: u.href, alt: alt && alt.length <= 120 ? alt : null });
  };

  // Document order matters: the hero is near the top and is usually the best
  // hook photo. og:image goes last — it is often a share card with text on it.
  const tagRe = /<(img|source)\b[^>]*>|style\s*=\s*"[^"]*background(?:-image)?\s*:[^"]*url\(([^)]+)\)[^"]*"/gi;
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(html))) {
    if (m[2]) {
      push(m[2].replace(/^['"]|['"]$/g, "").replace(/&quot;/g, ""), null);
      continue;
    }
    const a = attrs(m[0]);
    const w = Number(a.width);
    const h = Number(a.height);
    if ((w && w < 200) || (h && h < 200)) continue;
    if (NOT_A_PHOTO.test(`${a.class ?? ""} ${a.alt ?? ""}`)) continue;
    const srcset = a["data-srcset"] ?? a.srcset;
    const best =
      (srcset ? largestFromSrcset(srcset) : null) ??
      a["data-src"] ??
      a["data-lazy-src"] ??
      a["data-original"] ??
      a.src;
    push(best, a.alt?.trim() || null);
  }
  push(metaContent(html, "og:image"), null);
  return out;
}

function firstPhone(html: string): string | null {
  const tel = html.match(/href\s*=\s*["']tel:([^"']+)["']/i)?.[1];
  if (!tel) return null;
  const digits = decodeURIComponent(tel).replace(/[^\d+]/g, "");
  const us = digits.replace(/^\+?1(?=\d{10}$)/, "");
  if (/^\d{10}$/.test(us)) return `${us.slice(0, 3)}-${us.slice(3, 6)}-${us.slice(6)}`;
  return digits.length >= 7 ? digits : null;
}

const BOT_WALL = /(just a moment\.\.\.|cf-chl|challenge-platform|attention required! \| cloudflare|captcha|are you a robot|access denied)/i;

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

async function fetchPage(u: URL) {
  return safeFetch(u.href, "text/html,application/xhtml+xml,*/*;q=0.8", MAX_HTML_BYTES);
}

export async function fetchWebsite(input: string): Promise<WebsiteResult> {
  const u = normalizeSiteUrl(input);
  if (!u) return { ok: false, error: "bad_url" };

  let page = await fetchPage(u);
  let reached = u;
  // Plenty of small-business sites only answer on www (raz4homes.com 404s,
  // www.raz4homes.com is the site). Try the other host once.
  if (!page.ok && !u.hostname.startsWith("www.")) {
    const www = new URL(u.href);
    www.hostname = `www.${u.hostname}`;
    const retry = await fetchPage(www);
    if (retry.ok) {
      page = retry;
      reached = www;
    }
  }
  const html = page.body?.toString("utf8") ?? "";
  if (!page.ok) {
    if (html && BOT_WALL.test(html.slice(0, 20_000))) return { ok: false, error: "captcha", status: page.status };
    if (page.blocked) return { ok: false, error: "unreachable" };
    return { ok: false, error: "unreachable", status: page.status };
  }
  if (page.contentType && !/html|xml/i.test(page.contentType)) return { ok: false, error: "not_html" };
  if (BOT_WALL.test(html.slice(0, 20_000)) && html.length < 40_000) {
    return { ok: false, error: "captcha", status: page.status };
  }

  const domain = bareHost(reached.hostname);
  const description = metaContent(html, "description") ?? metaContent(html, "og:description");
  const text = extractReadableText(html, { limit: MAX_TEXT, minLine: 12, site: true });
  const images = collectImages(html, reached, domain);
  if (!text && images.length === 0) return { ok: false, error: "no_content" };

  return {
    ok: true,
    site: {
      url: reached.href,
      domain,
      name: siteName(html, domain),
      description: description ? description.slice(0, 400) : null,
      text,
      phone: firstPhone(html),
      images,
    },
  };
}

// ---------------------------------------------------------------------------
// Images — downloaded, then kept only if they are real photographs
// ---------------------------------------------------------------------------

async function isPhoto(buf: Buffer): Promise<boolean> {
  try {
    const img = sharp(buf, { failOn: "none" });
    const meta = await img.metadata();
    const w = meta.width ?? 0;
    const h = meta.height ?? 0;
    if (Math.min(w, h) < MIN_SHORT_SIDE) return false;
    if (Math.max(w, h) / Math.min(w, h) > MAX_ASPECT) return false;
    // A mostly-transparent image is a logo or a cut-out graphic, not a photo.
    if (meta.hasAlpha) {
      const stats = await img.stats();
      const alpha = stats.channels[stats.channels.length - 1];
      if (alpha && alpha.mean < 240) return false;
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Download the site's photo candidates in order and keep up to `limit` that
 * are real photographs. Broken links and graphics are skipped silently — one
 * dead image must never fail the deck. Exact duplicates (the same file under
 * two URLs) are dropped by content hash.
 */
export async function downloadSiteImages(
  site: Website,
  limit: number,
): Promise<{ buffer: Buffer; url: string; alt: string | null }[]> {
  const cands = site.images.filter((i) => allowedSiteImageHost(i.url, site.domain));
  const results: ({ buffer: Buffer; url: string; alt: string | null } | null)[] = new Array(cands.length).fill(null);
  let next = 0;
  const worker = async () => {
    while (next < cands.length) {
      const i = next++;
      const res = await safeFetch(cands[i].url, "image/*", MAX_IMAGE_BYTES).catch(() => null);
      if (!res?.ok || !res.body || res.body.length === 0) continue;
      if (res.contentType && !/^image\//i.test(res.contentType)) continue;
      if (!(await isPhoto(res.body))) continue;
      results[i] = { buffer: res.body, url: cands[i].url, alt: cands[i].alt };
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, cands.length) }, worker));
  const seen = new Set<string>();
  const out: { buffer: Buffer; url: string; alt: string | null }[] = [];
  for (const r of results) {
    if (!r) continue;
    const h = createHash("sha1").update(r.buffer).digest("hex");
    if (seen.has(h)) continue;
    seen.add(h);
    out.push(r);
    if (out.length >= limit) break;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Copy inputs
// ---------------------------------------------------------------------------

/**
 * A photo's label, extended with the fact it belongs to. A business site
 * labels its photos with the subject ("3663 Eddingham Avenue") and states the
 * fact elsewhere on the page ("… SOLD Calabasas · Aug 24, 2026 · $1,460,000"),
 * so the vision model sees the address and never the price. The page-text line
 * that mentions the label carries it; a line that is ONLY the label (a card
 * heading) takes the next line ("4 bedrooms · 2 bathrooms · 1,350 sq ft").
 */
export function photoFact(site: Website, alt: string | null): string | null {
  if (!alt) return null;
  const label = alt.trim();
  const key = label.toLowerCase();
  if (key.length < 6) return label;
  const lines = site.text.split("\n");
  const i = lines.findIndex((l) => l.toLowerCase().includes(key));
  if (i < 0) return label;
  // Row tails like "· Details Speak With Raz" are link text, not facts.
  const clean = (l: string) =>
    l
      .split(" · ")
      .filter((seg, j, all) => j === 0 || j < all.length - 1 || /\d/.test(seg))
      .join(" · ");
  const line = lines[i].trim();
  const fact =
    line.toLowerCase() === key && lines[i + 1] && /\d/.test(lines[i + 1])
      ? `${line} — ${clean(lines[i + 1])}`
      : clean(line);
  return fact.length > 200 ? fact.slice(0, 200) : fact;
}

/** The business name as a caption says it — lowercase by house rule. */
export function siteShortName(site: Website): string {
  const n = site.name.replace(/\s{2,}/g, " ").trim().toLowerCase();
  return n.length > 50 ? n.slice(0, 50).trimEnd() : n;
}

/**
 * The short line that feeds niche detection — never the page text, for the
 * same reason productTopicLine exists (one stray word in a page of copy
 * decides the visual direction).
 */
export function websiteTopicLine(site: Website): string {
  return [site.name, site.description].filter(Boolean).join(". ");
}

/** The facts the copy may draw on — the site's own words, nothing else. */
export function websiteFacts(site: Website): string {
  const bits: string[] = [`Business: ${site.name}`, `Website: ${site.domain}`];
  if (site.phone) bits.push(`Phone: ${site.phone}`);
  if (site.description) bits.push(`How they describe themselves: ${site.description}`);
  if (site.text) bits.push(`From their website:\n${site.text}`);
  return bits.join("\n");
}

/**
 * The TOPIC for a website deck. Lands in the "TOPIC — what this WHOLE
 * slideshow must be about:" slot. The CTA slide is specified structurally via
 * `productCta` (kind "business"), not here.
 */
export function websiteTopic(site: Website, angle: string): string {
  return [
    angle.trim()
      ? `${angle.trim()} — about a real business: ${site.name}.`
      : `A post that makes someone want to work with ${site.name}.`,
    "",
    "Write it as a VALUE post, not an ad: someone who never becomes a customer " +
      "should still finish it knowing something concrete about this kind of " +
      "work, shown through this business's real results. The business is the " +
      "answer the post arrives at, and the final slide tells people how to " +
      "reach them.",
    "",
    "USE ONLY THE FACTS BELOW. Never invent prices, numbers, results, reviews, " +
      "ratings, awards, years of experience, locations or claims that are not " +
      "in them. If a fact is not listed, it does not exist for this post. " +
      "Numbers (prices, dates, sizes) must be copied exactly.",
    "",
    websiteFacts(site),
  ].join("\n");
}
