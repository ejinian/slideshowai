// Mock data + typed placeholder mutations for the "Grow" feature set
// (Inspiration, Collections, Schedule, Analytics, Activation checklist).
//
// UI-ONLY: every consumer imports from here so the real Supabase queries can
// be swapped in behind the same types later. The async stubs simulate network
// latency and succeed unconditionally.

/* ── shared ───────────────────────────────────────────────────────────────── */

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Local image pool (checked into /public) reused across all mocks.
const GYM = (n: string) => `/library/gym/gym-${n}.jpg`;
const DEMO = (n: string) => `/demo/${n}.jpeg`;

/* ── 1. Inspiration Library ───────────────────────────────────────────────── */

export const BUSINESS_TYPES = [
  "Gym & Fitness",
  "E-commerce",
  "Local Service",
  "B2C App",
  "Food & Dining",
] as const;
export type BusinessType = (typeof BUSINESS_TYPES)[number];

export interface InspirationSlide {
  image: string;
  caption: string;
}

export interface InspirationItem {
  id: string;
  title: string;
  description: string;
  businessType: BusinessType;
  cover: string;
  slides: InspirationSlide[];
  views: number;
  likes: number;
  /** ISO date the original went up — drives the "Recent" sort */
  postedAt: string;
}

function insp(
  id: string,
  businessType: BusinessType,
  title: string,
  description: string,
  views: number,
  likes: number,
  postedAt: string,
  images: string[],
  captions: string[],
): InspirationItem {
  return {
    id,
    businessType,
    title,
    description,
    views,
    likes,
    postedAt,
    cover: images[0],
    slides: images.map((image, i) => ({
      image,
      caption: captions[i] ?? captions[captions.length - 1],
    })),
  };
}

