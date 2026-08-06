import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { extractProduct, type ExtractError } from "@/lib/product/extract";
import { prepareProductImages } from "@/lib/product/images";
import { buildProductBrief, productTopicLine } from "@/lib/product/brief";
import { resolveNiche } from "@/lib/generate/nicheDetect";

// Paste a product link → the deck's photos and its topic brief.
//
// This is a READER, not a generator: it produces exactly the inputs
// /api/generate already accepts (`userImages` + `prompt`), so the caption
// pipeline is completely untouched — the same separation that keeps
// /api/suggest from being able to break generation.
export const runtime = "nodejs";
// Scraping + downloading and recompositing up to 8 photos runs well past the
// default budget on a slow store.
export const maxDuration = 60;

const MAX_IMAGES = 8;

// Best-effort soft throttle (per server instance, resets on cold start). The
// real guard is the login gate; this just stops one client hammering stores
// through us.
const HITS = new Map<string, number[]>();
const WINDOW_MS = 5 * 60 * 1000;
const MAX_HITS = 30;
function throttled(userId: string, now: number): boolean {
  const recent = (HITS.get(userId) ?? []).filter((t) => now - t < WINDOW_MS);
  recent.push(now);
  HITS.set(userId, recent);
  return recent.length > MAX_HITS;
}

const MESSAGES: Record<ExtractError, string> = {
  bad_url: "That doesn't look like a product link.",
  blocked_host: "That link can't be opened.",
  unreachable: "Couldn't reach that page — check the link and try again.",
  captcha:
    "That site blocks automated reads (TikTok Shop and analytics tools like Kalodata both do). Paste the product page from your own store instead.",
  no_product_data:
    "That page doesn't publish product details we can read. Upload the photos and describe it instead.",
};

interface Body {
  url?: string;
  /** Optional user direction, kept as the angle for the brief. */
  angle?: string;
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as Body;
  const url = (body.url ?? "").trim().slice(0, 2048);
  const angle = (body.angle ?? "").trim().slice(0, 300);
  if (!url) {
    return NextResponse.json({ error: "Add a product link first." }, { status: 400 });
  }

  if (throttled(user.id, Date.now())) {
    return NextResponse.json(
      { error: "Slow down a moment and try again." },
      { status: 429 },
    );
  }

  const result = await extractProduct(url);
  if (!result.ok) {
    return NextResponse.json(
      { code: result.error, error: MESSAGES[result.error] },
      // A blocked host is the caller's fault; an unreadable store is not.
      { status: result.error === "bad_url" || result.error === "blocked_host" ? 400 : 422 },
    );
  }

  const images = await prepareProductImages(result.images, MAX_IMAGES);

  const warnings: string[] = [];
  if (images.length === 0) {
    warnings.push("We couldn't read any usable photos — stock images will be used.");
  } else if (images.length < 3) {
    warnings.push(
      `Only ${images.length} usable photo${images.length === 1 ? "" : "s"} on that page — the rest of the deck will use stock images.`,
    );
  }
  if (!result.description) {
    warnings.push("That page has no product description, so the copy leans on the title and price.");
  }

  // Resolved HERE, from the short topic line, and passed through as an explicit
  // slug so /api/generate never keyword-votes over the scraped brief. That vote
  // is built for a sentence a human typed; against 3.5k characters of page copy
  // a single stray word decides the deck's entire visual direction.
  const niche = resolveNiche(undefined, productTopicLine(result));

  return NextResponse.json({
    niche,
    product: {
      title: result.title,
      vendor: result.vendor,
      productType: result.productType,
      priceMin: result.priceMin,
      priceMax: result.priceMax,
      currency: result.currency,
      inStock: result.inStock,
      url: result.url,
      tier: result.tier,
      imageCount: images.length,
    },
    images: images.map((i) => i.dataUrl),
    brief: buildProductBrief(result, angle),
    warnings,
  });
}
