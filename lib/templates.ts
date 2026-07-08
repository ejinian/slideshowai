// Curated slideshow FORMAT templates — the same "format DNA" shape the trends
// curator extracts (hook type + slide-by-slide anatomy), hand-picked and
// evergreen. "Use template" personalizes the format to the user's business
// via /api/templates/apply and prefills the Generator.

import type { AnatomyBeat } from "@/lib/trends";

export type TemplateGoal = "sell" | "educate" | "story";

export interface SlideshowTemplate {
  id: string;
  name: string;
  /** Format label, same vocabulary as trends hook_type. */
  hookType: string;
  goal: TemplateGoal;
  /** One-line pitch shown in the modal. */
  description: string;
  /** Example hook caption drawn on the preview card. */
  exampleHook: string;
  slideCount: number;
  /** Generator layout option value. */
  layout: string;
  anatomy: AnatomyBeat[];
  /** What the personalizer needs to know about the mechanic. */
  mechanic: string;
  /** Library image path for the card preview ({collection}/{id}.jpg). */
  previewImage: string;
}

export const TEMPLATE_GOALS: { value: TemplateGoal | "all"; label: string }[] = [
  { value: "all", label: "All" },
  { value: "sell", label: "Sell" },
  { value: "educate", label: "Educate" },
  { value: "story", label: "Story" },
];

