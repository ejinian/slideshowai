import { GENERATOR_NICHES } from "@/lib/generator-options";

// The composer no longer asks the user to pick a niche — it caused a whole class
// of bug (niche says "Gym", prompt is about coffee) and it's friction most users
// got wrong anyway. Instead we derive it from the prompt here.
//
// Niche is a SOFT input: it only steers trend-exemplar selection (a coarse
// 5-bucket taxonomy) and the aesthetic image "vibe" pool. It never decides the
// copy — the prompt is the topic. So a fast, dependency-free keyword vote is
// plenty; a wrong guess just means slightly less-targeted trends, never a broken
// slideshow. "Let AI decide" bypasses this entirely (its planner picks the niche
// and passes it through explicitly).

const NICHE_SLUGS = new Set(GENERATOR_NICHES.map((n) => n.value));

// Trigger words per niche. Matched on word boundaries so "eat" doesn't fire on
// "theater". Multi-word phrases (e.g. "real estate") are matched as substrings.
const KEYWORDS: Record<string, string[]> = {
  gym: [
    "gym", "workout", "fitness", "exercise", "exercises", "muscle", "muscles",
    "abs", "lifting", "lift", "weights", "cardio", "training", "trainer",
    "reps", "protein", "gains", "physique", "bodybuilding", "crossfit", "squat",
    "squats", "bench", "deadlift", "pushup", "pushups", "run", "running",
    "marathon", "yoga", "pilates", "calisthenics", "hypertrophy", "shredded",
  ],
  food: [
    "food", "recipe", "recipes", "cook", "cooking", "meal", "meals", "dish",
    "dishes", "restaurant", "eat", "eating", "dinner", "lunch", "breakfast",
    "kitchen", "chef", "cuisine", "snack", "snacks", "dessert", "baking",
    "diet", "nutrition", "menu", "foodie",
  ],
  fashion: [
    "fashion", "outfit", "outfits", "clothing", "clothes", "style", "styling",
    "wear", "wardrobe", "dress", "apparel", "streetwear", "trendy", "lookbook",
    "thrift", "accessories", "sneakers", "denim",
  ],
  realestate: [
    "real estate", "property", "properties", "home", "house", "houses",
    "listing", "listings", "mortgage", "realtor", "apartment", "rent",
    "rental", "buyer", "seller", "renovation", "staging", "neighborhood",
    "condo", "homebuyer",
  ],
  beauty: [
    "beauty", "skincare", "makeup", "skin", "cosmetic", "cosmetics", "serum",
    "moisturizer", "glow", "retinol", "foundation", "lipstick", "haircare",
    "salon", "nails", "spa", "facial", "acne", "dermatologist", "barber",
  ],
  cafe: [
    "cafe", "café", "coffee", "espresso", "latte", "barista", "brew",
    "cappuccino", "roast", "beans", "matcha", "tea", "cold brew", "americano",
    "drink", "drinks", "beverage",
  ],
  ecommerce: [
    "ecommerce", "e-commerce", "dropship", "dropshipping", "shopify",
    "product launch", "our product", "our brand", "online store", "sku",
    "add to cart", "shipping", "restock",
  ],
};

function labelForSlug(slug: string): string {
  return GENERATOR_NICHES.find((n) => n.value === slug)?.label ?? slug;
}

/**
 * Best-guess niche slug for a prompt (one of GENERATOR_NICHES' values, else
 * "other"). Scores each niche by distinct keyword hits and takes the winner;
 * ties resolve to the earliest niche in KEYWORDS order.
 */
export function detectNiche(prompt: string): string {
  const text = ` ${(prompt || "").toLowerCase()} `;
  let best = "other";
  let bestScore = 0;
  for (const [slug, words] of Object.entries(KEYWORDS)) {
    let score = 0;
    for (const w of words) {
      const hit = w.includes(" ")
        ? text.includes(` ${w} `) || text.includes(`${w}`)
        : new RegExp(`\\b${w}\\b`).test(text);
      if (hit) score++;
    }
    if (score > bestScore) {
      bestScore = score;
      best = slug;
    }
  }
  return best;
}

/**
 * Resolve the niche for a generation. An explicit slug (from "Let AI decide")
 * always wins; otherwise derive it from the prompt. Returns both the slug (image
 * collection / trend key) and the display label (copy context, stored row).
 */
export function resolveNiche(
  explicitSlug: string | undefined,
  prompt: string | undefined,
): { slug: string; label: string } {
  const slug =
    explicitSlug && NICHE_SLUGS.has(explicitSlug)
      ? explicitSlug
      : detectNiche(prompt || "");
  return { slug, label: labelForSlug(slug) };
}
