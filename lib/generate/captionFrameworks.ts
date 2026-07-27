// Caption VOICE frameworks, selected by how many slides the deck has.
//
// A listicle deck (4+ slides) and a two-photo post are different FORMATS, not
// the same format at different lengths. "day 1 of posting until this hits 1M
// views" is a complete post on its own — it's a punchline, and a punchline
// cannot open a 6-slide listicle. Feeding the same voice guidance to both
// produces a deck whose first slide promises a joke and then delivers bullets.
//
// So: short decks (1-3 slides) get an explicit framework describing the shape
// they actually are. Decks of 4+ get NOTHING — frameworkBlock() returns "" and
// the prompt they receive is byte-identical to before this file existed. That is
// deliberate: the listicle path is the tuned, working one and must not drift.
//
// WHY MECHANICS AND NOT PHRASES: the examples below teach a STRUCTURE, not copy.
// A model given bare strings pattern-matches the sample's subject matter into
// the user's unrelated deck. Naming the move ("the third beat breaks the
// pattern") is what actually transfers across topics.
//
// WHY TWO LANES: an all-comedy bank makes the model reach for a joke even when
// the user asked a sincere question. Given "how i grew my tiktok account" and
// three analytics screenshots it produced "my first tiktok hit 100k views" →
// "my next one barely hit 300" → "but here's what i learned from both" — a
// deflating arc that ends on a promise it never keeps. Every count now offers
// both a COMEDY and a VALUE lane, and the model picks from the topic's own tone.

/** Longest deck that gets a bespoke framework. 4+ uses the listicle path. */
export const SHORT_DECK_MAX = 3;

/**
 * The topic every example below is written for. Never the user's real topic.
 *
 * DELIBERATELY UNRELATED to what people actually type. It used to be "how to
 * grow my tiktok account", which collided head-on with a real test prompt ("how
 * i grew my tiktok account") — every "this is NOT your topic, read for the
 * mechanic" guardrail went inert, and the model just cloned the samples' subject
 * matter. Keep this a topic no user of a TikTok slideshow tool would ask for.
 */
const SAMPLE_TOPIC = "a neighbourhood coffee shop's slow morning";

interface ShortFormat {
  /** The mechanic. This is the part that transfers to another topic. */
  name: string;
  /** One line per slide, written for SAMPLE_TOPIC. */
  beats: string[];
  /** True when the humour is at the poster's own expense. */
  selfDeprecating?: boolean;
}

/* ── COMEDY lane: the swipe is a punchline ─────────────────────────────────
   Spine (2 slides): SLIDE 2 UNDERCUTS SLIDE 1.
   Spine (3 slides): THE THIRD BEAT TURNS.                                  */

const TWO_SLIDE_COMEDY: ShortFormat[] = [
  {
    name: "The self-own — slide 1 states the wisdom, slide 2 catches you ignoring it",
    beats: ["everyone: don't drink coffee after 2pm", "me, at 4pm:"],
    selfDeprecating: true,
  },
  {
    name: "The trap — slide 1 gives an order whose violation IS the payoff",
    beats: ["do not swipe", "you swiped. table's ready."],
    selfDeprecating: true,
  },
  {
    name: "The anticlimax — huge setup, deliberately deflating answer",
    beats: [
      "i tasted 40 espressos to find the best one",
      "conclusion: it's the one nearest your house. bye",
    ],
    selfDeprecating: true,
  },
  {
    name: "The tautology — the list answers itself",
    beats: ["reasons we're empty at 7am:", "1. it is 7am"],
    selfDeprecating: true,
  },
  {
    name: "The subverted transformation — the format promises change, nothing changed",
    beats: ["the cafe at opening", "the cafe at closing (identical)"],
    selfDeprecating: true,
  },
  {
    name: "The price reveal — invite a guess, then undercut it",
    beats: ["guess what this flat white costs", "less than your parking"],
  },
  {
    name: "The objection flip — name the doubt out loud, then dismantle it",
    beats: ["people think good coffee takes ten minutes", "ninety seconds"],
  },
];

const THREE_SLIDE_COMEDY: ShortFormat[] = [
  {
    name: "Escalation into collapse — the ambition grows, reality arrives",
    beats: [
      "i'll open at 6am",
      "i'll open at 5am",
      "we now open whenever i wake up",
    ],
    selfDeprecating: true,
  },
  {
    name: "Repetition then turn — say it twice, break it on three",
    beats: ["nobody comes in before 8", "nobody comes in before 8", "you came in."],
    selfDeprecating: true,
  },
  {
    name: "The list that betrays itself — promise many, deliver one",
    beats: ["things that fixed our mornings:", "1. opening earlier", "2. there is no 2"],
    selfDeprecating: true,
  },
  {
    name: "Three-column contrast — the third column is the honest one",
    beats: ["what the barista course says", "what actually works", "what i do at 6am"],
    selfDeprecating: true,
  },
  {
    name: "Rule of three — two straight attempts, the third is the punchline",
    beats: [
      "we tried a loyalty card",
      "we tried a discount hour",
      "we put a dog water bowl outside. this one worked.",
    ],
  },
  {
    name: "Three-act arc — plan, execution, aftermath",
    beats: ["the plan", "the execution", "the aftermath"],
  },
];