export const INSPIRATION_ITEMS: InspirationItem[] = [
  insp("in-01", "Gym & Fitness", "POV: the gym that feels like home", "Warm POV tour that converts lurkers into trial members.", 3_400_000, 289_000, "2026-06-21", [GYM("01"), GYM("16"), GYM("10"), GYM("07"), GYM("17")], [
    "POV: you finally found a gym that feels like home",
    "24/7 access. No contracts. No judgment.",
    "Coaching that actually moves the needle",
    "Day 1 vs day 90 — same person, new energy",
    "Your first week is on us → link in bio",
  ]),
  insp("in-02", "Gym & Fitness", "3 reasons you're still skipping leg day", "Listicle hook with a coaching CTA on the last slide.", 1_850_000, 122_000, "2026-06-24", [GYM("05"), GYM("09"), GYM("13"), GYM("02")], [
    "3 reasons you're still skipping leg day",
    "1. No plan — you wing it and it shows",
    "2. You train alone. Accountability changes everything",
    "3. Fix both with a coach → link in bio",
  ]),
  insp("in-03", "Gym & Fitness", "Day 1 vs Day 90 transformation", "Before/after arc — the highest-saving format in fitness.", 5_100_000, 431_000, "2026-05-30", [GYM("07"), GYM("11"), GYM("18"), GYM("04")], [
    "Day 1: couldn't finish the warm-up",
    "Day 30: showing up became automatic",
    "Day 60: strangers started asking my routine",
    "Day 90: unrecognizable. Start yours → bio",
  ]),
  insp("in-04", "Gym & Fitness", "What $49/month actually gets you", "Price-transparency series that de-risks the signup.", 920_000, 61_000, "2026-06-27", [GYM("14"), GYM("03"), GYM("08"), GYM("12")], [
    "What $49/month actually gets you here",
    "Every class. Every machine. Zero upsells.",
    "Sauna, recovery room, 24/7 badge access",
    "Tour it yourself — book free in bio",
  ]),
  insp("in-05", "E-commerce", "Products that sell themselves on camera", "Simple product-in-hand shots with benefit captions.", 2_700_000, 198_000, "2026-06-18", [DEMO("saas-2"), DEMO("saas-1"), DEMO("saas-4"), DEMO("saas-3")], [
    "5 products our customers won't shut up about",
    "#1 restocks sold out 3 times this month",
    "Real reviews. Real results. No filter.",
    "Free shipping this week → link in bio",
  ]),
  insp("in-06", "E-commerce", "Unboxing that stops the scroll", "First-person unboxing beats studio shots every time.", 1_300_000, 87_000, "2026-06-25", [DEMO("saas-4"), DEMO("saas-2"), DEMO("diet-2"), DEMO("saas-1")], [
    "The unboxing everyone's tagging friends in",
    "Details you only notice in person",
    "Packaging is part of the product",
    "Get yours before Friday → bio",
  ]),
  insp("in-07", "E-commerce", "3 mistakes killing your cart", "Problem/solution carousel for DTC founders' audiences.", 760_000, 44_000, "2026-06-28", [DEMO("saas-3"), DEMO("saas-1"), DEMO("golf-4"), DEMO("saas-2")], [
    "3 mistakes killing your checkout rate",
    "1. Shipping surprise at the last step",
    "2. No reviews where they're deciding",
    "3. Fix both in one afternoon → bio",
  ]),
  insp("in-08", "E-commerce", "Restock day behind the scenes", "BTS restock content builds drop-day urgency.", 3_900_000, 305_000, "2026-06-02", [DEMO("saas-1"), DEMO("saas-3"), DEMO("saas-4"), DEMO("saas-2")], [
    "Restock day. 400 units. Watch them go.",
    "Packed by hand, checked twice",
    "Last drop sold out in 41 minutes",
    "Notify me is live → link in bio",
  ]),
  insp("in-09", "Local Service", "Before your lawn / after our crew", "Before/after with local geotag — cheap leads for services.", 640_000, 38_000, "2026-06-26", [DEMO("golf-2"), DEMO("golf-1"), DEMO("golf-3"), DEMO("golf-4")], [
    "Your lawn is one visit away from this",
    "Before: patchy, tired, weekend-eating",
    "After: the yard the neighbors mention",
    "Free quote, this week only → bio",
  ]),
  insp("in-10", "Local Service", "A day with our install team", "Day-in-the-life humanizes the crew and books calls.", 1_100_000, 74_000, "2026-06-15", [DEMO("golf-3"), DEMO("golf-4"), DEMO("golf-1"), DEMO("golf-2")], [
    "6am: coffee, checklist, van loaded",
    "9am: first install of the day",
    "2pm: walkthrough with the homeowner",
    "Want us next? Book in bio",
  ]),
  insp("in-11", "Local Service", "5 signs you need us (slide 3 hurts)", "Symptom checklist that makes viewers self-qualify.", 2_200_000, 156_000, "2026-06-09", [DEMO("golf-4"), DEMO("golf-2"), DEMO("golf-3"), DEMO("golf-1"), DEMO("saas-3")], [
    "5 signs it's time to call a pro",
    "1. The DIY fix didn't hold",
    "2. It's costing you every month now",
    "3. You've stopped inviting people over",
    "We fix all five → link in bio",
  ]),
  insp("in-12", "Local Service", "What a $99 tune-up includes", "Price-anchored checklist — kills the fear of hidden fees.", 480_000, 27_000, "2026-06-29", [DEMO("golf-1"), DEMO("golf-3"), DEMO("golf-2"), DEMO("golf-4")], [
    "Everything in our $99 tune-up",
    "21-point inspection, photos included",
    "Same-day report, zero pressure",
    "Book this week → link in bio",
  ]),
  insp("in-13", "B2C App", "I replaced 4 apps with this one", "Consolidation hook — the highest-CTR app format.", 4_600_000, 388_000, "2026-06-05", [DEMO("saas-1"), DEMO("saas-2"), DEMO("saas-3"), DEMO("saas-4")], [
    "I replaced 4 apps with this one",
    "To-dos, notes, focus timer, journal",
    "My screen time went DOWN using it",
    "Free to start → link in bio",
  ]),
  insp("in-14", "B2C App", "My 5-9 before my 9-5 (with the app)", "Routine content with the product woven in naturally.", 2_900_000, 241_000, "2026-06-12", [DEMO("diet-1"), DEMO("saas-3"), DEMO("saas-2"), DEMO("saas-4")], [
    "My 5-9 before my 9-5",
    "5:30 — plan the day in one place",
    "7:00 — workout logged automatically",
    "It's all one app → bio",
  ]),
  insp("in-15", "B2C App", "3 features you're not using", "Feature-discovery carousel that re-activates users.", 1_050_000, 69_000, "2026-06-22", [DEMO("saas-2"), DEMO("saas-4"), DEMO("saas-1"), DEMO("saas-3")], [
    "3 features you're sleeping on",
    "1. Focus mode blocks your feeds",
    "2. Weekly review writes itself",
    "3. Try them today → link in bio",
  ]),
  insp("in-16", "B2C App", "POV: your to-do list is finally done", "Aspirational POV — sells the feeling, not the features.", 1_700_000, 133_000, "2026-06-19", [DEMO("saas-3"), DEMO("saas-2"), DEMO("saas-4"), DEMO("saas-1")], [
    "POV: your to-do list is finally done",
    "Everything captured. Nothing forgotten.",
    "10 minutes of review, zero anxiety",
    "Start free → link in bio",
  ]),
  insp("in-17", "Food & Dining", "Rating our menu until you order it", "Self-aware menu rating — huge for local restaurants.", 3_100_000, 274_000, "2026-06-08", [DEMO("diet-1"), DEMO("diet-2"), DEMO("diet-3"), DEMO("diet-4")], [
    "Rating our own menu (brutally honest)",
    "The bowl that carries the lunch rush: 9.4",
    "The sleeper hit nobody orders: 9.9",
    "Tag who you're bringing → we're open late",
  ]),
  insp("in-18", "Food & Dining", "What $12 gets you at lunch here", "Price-anchored plating shots drive same-day visits.", 890_000, 58_000, "2026-06-23", [DEMO("diet-3"), DEMO("diet-1"), DEMO("diet-4"), DEMO("diet-2")], [
    "What $12 gets you here at lunch",
    "Built today, gone by 1pm",
    "Yes, the sauce is made in-house",
    "5 minutes from downtown → directions in bio",
  ]),
  insp("in-19", "Food & Dining", "Behind the pass on a Friday night", "Kitchen BTS — authenticity beats food porn now.", 1_450_000, 119_000, "2026-06-13", [DEMO("diet-2"), DEMO("diet-4"), DEMO("diet-1"), DEMO("diet-3")], [
    "Friday, 7:42pm. Behind the pass.",
    "86 tickets and counting",
    "Every plate checked before it leaves",
    "Book the weekend → link in bio",
  ]),
  insp("in-20", "Food & Dining", "3 dishes locals gatekeep", "Local-secret angle converts tourists and new movers.", 2_050_000, 164_000, "2026-06-16", [DEMO("diet-4"), DEMO("diet-3"), DEMO("diet-2"), DEMO("diet-1")], [
    "3 dishes locals don't want you to know",
    "1. The off-menu breakfast bowl",
    "2. Wednesday-only special",
    "3. Come find #3 yourself → bio",
  ]),
];

