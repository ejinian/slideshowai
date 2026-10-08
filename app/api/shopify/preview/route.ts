import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { createAdminClient } from "@/utils/supabase/admin";
import { isAdminEmail } from "@/lib/admins";
import { claimRateWindow, guardUnavailable } from "@/lib/billing/usage";
import {
  fetchShopify,
  SHOPIFY_MESSAGES,
  type ShopifyProduct,
  type ShopifyStore,
} from "@/lib/generate/shopify";
import {
  fetchWebsite,
  downloadSiteImages,
  MAX_SITE_IMAGES,
  WEBSITE_MESSAGES,
} from "@/lib/generate/website";

// "Shopify link" source — the composer pastes a store URL here and shows what
// it found: ONE product (a /products/<handle> link) or the store's products
// for the user to pick from (any other page: landing, collection, homepage).
//
// Not a Shopify store → read it as a plain website (kind "site"): the card
// shows the business name, domain and the photos that passed the photo check.
// Those ARE downloaded here (to size-check them, so the card's photo count is
// the real one), but only their URLs are returned.
//
// Preview only. For a Shopify store nothing is downloaded or re-encoded here —
// the card shows the store's own CDN thumbnails. Either way the generate route
// re-reads the link it is handed, so nothing in this response is trusted later.
export const runtime = "nodejs";
export const maxDuration = 30;

// Shared durable throttle with the other link readers (see /api/product).
const WINDOW_SECS = 5 * 60;
const MAX_HITS = 30;

// What the composer needs for the card / picker. Descriptions are trimmed:
// the full text rides into the deck server-side at generate time.
function publicProduct(p: ShopifyProduct, full: boolean) {
  return {
    handle: p.handle,
    url: p.url,
    title: p.title,
    vendor: p.vendor,
    productType: p.productType,
    price: p.price,
    compareAtPrice: p.compareAtPrice,
    currency: p.currency,
    available: p.available,
    description: p.description.slice(0, full ? 1500 : 240),
    images: p.images,
  };
}

function publicStore(s: ShopifyStore) {
  return { name: s.name, domain: s.domain, currency: s.currency };
}

interface Body {
  url?: string;
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as Body;
  const url = (body.url ?? "").trim().slice(0, 2048);
  if (!url) {
    return NextResponse.json({ error: "Paste a link first." }, { status: 400 });
  }

  if (!isAdminEmail(user.email)) {
    const win = await claimRateWindow(createAdminClient(), user.id, MAX_HITS, WINDOW_SECS);
    if (!win.ok) {
      if (win.reason === "error") return guardUnavailable(win.detail);
      return NextResponse.json({ error: "Slow down a moment and try again." }, { status: 429 });
    }
  }

  const result = await fetchShopify(url);
  if (!result.ok && (result.error === "not_shopify" || result.error === "bad_url")) {
    const read = await fetchWebsite(url);
    if (!read.ok) {
      return NextResponse.json(
        { code: read.error, error: WEBSITE_MESSAGES[read.error] },
        { status: read.error === "bad_url" ? 400 : 422 },
      );
    }
    const photos = await downloadSiteImages(read.site, MAX_SITE_IMAGES);
    const site = read.site;
    return NextResponse.json({
      kind: "site",
      store: { name: site.name, domain: site.domain, currency: null },
      // Product-shaped so the composer's card renders it unchanged; the
      // generate route re-reads the site from `url`.
      product: {
        handle: site.domain,
        url: site.url,
        title: site.name,
        vendor: site.domain,
        productType: null,
        price: null,
        compareAtPrice: null,
        currency: null,
        available: null,
        description: (site.description ?? site.text).slice(0, 400),
        images: photos.map((p) => p.url),
      },
    });
  }
  if (!result.ok) {
    return NextResponse.json(
      { code: result.error, error: SHOPIFY_MESSAGES[result.error] },
      // The caller's link is the problem for bad_url / blocked_host; an
      // unreadable or non-Shopify store is not.
      { status: result.error === "bad_url" || result.error === "blocked_host" ? 400 : 422 },
    );
  }

  if (result.kind === "product") {
    return NextResponse.json({
      kind: "product",
      store: publicStore(result.store),
      product: publicProduct(result.product, true),
    });
  }
  return NextResponse.json({
    kind: "list",
    store: publicStore(result.store),
    products: result.products.map((p) => publicProduct(p, false)),
  });
}