/* ── VALUE lane: the swipe delivers something the viewer can use ───────────
   Spine (2 slides): SLIDE 1 ASKS, SLIDE 2 ANSWERS IN FULL.
   Spine (3 slides): SETUP → THE HARD PART → WHAT ACTUALLY WORKED.
   The last slide must CONTAIN the answer, never point at it.               */

const TWO_SLIDE_VALUE: ShortFormat[] = [
  {
    name: "Concrete promise, then the whole answer — no teasing",
    beats: [
      "the reason our croissants are gone by 9",
      "we laminate the dough the night before and bake at 6. that's the entire trick.",
    ],
  },
  {
    name: "Myth then correction — name the belief, replace it with the real cause",
    beats: [
      "everyone blames the beans for bad espresso",
      "it's the water. we filter ours and the bitterness disappeared.",
    ],
  },
  {
    name: "The number that reframes it — a specific figure, then what it means",
    beats: [
      "we throw away 2kg of coffee a week",
      "that's what dialling in the grinder every morning actually costs",
    ],
  },
];

const THREE_SLIDE_VALUE: ShortFormat[] = [
  {
    name: "The honest how-to — the result, the grind behind it, then the actual method",
    beats: [
      "we went from four customers a morning to a queue out the door",
      "it took eight months of empty tables and nearly giving up the lease",
      "we opened at 6 for the builders, baked one pastry on site, and wrote the price on the window",
    ],
  },
  {
    name: "Mistake, fix, proof — what we got wrong, what we changed, what happened",
    beats: [
      "we roasted dark because we thought it looked premium",
      "switched to a medium roast and re-dialled the grind",
      "regulars started ordering it black. that had never happened.",
    ],
  },
  {
    name: "Before, the work, the receipt — the third beat is evidence, not a claim",
    beats: [
      "this corner was a storage room in january",
      "we did the whole fit-out ourselves on weekends",
      "it now covers the rent by itself",
    ],
  },
];

function formatList(formats: ShortFormat[]): string {
  return formats
    .map(
      (f) =>
        `• ${f.name}${f.selfDeprecating ? "  [self-deprecating — creator voice only]" : ""}\n` +
        f.beats.map((b, i) => `    slide ${i + 1}: "${b}"`).join("\n"),
    )
    .join("\n");
}

const NO_EMPTY_PROMISE =
  `THE LAST SLIDE MUST CONTAIN THE PAYOFF, NOT POINT AT IT. This deck is the ` +
  `whole post — there is no slide after the last one, and no caption underneath ` +
  `it. A final slide that says "here's what i learned", "the secret is simple", ` +
  `"this changed everything" or "swipe for the answer" promises something the ` +
  `post never delivers, and that is the single worst way to end. If you write a ` +
  `promise anywhere, spend it before the deck ends: name the actual lesson, the ` +
  `actual number, the actual thing you did.`;

function laneGuidance(count: number): string {
  return (
    `Every example below is written for ONE sample topic: "${SAMPLE_TOPIC}". ` +
    `That is NOT the user's topic and has nothing to do with it. Read each ` +
    `example for its MECHANIC — the structural move it makes across the ` +
    `${count} slides — and rebuild that mechanic entirely from the user's real ` +
    `topic. Never reuse the sample's subject matter, never paste its words.\n\n` +
    `FIRST, PICK A LANE from the user's topic:\n` +
    `- VALUE — the topic asks or implies a real question ("how i did X", "why X ` +
    `happens", "what X costs"), or the photos are evidence of real work. The ` +
    `viewer must finish the post knowing something they didn't. Most topics are ` +
    `this lane. When in doubt, choose it.\n` +
    `- COMEDY — the topic is light, relatable, or self-aware and there is no ` +
    `real information to hand over. The joke IS the content.\n` +
    `Do not mix lanes inside one deck: a sincere setup with a joke ending reads ` +
    `as a bait and switch.\n\n` +
    `A business posting about its own work must not use a mechanic marked ` +
    `[self-deprecating] — self-mockery reads as incompetence when a company is ` +
    `talking about the service it sells.\n\n` +
    `Write like a person typing on their phone: lowercase, no marketing voice, ` +
    `no exclamation marks, no emojis. Short beats land harder than sentences.`
  );
}