/** Placeholder — will kick the generator off with this item's format. */
export async function applyTemplate(itemId: string): Promise<{ ok: true; itemId: string }> {
  await delay(450);
  return { ok: true, itemId };
}

/* ── 1b. Trends — top slideshows on TikTok, last 24h ──────────────────────── */

export interface TrendingSlideshow {
  id: string;
  /** Global rank across all niches for the current window. */
  rank: number;
  /** The hook / caption of the original post. */
  title: string;
  author: string;
  niche: BusinessType;
  cover: string;
  slideCount: number;
  views24h: number;
  /** Velocity — views gained per hour since posting. */
  viewsPerHour: number;
  likes: number;
  postedAgoHours: number;
  /** Link to the original post. Mock URLs until the provider feed lands. */
  tiktokUrl: string;
  /** One-line teardown — the teaching layer. */
  whyItWorks: string;
}

export interface TrendingFeed {
  /** Minutes since the cache was refreshed (mock: fixed). */
  updatedMinutesAgo: number;
  /** "live" = trending_posts cache; "sample" = bundled mock data. */
  source: "live" | "sample";
  /** Human label for the ranking window, e.g. "Last 7 days". */
  windowLabel: string;
  items: TrendingSlideshow[];
}

const MOCK_TRENDING: TrendingSlideshow[] = [
  { id: "tr-01", rank: 1, title: "POV: day 1 at the gym vs day 180", author: "@liftwithmarco", niche: "Gym & Fitness", cover: GYM("07"), slideCount: 6, views24h: 4_800_000, viewsPerHour: 342_000, likes: 512_000, postedAgoHours: 14, tiktokUrl: "https://www.tiktok.com/@liftwithmarco", whyItWorks: "Transformation arc + POV framing — viewers project themselves into slide 1 and swipe to see the payoff." },
  { id: "tr-02", rank: 2, title: "3 menu items our regulars gatekeep", author: "@fern.cafe", niche: "Food & Dining", cover: DEMO("diet-1"), slideCount: 4, views24h: 3_100_000, viewsPerHour: 194_000, likes: 287_000, postedAgoHours: 16, tiktokUrl: "https://www.tiktok.com/@fern.cafe", whyItWorks: "Numbered gatekeeping hook — implies insider knowledge and dares the viewer to check slide 3." },
  { id: "tr-03", rank: 3, title: "I quit 4 productivity apps for this one", author: "@systemsbyjade", niche: "B2C App", cover: DEMO("saas-1"), slideCount: 5, views24h: 2_700_000, viewsPerHour: 130_000, likes: 231_000, postedAgoHours: 21, tiktokUrl: "https://www.tiktok.com/@systemsbyjade", whyItWorks: "Consolidation promise — 'replace 4 with 1' is the highest-CTR app hook of the year." },
  { id: "tr-04", rank: 4, title: "What $60 gets you at our detail shop", author: "@shinewerks", niche: "Local Service", cover: DEMO("golf-2"), slideCount: 5, views24h: 2_200_000, viewsPerHour: 245_000, likes: 176_000, postedAgoHours: 9, tiktokUrl: "https://www.tiktok.com/@shinewerks", whyItWorks: "Price-anchored reveal — concrete dollar amount in the hook filters for buyers, not browsers." },
  { id: "tr-05", rank: 5, title: "Restock day: 600 units in 4 hours", author: "@satchel.supply", niche: "E-commerce", cover: DEMO("saas-4"), slideCount: 6, views24h: 1_900_000, viewsPerHour: 105_000, likes: 158_000, postedAgoHours: 18, tiktokUrl: "https://www.tiktok.com/@satchel.supply", whyItWorks: "Scarcity told as BTS story — the countdown structure makes urgency feel earned, not salesy." },
  { id: "tr-06", rank: 6, title: "Rating my own gym brutally honestly", author: "@ironhouse.gc", niche: "Gym & Fitness", cover: GYM("01"), slideCount: 5, views24h: 1_650_000, viewsPerHour: 87_000, likes: 143_000, postedAgoHours: 19, tiktokUrl: "https://www.tiktok.com/@ironhouse.gc", whyItWorks: "Self-roast builds trust — the honest 6/10 on slide 3 makes the 10/10 finale believable." },
  { id: "tr-07", rank: 7, title: "Signs it's time to fire your landscaper", author: "@greenlinecrew", niche: "Local Service", cover: DEMO("golf-1"), slideCount: 4, views24h: 1_400_000, viewsPerHour: 64_000, likes: 98_000, postedAgoHours: 22, tiktokUrl: "https://www.tiktok.com/@greenlinecrew", whyItWorks: "Symptom checklist — viewers self-diagnose slide by slide, and sharing it does the selling." },
  { id: "tr-08", rank: 8, title: "My 5-9 before my 9-5 (realistic edition)", author: "@morninglab", niche: "B2C App", cover: DEMO("saas-3"), slideCount: 6, views24h: 1_250_000, viewsPerHour: 96_000, likes: 121_000, postedAgoHours: 13, tiktokUrl: "https://www.tiktok.com/@morninglab", whyItWorks: "'Realistic edition' subverts a tired format — the anti-aesthetic angle reads as honest." },
  { id: "tr-09", rank: 9, title: "Every dish under $10 on our lunch menu", author: "@banhmi.bros", niche: "Food & Dining", cover: DEMO("diet-3"), slideCount: 5, views24h: 1_100_000, viewsPerHour: 110_000, likes: 89_000, postedAgoHours: 10, tiktokUrl: "https://www.tiktok.com/@banhmi.bros", whyItWorks: "Budget-anchored tour — under-$10 framing gets saved as a lunch plan, and saves drive reach." },
  { id: "tr-10", rank: 10, title: "Packaging orders until one makes me cry", author: "@wickandwren", niche: "E-commerce", cover: DEMO("saas-2"), slideCount: 6, views24h: 960_000, viewsPerHour: 44_000, likes: 102_000, postedAgoHours: 23, tiktokUrl: "https://www.tiktok.com/@wickandwren", whyItWorks: "Emotional cliffhanger — the promised payoff slide keeps swipe-through near 100%." },
  { id: "tr-11", rank: 11, title: "3 lifts you're doing wrong (fix #2 today)", author: "@coachpriya", niche: "Gym & Fitness", cover: GYM("10"), slideCount: 4, views24h: 870_000, viewsPerHour: 52_000, likes: 76_000, postedAgoHours: 17, tiktokUrl: "https://www.tiktok.com/@coachpriya", whyItWorks: "Listicle + a pointer to slide 2 — telling viewers where the value is raises completion rate." },
  { id: "tr-12", rank: 12, title: "We renovated our studio for $3k. Tour:", author: "@formfitstudio", niche: "Local Service", cover: GYM("16"), slideCount: 6, views24h: 780_000, viewsPerHour: 39_000, likes: 71_000, postedAgoHours: 20, tiktokUrl: "https://www.tiktok.com/@formfitstudio", whyItWorks: "Budget + tour combo — the number sets expectations low and every slide over-delivers." },
];

