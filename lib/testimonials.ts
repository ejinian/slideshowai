// Real customer quotes for the landing page's Community wall.
//
// EVERY entry must be something a real person actually said, and `url` must
// point at the real post so a skeptic can click through and verify it. That
// verifiability is the entire reason the section converts — invented names,
// avatars or quotes would be fake reviews, which is illegal in a lot of places
// and fatal to trust the moment anyone checks.
//
// The section renders nothing while this array is empty, so it's safe to ship
// and fill in later. Three real quotes beat nine invented ones.

export type TestimonialSource = "x" | "youtube";

// A quote is a list of segments so highlights are explicit rather than parsed
// out of markup. Skimmers read only the `mark: true` parts — that's the whole
// persuasion mechanism, so highlight concrete claims (numbers, outcomes), not
// adjectives.
export interface QuoteSegment {
  text: string;
  mark?: boolean;
}

export interface Testimonial {
  /** Stable key + the display name on the card. */
  name: string;
  /** Shown under the name, e.g. "@handle". Optional. */
  handle?: string;
  /** Square image in /public (or Storage). Don't hotlink X's CDN — it breaks. */
  avatarSrc?: string;
  /** Permalink to the real post. Required: it's what makes the card checkable. */
  url: string;
  source: TestimonialSource;
  /** 1–5. Omit for cards that aren't reviews (a podcast mention, say). */
  stars?: number;
  quote: QuoteSegment[];
  /** Optional image under the quote — a results screenshot, a video thumb. */
  media?: {
    src: string;
    alt: string;
    /** Rendered with a play badge when the source is a video. */
    isVideo?: boolean;
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Add real quotes here. Example of the shape (keep it commented until it's a
// genuine post you can link):
//
// {
//   name: "Jane Doe",
//   handle: "@janedoe",
//   avatarSrc: "/testimonials/janedoe.jpg",
//   url: "https://x.com/janedoe/status/1234567890",
//   source: "x",
//   stars: 5,
//   quote: [
//     { text: "posted 4 slideshows last week, " },
//     { text: "one hit 180k views", mark: true },
//     { text: " off a 300-follower account" },
//   ],
// },
// ─────────────────────────────────────────────────────────────────────────────

export const TESTIMONIALS: Testimonial[] = [];

// Layout scaffold ONLY — obviously-fake copy so the wall can be eyeballed
// before real quotes exist. Rendered in `next dev` and nowhere else (see
// Community.tsx), so these can never reach a visitor as real reviews.
export const PLACEHOLDER_TESTIMONIALS: Testimonial[] = [
  {
    name: "Placeholder — short",
    handle: "@sample",
    url: "https://example.com/sample-post",
    source: "x",
    stars: 5,
    quote: [
      { text: "sample quote, four decks last week and " },
      { text: "one hit 180k views", mark: true },
    ],
  },
  {
    name: "Placeholder — long",
    handle: "@sample",
    url: "https://example.com/sample-post",
    source: "x",
    stars: 5,
    quote: [
      { text: "sample quote used to check that a long card keeps its own height instead of stretching to match its neighbours — " },
      { text: "the highlighted claim carries the pitch", mark: true },
      { text: " for anyone skimming, and the rest is filler to push this card taller than the others in its column." },
    ],
  },
  {
    name: "Placeholder — video",
    url: "https://example.com/sample-post",
    source: "youtube",
    quote: [{ text: "sample quote for a card with no star rating, e.g. a podcast mention" }],
  },
  {
    name: "Placeholder — medium",
    handle: "@sample",
    url: "https://example.com/sample-post",
    source: "x",
    stars: 5,
    quote: [
      { text: "sample quote of middling length with " },
      { text: "a highlight in the middle", mark: true },
      { text: " of the sentence" },
    ],
  },
  {
    name: "Placeholder — tiny",
    handle: "@sample",
    url: "https://example.com/sample-post",
    source: "x",
    stars: 5,
    quote: [{ text: "sample one-liner" }],
  },
  {
    name: "Placeholder — two lines",
    handle: "@sample",
    url: "https://example.com/sample-post",
    source: "x",
    stars: 5,
    quote: [
      { text: "sample quote that runs to about two lines so the column has a mix of heights to balance" },
    ],
  },
];