const ONE_SLIDE = `THIS IS A ONE-SLIDE POST — a single image with a single caption. There is NO list, NO numbered hook, NO payoff slide and NO call-to-action slide. There is nothing to swipe to, so the caption must land completely on its own.

Write ONE caption, 1-2 short sentences. Pick a lane from the topic:
- VALUE — hand over the whole point in one line: the number, the method, the thing nobody says out loud. It has to be complete; there is no slide 2 to finish the thought.
- COMEDY — a self-aware, funny or disarmingly honest line where the joke IS the content.

Every example below is written for the sample topic "${SAMPLE_TOPIC}" — that is NOT the user's topic. Match the ENERGY, rebuild around the real topic:
• "day 47 of opening at 6am for four builders and a dog"
• "the espresso machine and i are currently not on speaking terms"
• "this took ninety seconds. the latte art took me two years."
• "we sell out of these by 9 and it's because we bake at 6, that's the whole secret"
• "nobody: / me rearranging the pastry case for the fourth time:"

If the topic is a business posting about its own work, drop the self-deprecation — land the line on the WORK instead: the surprising detail, the number nobody expects, the thing customers always say.

${NO_EMPTY_PROMISE}

Do NOT ask for a follow — a follow-ask on a single-slide post kills it.`;

const TWO_SLIDE = `THIS IS A TWO-SLIDE POST. Slide 1 sets something up and slide 2 pays it off completely. Slide 1 must NOT resolve itself; slide 2 must NOT be a summary or a list.

${laneGuidance(2)}

TWO-SLIDE MECHANICS — VALUE (slide 1 asks, slide 2 answers in full):
${formatList(TWO_SLIDE_VALUE)}

TWO-SLIDE MECHANICS — COMEDY (slide 2 undercuts slide 1; the swipe is the punchline):
${formatList(TWO_SLIDE_COMEDY)}

${NO_EMPTY_PROMISE}

Do NOT tack a follow-ask onto slide 2. "follow for more" after a payoff reads as an ad. If the post has a stated goal, it is served by the post being good enough to share.`;

const THREE_SLIDE = `THIS IS A THREE-SLIDE POST. Slides 1 and 2 build — a setup and a complication, a pattern, or an escalation — and slide 3 lands it. It is NOT a shrunken listicle; do not write "here are the 3 ways to…".

${laneGuidance(3)}

THREE-SLIDE MECHANICS — VALUE (setup → the hard part → what actually worked):
${formatList(THREE_SLIDE_VALUE)}

THREE-SLIDE MECHANICS — COMEDY (two beats set a pattern, the third breaks it):
${formatList(THREE_SLIDE_COMEDY)}

Slide 3 carries the whole post. In the VALUE lane it is the method, the number, or the evidence — written out in full, specific enough that someone could act on it. In the COMEDY lane it is the punchline.

${NO_EMPTY_PROMISE}

If the post has a stated goal, slide 3 may serve it, but ONLY if that doesn't cost the payoff. A slide 3 worth screenshotting earns the follow on its own.`;

/**
 * Voice framework for a deck of `count` slides.
 * Returns "" for 4+ — the listicle prompt is left exactly as it was.
 */
export function frameworkBlock(count: number): string {
  if (count === 1) return ONE_SLIDE;
  if (count === 2) return TWO_SLIDE;
  if (count === 3) return THREE_SLIDE;
  return "";
}

/**
 * The role-by-role build instructions for a SHORT deck (1-3 slides), where the
 * usual "title → numbered reasons → cta" shape doesn't exist. Decks of 4+ keep
 * their original wording in the callers, untouched.
 *
 * The last slide still carries the "cta" ROLE (it is the last slide, and the
 * stored schema is unchanged) but it is NOT written as a call to action.
 */
export function shortDeckPlan(count: number): string {
  if (count <= 1) {
    return (
      `Build EXACTLY 1 slide: role "title", number null. It is the entire post — ` +
      `follow the ONE-SLIDE framework above.\n`
    );
  }
  if (count === 2) {
    return (
      `Build EXACTLY 2 slides, in order:\n` +
      `1. role "title", number null: the SETUP. It must not resolve itself.\n` +
      `2. role "cta", number null: the PAYOFF — the full answer or the punchline. ` +
      `Despite the role name this is NOT a call to action, and it must not tease.\n`
    );
  }
  // Three slides keep the title/reason/cta ROLES (the stored schema is
  // unchanged) but none of the listicle's voice: no numbered hook — "what the
  // gurus say" is a better slide 1 than "the 1 thing that…" — and no mandatory
  // follow-ask on the slide carrying the payoff.
  return (
    `Build EXACTLY 3 slides, in order:\n` +
    `1. role "title", number null: beat one. Do NOT put a count in it — this is ` +
    `not a listicle and "1 thing" reads as a broken headline.\n` +
    `2. role "reason", number null: beat two — the complication, the escalation, ` +
    `or the contrast that slide 1 opened.\n` +
    `3. role "cta", number null: beat three — THE PAYOFF. Despite the role name ` +
    `this is not a call to action; it is the thing the post exists to deliver.\n`
  );
}