/**
 * Sample feed — served until the `trending_posts` cache has live rows (see
 * lib/trends.ts, which prefers the DB and falls back to this).
 */
export async function getTrendingSlideshows(): Promise<TrendingFeed> {
  await delay(600);
  return {
    updatedMinutesAgo: 47,
    source: "sample",
    windowLabel: "Last 24 hours",
    items: MOCK_TRENDING,
  };
}

/* ── 2. Image Collections ─────────────────────────────────────────────────── */

export interface CollectionImage {
  id: string;
  url: string;
  name: string;
}

export interface ImageCollection {
  id: string;
  name: string;
  /** Feeds per-slide product placement in the generator when true. */
  isProductImages: boolean;
  createdAt: string;
  images: CollectionImage[];
}

const collImages = (urls: string[], prefix: string): CollectionImage[] =>
  urls.map((url, i) => ({
    id: `${prefix}-${i + 1}`,
    url,
    name: url.split("/").pop() ?? `image-${i + 1}`,
  }));

export const MOCK_COLLECTIONS: ImageCollection[] = [
  {
    id: "col-gym",
    name: "Gym floor & equipment",
    isProductImages: false,
    createdAt: "2026-06-10",
    images: collImages(
      ["01", "02", "03", "04", "05", "07", "08", "09", "10", "11", "13", "16"].map(GYM),
      "gym",
    ),
  },
  {
    id: "col-products",
    name: "Product shots — summer drop",
    isProductImages: true,
    createdAt: "2026-06-18",
    images: collImages(
      [DEMO("saas-1"), DEMO("saas-2"), DEMO("saas-3"), DEMO("saas-4"), DEMO("diet-2"), DEMO("diet-4")],
      "prod",
    ),
  },
  {
    id: "col-food",
    name: "Menu photography",
    isProductImages: false,
    createdAt: "2026-06-22",
    images: collImages([DEMO("diet-1"), DEMO("diet-2"), DEMO("diet-3"), DEMO("diet-4")], "food"),
  },
  {
    id: "col-empty",
    name: "Fall campaign",
    isProductImages: false,
    createdAt: "2026-06-29",
    images: [],
  },
];

