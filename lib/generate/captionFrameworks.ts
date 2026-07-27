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

// PARKED, NOT DEAD. Humour is one of the three real drivers of virality, but
// value is the lane we are tuning first — mixing them in while the value output
// is still being fixed would make it impossible to tell which lane caused a bad
// deck. These stay so re-enabling humour is a one-line change to the framework
// strings, not a rewrite.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
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

// eslint-disable-next-line @typescript-eslint/no-unused-vars
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
      "we laminate the dough the night before and bake the first tray at 6. that is the entire trick, and it costs nothing but an early alarm.",
    ],
  },
  {
    name: "Myth then correction — name the belief, replace it with the real cause",
    beats: [
      "everyone blames the beans for bad espresso",
      "it is almost always the water. we filter ours to about 80ppm and the bitterness disappeared overnight, same beans, same machine.",
    ],
  },
  {
    name: "The number that reframes it — a specific figure, then what it means",
    beats: [
      "we throw away 2kg of coffee a week",
      "that is what dialling in the grinder every morning actually costs. budget for it or your first ten cups of the day are undrinkable.",
    ],
  },
];

const THREE_SLIDE_VALUE: ShortFormat[] = [
  {
    name: "The honest how-to — the result, the grind behind it, then the actual method",
    beats: [
      "we went from four customers a morning to a queue out the door",
      "it took eight months of empty tables and nearly giving up the lease",
      "we opened at 6 for the builders, baked one thing on site so the street could smell it, and wrote the price on the window. that was it.",
    ],
  },
  {
    name: "Mistake, fix, proof — what we got wrong, what we changed, what happened",
    beats: [
      "we roasted dark because we thought it looked premium",
      "switched to a medium roast and re-dialled the grind about 3 clicks finer",
      "regulars started ordering it black. that had never happened once in two years.",
    ],
  },
  {
    name: "Before, the work, the receipt — the third beat is evidence, not a claim",
    beats: [
      "this corner was a storage room in january",
      "we did the whole fit-out ourselves over about nine weekends",
      "it seats eleven people and covers the rent on its own now.",
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

const HEADING_AND_BODY =
  `EACH SLIDE HAS TWO PARTS: a short heading (\`text\`) and an optional longer ` +
  `paragraph (\`body\`) underneath it.\n` +
  `  - heading: the beat itself. Short, punchy, ideally under ~12 words. It is ` +
  `what someone reads while scrolling past.\n` +
  `  - body: where the actual substance goes — the protocol, the numbers, the ` +
  `reasoning, the caveat. Typically 20-40 words, and it is NOT bound by the ` +
  `heading's length rule. This is the part that makes the post worth saving.\n` +
  `A real example of the shape (heading, then body):\n` +
  `  heading: "2. eat in an aggressive caloric deficit"\n` +
  `  body: "losing fat quickly is what reveals your abs. eat in a 600-800 cal ` +
  `deficit. coke zero and rice cakes will be your best friends."\n` +
  `Give body text to every slide that has something real to explain. Leave body ` +
  `empty (null) only when the heading genuinely says it all — usually the ` +
  `opening hook. A deck where every body is empty has almost certainly failed to ` +
  `deliver any value.\n` +
  `OPTIONAL, USE SPARINGLY: an ASCII arrow "--->" on its own line at the END of ` +
  `a body reads like a real creator nudging the swipe. It earns its place ONLY ` +
  `when the next slide answers something this one deliberately left open, and ` +
  `only on a slide that is genuinely mid-story. Never on the last slide (there ` +
  `is nothing to swipe to), never on a one-slide post, and never more than once ` +
  `in a deck. If in doubt, leave it out.`;

const VIRALITY_MODEL =
  `WHY POSTS GO VIRAL. A slideshow spreads for exactly one of three reasons, ` +
  `and a post that is none of them is invisible no matter how clean the writing:\n` +
  `  1. VALUE — someone finishes it knowing something genuinely useful.\n` +
  `  2. HUMOUR — it is actually funny.\n` +
  `  3. SHOCK — it is startling or unhinged.\n` +
  `BUILD FOR VALUE. That is the lane for this post. Humour and shock are out of ` +
  `scope right now, so do not reach for a joke or a provocation to carry a slide.\n\n` +
  `WHAT "VALUE" ACTUALLY MEANS — this is the part that decides whether the post ` +
  `works. A slide has value when a stranger could ACT on it. It does not when it ` +
  `only gestures at a topic. The difference is everything:\n` +
  `  DEAD (says nothing): "focused core activation every session" / "it takes a ` +
  `mix of nutrition and full-body workouts" / "consistency is what matters" / ` +
  `"train smarter, not harder". These are true, useless, and forgettable.\n` +
  `  ALIVE (usable): "do ab exercises 3-4x per week, not once" / "eat in a ` +
  `600-800 calorie deficit" / "treadmill at 3 incline, 15 speed, 60 minutes" / ` +
  `"rice cakes and coke zero are how you stay full on low calories".\n` +
  `Notice what makes the second group work: a real number, a real frequency, a ` +
  `named thing, or a specific instruction someone could follow tomorrow.\n\n` +
  `USE SPECIFICS WHERE THEY BELONG, NOT EVERYWHERE. A number is not a quota to ` +
  `fill. Reach for one when the slide is giving an instruction, a dose, a ` +
  `frequency, a cost or a timeline, because those are worthless when vague. A ` +
  `slide making a mindset point or naming a mistake can be fully concrete with ` +
  `no digits at all ("you are training abs like a warm-up, not like a muscle"). ` +
  `Ask of every slide: could a stranger DO something differently after reading ` +
  `this? If not, rewrite it until they could.`;

function laneGuidance(count: number): string {
  return (
    `Every example below is written for ONE sample topic: "${SAMPLE_TOPIC}". ` +
    `That is NOT the user's topic and has nothing to do with it. Read each ` +
    `example for its MECHANIC — the structural move it makes across the ` +
    `${count} slides — and rebuild that mechanic entirely from the user's real ` +
    `topic. Never reuse the sample's subject matter, never paste its words.\n\n` +
    `${VIRALITY_MODEL}\n\n` +
    `${HEADING_AND_BODY}\n\n` +
    `Write like a person, not a brand: sentence case everywhere (never Title ` +
    `Case), no exclamation marks, no emojis, no hashtags. Never use a colon to ` +
    `label-then-explain, and never use an em dash.`
  );
}

const ONE_SLIDE = `THIS IS A ONE-SLIDE POST — a single image, a heading, and a body paragraph under it. There is NO list, NO numbered hook and NO call-to-action slide. There is nothing to swipe to, so this one slide must land completely on its own.

${VIRALITY_MODEL}

${HEADING_AND_BODY}

For a one-slide post the body matters MORE than usual, not less: the heading stops the scroll and the body is the entire payload. A one-slide post with an empty body is just a caption on a photo and will do nothing.

Every example below is written for the sample topic "${SAMPLE_TOPIC}" — that is NOT the user's topic. Match the SHAPE, rebuild around the real topic:
  heading: "we sell out of these by 9 every single day"
  body: "we bake the first tray at 6 so the street smells like butter before anyone is awake. that smell does more than any sign we ever paid for."

Write like a person, not a brand: sentence case everywhere (never Title Case), no exclamation marks, no emojis, no hashtags. Never use a colon to label-then-explain, and never use an em dash. Do NOT ask for a follow.`;

const TWO_SLIDE = `THIS IS A TWO-SLIDE POST. Slide 1 sets something up and slide 2 pays it off completely. Slide 1 must NOT resolve itself; slide 2 must NOT be a summary or a list.

${laneGuidance(2)}

TWO-SLIDE MECHANICS (slide 1 asks, slide 2 answers in full):
${formatList(TWO_SLIDE_VALUE)}

${NO_EMPTY_PROMISE}

Do NOT tack a follow-ask onto slide 2. "follow for more" after a payoff reads as an ad. If the post has a stated goal, it is served by the post being good enough to share.`;

const THREE_SLIDE = `THIS IS A THREE-SLIDE POST. Slides 1 and 2 build — a setup and a complication, a pattern, or an escalation — and slide 3 lands it. It is NOT a shrunken listicle; do not write "here are the 3 ways to…".

${laneGuidance(3)}

THREE-SLIDE MECHANICS (setup, the hard part, then what actually worked):
${formatList(THREE_SLIDE_VALUE)}

Slide 3 carries the whole post: the method, the number, or the evidence, written out in full and specific enough that someone could act on it tomorrow.

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
      `follow the ONE-SLIDE framework above. Return BOTH \`text\` (the heading) `+
      `and \`body\` (the paragraph carrying the substance).\n`
    );
  }
  if (count === 2) {
    return (
      `Build EXACTLY 2 slides, in order:\n` +
      `1. role "title", number null: the SETUP. It must not resolve itself.\n` +
      `2. role "cta", number null: the PAYOFF — the full answer. Despite the role ` +
      `name this is NOT a call to action, and it must not tease.\n` +
      `Every slide returns \`text\` (heading) and \`body\` (the paragraph, or null ` +
      `when the heading genuinely says everything).\n`
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
    `this is not a call to action; it is the thing the post exists to deliver.\n` +
    `Every slide returns \`text\` (heading) and \`body\` (the paragraph, or null ` +
    `when the heading genuinely says everything).\n`
  );
}
