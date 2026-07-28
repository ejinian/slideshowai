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

export const TESTIMONIALS: Testimonial[] = [
  {
    name: "La Croix Enjoyer",
    handle: "@HamrSldg",
    avatarSrc: "/testimonials/hamrsldg.jpg",
    url: "https://x.com/HamrSldg/status/2081882164233482641",
    source: "x",
    stars: 5,
    quote: [
      { text: "Sheesh I used 6 random photos, it actually " },
      { text: "arranged them correctly and used non-AI-sounding captions", mark: true },
      { text: ". Impressive" },
    ],
  },
];

// Layout scaffold ONLY — obviously-fake copy so the wall can be eyeballed
// before real quotes exist. Rendered in `next dev` and nowhere else (see
// Community.tsx), so these can never reach a visitor as real reviews.
export const PLACEHOLDER_TESTIMONIALS: Testimonial[] = [
  {
    name: "Placeholder",
    handle: "@example",
    url: "https://example.com/sample-post",
    source: "x",
    stars: 5,
    quote: [
      { text: "sample text — posted four decks last week, " },
      { text: "one hit 180k views", mark: true },
      { text: " off a 300-follower account" },
    ],
  },
  {
    name: "Placeholder",
    handle: "@example",
    url: "https://example.com/sample-post",
    source: "x",
    stars: 5,
    quote: [
      { text: "sample text — the part I didn't expect is the captions. I've tried three of these tools and the others all write like a LinkedIn post. " },
      { text: "these actually sound like something a person would post", mark: true },
      { text: ", and I can edit any of them before it goes out." },
    ],
  },
  {
    name: "Placeholder",
    url: "https://example.com/sample-post",
    source: "youtube",
    quote: [{ text: "sample text — a card with no star rating, e.g. a podcast or video mention" }],
  },
  {
    name: "Placeholder",
    handle: "@example",
    url: "https://example.com/sample-post",
    source: "x",
    stars: 5,
    quote: [
      { text: "sample text — went from filming reels for two hours to " },
      { text: "a week of posts in about ten minutes", mark: true },
    ],
  },
  {
    name: "Placeholder",
    handle: "@example",
    url: "https://example.com/sample-post",
    source: "x",
    stars: 5,
    quote: [{ text: "sample text — a short one-line reply" }],
  },
  {
    name: "Placeholder",
    handle: "@example",
    url: "https://example.com/sample-post",
    source: "x",
    stars: 5,
    quote: [
      { text: "sample text — a reply that runs to about two lines, so the wall has a mix of card heights to balance across columns" },
    ],
  },
];