export const TEMPLATES: SlideshowTemplate[] = [
  {
    id: "transformation-arc",
    name: "Transformation arc",
    hookType: "Transformation arc",
    goal: "story",
    description:
      "Start deliberately unimpressive, end triumphant. Viewers project themselves into slide 1 and swipe for the payoff.",
    exampleHook: "POV: day 1 vs day 180",
    slideCount: 6,
    layout: "title-captions",
    anatomy: [
      { slides: "1", beat: "Hook — the rough 'day 1', no polish" },
      { slides: "2-5", beat: "Progress beats — one milestone per slide, dated" },
      { slides: "6", beat: "Payoff + soft CTA — 'your day 1 starts today'" },
    ],
    mechanic:
      "A before-to-after journey told chronologically. Slide 1 must be humble and real; the last slide lands the payoff and invites the viewer to start their own day 1.",
    previewImage: "gym/7186296.jpg",
  },
  {
    id: "price-anchor",
    name: "Price anchor",
    hookType: "Price anchor",
    goal: "sell",
    description:
      "A concrete dollar amount in the hook filters for buyers, not browsers — then every slide over-delivers on it.",
    exampleHook: "What $60 gets you here",
    slideCount: 5,
    layout: "title-captions",
    anatomy: [
      { slides: "1", beat: "Hook — name the exact price" },
      { slides: "2-4", beat: "Value reveal — one thing the money buys per slide" },
      { slides: "5", beat: "CTA — where and how to get it" },
    ],
    mechanic:
      "Anchor on a specific price in the hook, then stack value against it slide by slide until the price feels like a steal.",
    previewImage: "fashion/31870834.jpg",
  },
  {
    id: "mistake-listicle",
    name: "Mistake listicle",
    hookType: "Listicle",
    goal: "educate",
    description:
      "Numbered mistakes make viewers self-diagnose slide by slide — and sharing the fix does the selling for you.",
    exampleHook: "5 mistakes beginners make",
    slideCount: 7,
    layout: "title-captions",
    anatomy: [
      { slides: "1", beat: "Hook — the number + who it's for" },
      { slides: "2-6", beat: "One mistake per slide, each with the quick fix" },
      { slides: "7", beat: "Plug — how your business solves the whole list" },
    ],
    mechanic:
      "A numbered list of common mistakes in the niche, each paired with a one-line fix, ending with the business as the shortcut past all of them.",
    previewImage: "gym/4753890.jpg",
  },
  {
    id: "gatekeep-list",
    name: "Gatekeep list",
    hookType: "Gatekeep listicle",
    goal: "sell",
    description:
      "Implied insider knowledge — 'the things regulars don't want you to know' — dares the viewer to check every slide.",
    exampleHook: "3 things our regulars gatekeep",
    slideCount: 5,
    layout: "title-captions",
    anatomy: [
      { slides: "1", beat: "Hook — 'X things people gatekeep about us'" },
      { slides: "2-4", beat: "One insider pick per slide, told like a secret" },
      { slides: "5", beat: "CTA — come find out before everyone else does" },
    ],
    mechanic:
      "Frame the business's best items or features as insider secrets the regulars would rather keep quiet, revealed one per slide.",
    previewImage: "cafe/2335689.jpg",
  },
  {
    id: "pov-story",
    name: "POV story",
    hookType: "POV story",
    goal: "story",
    description:
      "Put the viewer inside the experience — 'POV: your first time here' — so every slide feels like their own memory.",
    exampleHook: "POV: your first visit",
    slideCount: 6,
    layout: "title-captions",
    anatomy: [
      { slides: "1", beat: "Hook — 'POV:' + the moment it starts" },
      { slides: "2-5", beat: "The experience beat by beat, second person" },
      { slides: "6", beat: "CTA — make the POV real" },
    ],
    mechanic:
      "Second-person narration walking the viewer through the experience of being a customer, moment by moment, ending with the invitation to live it.",
    previewImage: "travel/4004016.jpg",
  },
  {
    id: "before-after",
    name: "Before / after",
    hookType: "Before and after",
    goal: "story",
    description:
      "A number sets expectations low, then every slide over-delivers. Works for renovations, results, and glow-ups.",
    exampleHook: "We renovated for $3k. Tour:",
    slideCount: 4,
    layout: "title-captions",
    anatomy: [
      { slides: "1", beat: "Hook — the before + the constraint (budget, time)" },
      { slides: "2-3", beat: "The reveal — afters that beat expectations" },
      { slides: "4", beat: "CTA — come see it in person" },
    ],
    mechanic:
      "Contrast a modest 'before' plus a constraint against a striking 'after', letting the gap do the persuading.",
    previewImage: "beauty/11474613.jpg",
  },
  {
    id: "under-x-menu",
    name: "Everything under $X",
    hookType: "Budget tour",
    goal: "educate",
    description:
      "Budget-anchored tours get saved as plans — and saves drive reach harder than likes.",
    exampleHook: "Everything under $10 here",
    slideCount: 6,
    layout: "title-captions",
    anatomy: [
      { slides: "1", beat: "Hook — 'everything under $X at ...'" },
      { slides: "2-5", beat: "One item per slide with its exact price" },
      { slides: "6", beat: "CTA — save this for your next visit" },
    ],
    mechanic:
      "A guided tour of everything below a price threshold, one item and exact price per slide, framed to be saved for later.",
    previewImage: "food/36430080.jpg",
  },
  {
    id: "signs-checklist",
    name: "Signs checklist",
    hookType: "Symptom checklist",
    goal: "educate",
    description:
      "Viewers self-diagnose slide by slide — by the end, they've talked themselves into needing you.",
    exampleHook: "Signs it's time to switch",
    slideCount: 5,
    layout: "title-captions",
    anatomy: [
      { slides: "1", beat: "Hook — 'signs it's time to ...'" },
      { slides: "2-4", beat: "One sign per slide, painfully specific" },
      { slides: "5", beat: "Plug — the fix, without the hard sell" },
    ],
    mechanic:
      "A checklist of relatable pain signals in the niche; specificity makes viewers feel seen, and the final slide positions the business as the fix.",
    previewImage: "beauty/10199353.jpg",
  },
  {
    id: "honest-review",
    name: "Honest self-review",
    hookType: "Self-roast",
    goal: "story",
    description:
      "Rating yourself brutally honestly builds trust — the honest 6/10 makes the 10/10 finale believable.",
    exampleHook: "Rating us, brutally honestly",
    slideCount: 5,
    layout: "title-captions",
    anatomy: [
      { slides: "1", beat: "Hook — 'rating my own business, no mercy'" },
      { slides: "2-4", beat: "Mixed scores with real reasons — include a flaw" },
      { slides: "5", beat: "The 10/10 — the thing you're genuinely best at" },
    ],
    mechanic:
      "The owner reviews their own business with at least one honest flaw; the admitted weakness buys credibility for the closing strength.",
    previewImage: "gym/35540076.jpg",
  },
  {
    id: "day-in-life",
    name: "Day in the life",
    hookType: "BTS story",
    goal: "story",
    description:
      "Behind-the-scenes routine told hour by hour — familiarity turns viewers into regulars before they've visited.",
    exampleHook: "5am at our shop, every day",
    slideCount: 7,
    layout: "title-captions",
    anatomy: [
      { slides: "1", beat: "Hook — the earliest, most surprising moment" },
      { slides: "2-6", beat: "The day in timestamps, one scene per slide" },
      { slides: "7", beat: "CTA — come see the finished result" },
    ],
    mechanic:
      "A timestamped behind-the-scenes walk through a working day, from surprising start to the moment customers arrive.",
    previewImage: "cafe/22221948.jpg",
  },
];