/** Placeholder — will create the collection server-side later. */
export async function createCollection(name: string): Promise<ImageCollection> {
  await delay(400);
  return {
    id: `col-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
    name,
    isProductImages: false,
    createdAt: "2026-07-01",
    images: [],
  };
}

/** Placeholder — will delete images server-side later. */
export async function deleteCollectionImages(
  collectionId: string,
  imageIds: string[],
): Promise<{ ok: true; deleted: number }> {
  await delay(350);
  return { ok: true, deleted: imageIds.length };
}

/* ── 3. Schedule ──────────────────────────────────────────────────────────── */

export interface TikTokAccount {
  id: string;
  handle: string;
  displayName: string;
  connected: boolean;
}

export const MOCK_ACCOUNTS: TikTokAccount[] = [
  { id: "acct-1", handle: "@irontemplegym", displayName: "Iron Temple Gym", connected: true },
];

export interface GeneratedSlideshow {
  id: string;
  title: string;
  thumbnail: string;
  slideCount: number;
}

export const MOCK_GENERATED: GeneratedSlideshow[] = [
  { id: "gen-1", title: "POV: gym that feels like home", thumbnail: GYM("01"), slideCount: 5 },
  { id: "gen-2", title: "3 reasons you're skipping leg day", thumbnail: GYM("05"), slideCount: 4 },
  { id: "gen-3", title: "Day 1 vs Day 90", thumbnail: GYM("07"), slideCount: 4 },
  { id: "gen-4", title: "What $49/month gets you", thumbnail: GYM("14"), slideCount: 4 },
  { id: "gen-5", title: "New member week", thumbnail: GYM("17"), slideCount: 6 },
  { id: "gen-6", title: "Coach spotlight: Dana", thumbnail: GYM("10"), slideCount: 5 },
];

export interface ScheduledPost {
  id: string;
  slideshowId: string;
  /** 0 = Monday of the visible week … 6 = Sunday. */
  dayOffset: number;
  /** 24h "HH:MM" */
  time: string;
  caption: string;
  accountId: string;
}

export const MOCK_SCHEDULED: ScheduledPost[] = [
  { id: "sch-1", slideshowId: "gen-1", dayOffset: 0, time: "09:00", caption: "POV: you finally found a gym that feels like home. First week free — link in bio.", accountId: "acct-1" },
  { id: "sch-2", slideshowId: "gen-2", dayOffset: 1, time: "17:30", caption: "3 reasons you're still skipping leg day (number 2 is fixable today).", accountId: "acct-1" },
  { id: "sch-3", slideshowId: "gen-3", dayOffset: 3, time: "12:00", caption: "Day 1 vs Day 90. Same person. Different energy.", accountId: "acct-1" },
  { id: "sch-4", slideshowId: "gen-5", dayOffset: 4, time: "08:30", caption: "New member week starts Monday. Bring a friend, both train free.", accountId: "acct-1" },
  { id: "sch-5", slideshowId: "gen-6", dayOffset: 5, time: "19:00", caption: "Meet Dana. 12 years coaching, zero ego. Book a session in bio.", accountId: "acct-1" },
];

export interface SchedulePostInput {
  slideshowId: string;
  date: string; // yyyy-mm-dd
  time: string; // HH:MM
  caption: string;
  accountId: string;
}

/** Placeholder — will hit the TikTok content-posting API later. */
export async function schedulePost(input: SchedulePostInput): Promise<{ ok: true; input: SchedulePostInput }> {
  await delay(500);
  return { ok: true, input };
}

/* ── 4. Analytics ─────────────────────────────────────────────────────────── */

export interface StatCard {
  label: string;
  value: string;
  /** Percent change vs last week; negative = down. */
  delta: number;
}

export const ANALYTICS_STATS: StatCard[] = [
  { label: "Total Views", value: "1.28M", delta: 12.4 },
  { label: "Total Likes", value: "94.2k", delta: 8.1 },
  { label: "Posts This Week", value: "5", delta: 25.0 },
  { label: "Avg Views / Post", value: "42.6k", delta: -3.2 },
];

export interface DailyViews {
  /** Short label, e.g. "Jun 4" */
  date: string;
  views: number;
}

// Deterministic 30-day series (no Math.random — identical on server & client).
const MONTHS = ["Jun", "Jul"] as const;
export const VIEWS_30D: DailyViews[] = Array.from({ length: 30 }, (_, i) => {
  const day = i + 2; // Jun 2 … Jul 1
  const month = MONTHS[day > 30 ? 1 : 0];
  const label = `${month} ${day > 30 ? day - 30 : day}`;
  const trend = 18_000 + i * 900;
  const wave = Math.sin(i / 3.1) * 6_500 + Math.sin(i / 1.7) * 2_800;
  const spike = i === 21 ? 26_000 : i === 11 ? 12_000 : 0;
  return { date: label, views: Math.max(4_000, Math.round(trend + wave + spike)) };
});

export interface PostedRow {
  id: string;
  title: string;
  thumbnail: string;
  postedAt: string; // ISO date
  views: number;
  likes: number;
}

export const POSTED_ROWS: PostedRow[] = [
  { id: "post-1", title: "POV: gym that feels like home", thumbnail: GYM("01"), postedAt: "2026-06-29", views: 184_200, likes: 14_100 },
  { id: "post-2", title: "3 reasons you're skipping leg day", thumbnail: GYM("05"), postedAt: "2026-06-27", views: 96_400, likes: 6_800 },
  { id: "post-3", title: "Day 1 vs Day 90", thumbnail: GYM("07"), postedAt: "2026-06-24", views: 421_900, likes: 38_600 },
  { id: "post-4", title: "What $49/month gets you", thumbnail: GYM("14"), postedAt: "2026-06-21", views: 58_300, likes: 3_900 },
  { id: "post-5", title: "New member week", thumbnail: GYM("17"), postedAt: "2026-06-18", views: 132_700, likes: 11_200 },
  { id: "post-6", title: "Coach spotlight: Dana", thumbnail: GYM("10"), postedAt: "2026-06-14", views: 77_500, likes: 5_400 },
  { id: "post-7", title: "Sauna & recovery room tour", thumbnail: GYM("13"), postedAt: "2026-06-10", views: 244_800, likes: 19_700 },
  { id: "post-8", title: "Member wins: June", thumbnail: GYM("18"), postedAt: "2026-06-06", views: 63_100, likes: 4_600 },
];

/* ── 5. Activation checklist ──────────────────────────────────────────────── */

export interface ActivationStep {
  id: "create" | "connect" | "schedule";
  label: string;
  done: boolean;
}

export const ACTIVATION_STEPS: ActivationStep[] = [
  { id: "create", label: "Create your first slideshow", done: true },
  { id: "connect", label: "Connect your TikTok account", done: false },
  { id: "schedule", label: "Schedule your first post", done: false },
];

/** Placeholder — will persist the dismissal to user metadata later. */
export async function dismissActivation(): Promise<{ ok: true }> {
  await delay(250);
  return { ok: true };
}

/* ── formatting helpers shared by the Grow pages ──────────────────────────── */

export function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, "")}k`;
  return String(n);
}
