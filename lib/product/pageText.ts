// Pull the human-readable selling copy out of a store page.
//
// Needed because `products.json` is often a poor description of the product:
// measured across live stores it ranged from 1029 characters down to ZERO
// (Feastables ships an empty body_html while the page itself is full of copy).
// The real benefits, specs and positioning live in theme sections that never
// reach the API, so the page has to be read as a page.

/** Elements whose CONTENT is never product copy. */
const SKIP_CONTENT = new Set([
  "script", "style", "noscript", "svg", "iframe", "template", "head",
  "nav", "footer", "header", "form", "select", "option", "button", "canvas",
]);

/** Elements that end a line of text. */
const BLOCK_TAGS = new Set([
  "p", "div", "section", "article", "li", "ul", "ol", "br", "main", "aside",
  "h1", "h2", "h3", "h4", "h5", "h6", "td", "tr", "table", "blockquote",
  "figcaption", "figure", "dd", "dt", "dl", "label", "span",
]);

// Line-level junk: store chrome, legal, and UI labels that survive tag removal.
const JUNK_LINE =
  /^(add to (cart|bag)|buy now|sold out|quantity|size guide|share|tweet|pin it|subscribe|sign up|log ?in|search|menu|close|skip to( main)? content|view (cart|all)|shop( all| now)?|home|back|next|previous|filter|sort by|cookie|we use cookies|accept|privacy policy|terms|©|all rights reserved|follow us|contact us|customer (service|care)|faqs?|track(ing)? (my )?order|gift cards?|careers?|press|wholesale|affiliates?|you can opt out|oops!)\b/i;

/**
 * Logistics, transactional and error copy.
 *
 * Separate from JUNK_LINE because these are full sentences that read exactly
 * like product copy to a model — "orders may take up to 30 days to ship" is
 * grammatical, on-brand, and catastrophic on a slide. Shipping terms, returns
 * policy and newsletter confirmations are never the reason someone buys.
 */
const SERVICE_LINE =
  /(free shipping|ship(s|ping|ped)? (within|in|by|to)|orders? (may|will|are|over)|due to (increased )?demand|delivery (time|window)|final sale|cannot be returned|returns?( are)? (free|accepted)|exchange(s|d)?( are)? |restock|back ?in stock|something went wrong|we got your info|enter your email|by (signing|subscribing)|opt out|unsubscribe|discount code|use code|klarna|afterpay|installments?)/i;

/** Currency-only, rating-only, or count-only fragments. */
const NOISE_LINE =
  /^(\$?\d[\d.,]*\s*(usd|eur|gbp|cad|aud)?|\d+(\.\d+)?\s*(stars?|reviews?|ratings?)|[\d\s.,%$-]+)$/i;

/**
 * Leftover markup or JavaScript.
 *
 * Defence in depth behind the scanner: themes built on Alpine/Vue put real code
 * in attributes, and any of it that escapes reads as authoritative product copy
 * to a caption model. Cheaper to drop a rare good line than to caption a slide
 * with `$store.cart.formatMoney`.
 */
const CODE_LINE =
  /(=>|\{\{|\}\}|\$store|\bfunction\s*\(|=\s*['"]|;\s*$|\bvar\b|\blet\b|\bconst\b|\bawait\b|\breturn\b|<\/?[a-z]+[\s>]|\b(class|data-[a-z-]+|aria-[a-z-]+|src|href|srcset|style|id)\s*=|^[:@x]-|\.(js|css|json)\b|\|\||&&|!==|===)/i;

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&(#39|apos|rsquo|lsquo);/g, "'")
    .replace(/&(quot|ldquo|rdquo);/g, '"')
    .replace(/&(mdash|ndash);/g, "—")
    .replace(/&hellip;/g, "…")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, d) => {
      const code = Number(d);
      return code > 31 && code < 0x10ffff ? String.fromCodePoint(code) : "";
    });
}

/**
 * Strip markup, keeping text and block boundaries.
 *
 * Hand-scanned rather than regex-replaced: `<[^>]+>` terminates at the first
 * `>` even when it sits inside a quoted attribute value, which is common in
 * Alpine/Vue themes (`x-show="a > b"`). One such attribute desynchronizes the
 * match and dumps the rest of the tag soup — raw JavaScript and class lists —
 * straight into the "copy". Tracking quote state fixes it properly.
 */
function stripMarkup(html: string): string {
  let out = "";
  let i = 0;
  const n = html.length;

  while (i < n) {
    const lt = html.indexOf("<", i);
    if (lt === -1) {
      out += html.slice(i);
      break;
    }
    out += html.slice(i, lt);

    // Comment / CDATA
    if (html.startsWith("<!--", lt)) {
      const end = html.indexOf("-->", lt + 4);
      i = end === -1 ? n : end + 3;
      continue;
    }

    // Read the tag name.
    let p = lt + 1;
    const closing = html[p] === "/";
    if (closing) p++;
    let name = "";
    while (p < n && /[a-zA-Z0-9]/.test(html[p])) name += html[p++];
    name = name.toLowerCase();

    // Find the end of the tag, honouring quoted attribute values.
    let j = p;
    let quote = "";
    while (j < n) {
      const c = html[j];
      if (quote) {
        if (c === quote) quote = "";
      } else if (c === '"' || c === "'") {
        quote = c;
      } else if (c === ">") {
        break;
      }
      j++;
    }
    const tagEnd = j < n ? j : n;

    if (!closing && SKIP_CONTENT.has(name)) {
      // Jump past the whole element.
      const close = html.toLowerCase().indexOf(`</${name}`, tagEnd);
      if (close === -1) {
        i = tagEnd + 1;
      } else {
        const closeEnd = html.indexOf(">", close);
        i = closeEnd === -1 ? n : closeEnd + 1;
      }
      out += "\n";
      continue;
    }

    if (name === "li" && !closing) out += "\n• ";
    else if (BLOCK_TAGS.has(name)) out += "\n";
    else out += " ";

    i = tagEnd + 1;
  }
  return out;
}

/**
 * Readable copy from a page, junk removed, in document order.
 *
 * `minLine` keeps this useful for two different jobs: product pages want short
 * spec bullets kept, a homepage only wants real sentences of positioning.
 */
export function extractReadableText(
  html: string,
  opts: { limit: number; minLine?: number } = { limit: 2500 },
): string {
  const minLine = opts.minLine ?? 18;
  const text = decodeEntities(stripMarkup(html));

  const seen = new Set<string>();
  const lines: string[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.replace(/\s+/g, " ").trim();
    if (!line) continue;
    const bare = line.replace(/^•\s*/, "");
    if (bare.length < minLine) continue;
    if (CODE_LINE.test(bare)) continue;
    if (JUNK_LINE.test(bare) || NOISE_LINE.test(bare) || SERVICE_LINE.test(bare)) {
      continue;
    }
    // Require at least a few letters — filters stray punctuation/number rows.
    if ((bare.match(/[a-z]/gi)?.length ?? 0) < minLine * 0.5) continue;
    // Nav/link soup: several Title Case words with no sentence punctuation.
    if (bare.length < 60 && !/[.!?,;:]/.test(bare) && /^(\S+\s){3,}\S+$/.test(bare)) {
      continue;
    }
    const key = bare.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    lines.push(line);
  }

  let out = "";
  for (const line of lines) {
    if (out.length + line.length + 1 > opts.limit) break;
    out += (out ? "\n" : "") + line;
  }
  return out;
}
