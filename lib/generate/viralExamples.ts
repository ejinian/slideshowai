// THE VOICE CORPUS — hand-curated real viral slideshows, and the single source
// of truth for "what a human-written deck actually looks like."
//
// ⚠️ THIS IS A DOCUMENT OF SEMANTICS, NOT A TEMPLATE LIBRARY. Nothing here is a
// format to reproduce. The entries exist to show HOW A HUMAN SOUNDS — the
// rhythm, the nerve, the imperfection, the willingness to be blunt or crude or
// self-deprecating. A deck that copies one of these structures onto a different
// subject has missed the point entirely and will read as a knock-off. The model
// should finish reading these and write like a person, not write like example 4.
//
// WHY THIS FILE EXISTS: every copy prompt in this repo was a BAN LIST (~30
// prohibitions, ~8 positive examples). Bans can only remove failures we already
// saw; they never teach voice, and each new ban makes output blander. A real run
// shipped "mocha blend adds a chocolatey twist, perfect for a creamy finish" —
// no rule caught it, because there are infinite ways to write stiffly. Positive
// examples are the fix: the model imitates instead of avoiding.
//
// These are transcribed BY HAND from real posts (there is no scrapeable corpus
// of on-slide text — it only exists baked into images). Append as we find more.
// Gym-heavy for now; other niches are the manual work ahead.

/** Why a post spreads. A deck that is none of these is invisible. */
export type Lever =
  | "value" // 1. genuinely useful — a stranger can DO something after reading
  | "humor" // 2. actually funny
  | "raw"; // 3. shock / lust / real-life relatable

export interface ViralExample {
  niche: string;
  levers: Lever[];
  /** Slides in order. `text: null` means the slide DELIBERATELY has no caption. */
  slides: { text: string | null; photo: string }[];
  /** The transferable technique — why it works, not what it says. */
  technique: string;
}

export const VIRAL_EXAMPLES: ViralExample[] = [
  {
    // @youneslifts · 1.08M views, 26k likes. The tightest VALUE deck in the corpus.
    niche: "gym",
    levers: ["value"],
    slides: [
      {
        text: "How I Naturally Grew My Chest\n(No gatekeeping)\n>>>",
        photo: "his own chest, hard gym lighting",
      },
      {
        text: "1. Pec Fly Machine\n1x warm up\n2x to failure\n\n- Mid/lower chest",
        photo: "him mid-set on the pec fly",
      },
      {
        text: "2. Incline Dumbbell Press (Heavy)\n2x6-8\n\n- Upper chest",
        photo: "him pressing, straining",
      },
      {
        text: "3. Machine Press variant\n2x to failure\n(+ partial reps)\n\n- Mid/lower chest",
        photo: "him on the machine press",
      },
    ],
    technique:
      "PRESCRIPTION, NOT DESCRIPTION. Every slide is exercise → exact set/rep " +
      "scheme ('1x warm up, 2x to failure', '2x6-8', '+ partial reps') → which " +
      "part of the muscle it hits. Nothing is explained, nothing is padded; a " +
      "reader can walk into a gym and execute it. This is what 'actionable' " +
      "actually looks like.\n" +
      "'(No gatekeeping)' preempts the accusation every fitness creator faces — it " +
      "shows he knows his own community. 'Naturally' is a loaded credibility claim " +
      "in this niche (i.e. not on steroids). '>>>' is a native swipe prompt, typed " +
      "not designed.\n" +
      "IMPORTANT COUNTER-EXAMPLE: every slide here uses the SAME template on " +
      "purpose. For a reference/instructional deck that repetition is a feature — " +
      "the reader is scanning, not reading. Structural variety is for VOICE decks, " +
      "not for a workout you expect someone to follow.",
  },
  {
    // @gio._gonzales · 381k views, 27k likes.
    niche: "gym",
    levers: ["value"],
    slides: [
      { text: "3 tips on how I grew my chest to this", photo: "mirror selfie, developed chest" },
      { text: "From this", photo: "old photo, much smaller" },
      {
        text: "1. Upper chest\nYour upper chest makes a big difference to your chest development\n\nExercises:\nLow to high cable flys\nIncline dumbbell bench\nIncline smith/machine press",
        photo: "him in a tank, chest visible",
      },
      { text: "2. Mid chest\n…same shape: why it matters, then the exercises", photo: "him, chest visible" },
      {
        text: "3. Lower chest\nHitting your lower chest will make it look fuller and give you more shape\n\nFocus on dips(weighted if you can)\nHigh to low cable flys",
        photo: "him in a compression tee",
      },
    ],
    technique:
      "Organised by ANATOMY, not by exercise — upper / mid / lower chest. That " +
      "gives the viewer a MENTAL MODEL they keep after the post ends, which is " +
      "worth more than three random exercises. Each slide is: label → one line on " +
      "why that region matters → the exercise list.\n" +
      "Proof first again (physique, then 'From this'). 'dips(weighted if you can)' " +
      "with no space before the bracket is someone typing on a phone, not " +
      "copywriting. Note how plain the prose is — 'will make it look fuller and " +
      "give you more shape' — no adjectives, no sell.",
  },
  {
    // @t1outere · 213k views, 12.7k likes. The VALUE reference: how a genuinely
    // informational deck sounds when a real lifter writes it.
    niche: "gym",
    levers: ["value", "raw"],
    slides: [
      { text: "3 exercises I used to build my chest.", photo: "his own chest, lit hard" },
      { text: "from this...", photo: "old mirror selfie, much smaller" },
      { text: "To this.", photo: "now, full chest" },
      {
        text: "1:Bench press\n• don't do this in the same session with pec deck unless you really want to\n• Heavy bench press helped build my general pressing strength and helped build up my chest as a beginner but not as good as the next 2 exercises",
        photo: "anatomy diagram, worked muscle highlighted red",
      },
      {
        text: "2: Incline Dumbell Press\n• great exercise for the sternal costal and claviclular head of the chest. Helped build that shelf and a full chest. Can replace with incline smith if available\n• make sure to keep your elbows slightly tucked in rather then flared to align with the upper chest fibers better. Minimise arching to avoid turning this onto a flat press",
        photo: "anatomy diagram, two angles",
      },
      {
        text: "3: Machine Pec deck\n• the best exercise for anyone looking to build up their chest as a whole\n• amazing stretch and squeeze on this you will have to wear a Bra after hitting sets on these",
        photo: "anatomy diagram, pec deck",
      },
    ],
    technique:
      "EARNS THE RIGHT TO ADVISE FIRST. Slides 1-3 are pure proof — his chest, " +
      "then from-this/to-this — and only then does he teach. Our decks open with " +
      "advice from nobody.\n" +
      "The writing is riddled with typos: 'Dumbell', 'claviclular', 'rather then', " +
      "'1:Bench press' with no space. NOBODY PROOFREAD THIS, and that is exactly " +
      "why it reads as a real lifter and not a content farm. Do not imitate typos " +
      "on purpose, but understand that flawless copy is itself a tell.\n" +
      "He DOWNRANKS HIS OWN FIRST ITEM ('helped as a beginner but not as good as " +
      "the next 2') — arguing against himself buys enormous credibility. He hedges " +
      "casually ('unless you really want to'). He is anatomically specific " +
      "('sternal costal and clavicular head', 'upper chest fibers') — real " +
      "knowledge, not 'targets the chest'. And he lands a crude joke inside the " +
      "instruction ('you will have to wear a Bra after hitting sets on these'): " +
      "value and humour in the same breath, which is how people actually talk.\n" +
      "Structurally this is heading + TWO short bullets per slide, on a 6-slide " +
      "deck — real value needs that second text block.",
  },
  {
    // @llayandceefa · 53.7M views, 9.7M likes — the biggest in the corpus.
    niche: "gym",
    levers: ["humor", "raw"],
    slides: [
      {
        text: "pov: you and dad decided to lock tf in",
        photo: "him and his dad at a table covered in takeaway containers",
      },
      { text: null, photo: "the two of them in an elevator mirror, gym bags, heading to train" },
    ],
    technique:
      "Two slides, one caption, 8 words, 53 MILLION views. The joke is entirely " +
      "in the gap between the two photos: slide 1 is a giant junk-food feast (the " +
      "last supper), slide 2 is them actually walking into the gym — and slide 2 " +
      "has NO TEXT because explaining it would kill it. Note 'lock tf in': the " +
      "abbreviation is doing real work, it is how people actually talk, and no " +
      "model would produce it. Also 'pov:' as the opener — an established TikTok " +
      "frame that instantly puts the viewer inside the scene.",
  },
  {
    // @nolimitsfitnesss · 2.5M views, 249k likes.
    niche: "gym",
    levers: ["raw"],
    slides: [
      { text: "From a boy...", photo: "skinny teen beside his muscular dad, gym mirror" },
      { text: "to a man", photo: "same two, the teen now visibly built" },
    ],
    technique:
      "Five words. The '...' at the end of slide 1 is the whole mechanic — it " +
      "holds the sentence open so the swipe completes it. Lowercase 'to' on slide " +
      "2 proves it is one sentence, not two captions. Father/son transformation is " +
      "pure lever 3: no advice, just time made visible. (The original ends with a " +
      "battery emoji — we cannot copy that, our caption font has no emoji glyphs " +
      "and they bake as tofu boxes. Everything else transfers.)",
  },
  {
    // @myzzlifts · 365k views, 51k likes.
    niche: "gym",
    levers: ["humor", "raw"],
    slides: [
      {
        text: "Every family needs their mentally unstable son that rots in the gym",
        photo: "high-contrast black and white, hulking physique",
      },
      { text: null, photo: "veined forearms raised to the face, dim bathroom mirror" },
      { text: null, photo: "same pose, held" },
    ],
    technique:
      "SELF-AWARE UNHINGED. 'mentally unstable son that rots in the gym' is a " +
      "person roasting themselves harder than a stranger would — the confidence " +
      "to say it is the flex. 'rots' is the load-bearing word; a model would have " +
      "written 'spends all his time'. One caption on slide 1 and then TWO silent " +
      "slides: the images just let you stare.",
  },
  {
    // @dbfitstyle · 1.5M views, 59k likes. The most crafted writing in the corpus.
    niche: "gym",
    levers: ["raw"],
    slides: [
      { text: "“You only care about that stupid gym.”", photo: "empty gym, lights off, cold" },
      { text: "There were nights...", photo: "someone sitting alone on a street at night, head down" },
      { text: "Where this stupid gym was all I had left.", photo: "hooded figure alone on a bench" },
    ],
    technique:
      "Opens on SOMEONE ELSE'S WORDS — an accusation in quotation marks — then " +
      "spends two slides answering it. The craft is the CALLBACK: 'that stupid " +
      "gym' (their insult) becomes 'this stupid gym' (his refuge). One word " +
      "changed, and the insult is reclaimed. '...' again holds the sentence across " +
      "the swipe. Zero advice, zero CTA, 1.5M views — the post is a feeling with a " +
      "beginning, middle and end.",
  },
  {
    niche: "gym",
    levers: ["raw"],
    slides: [
      { text: "Isaiah, why were you going to the gym?", photo: "him" },
      { text: "Because it's my second home.", photo: "his gym, empty" },
    ],
    technique:
      "Question then answer, across two slides. The whole post is 11 words. The " +
      "answer is emotional, not informational — and it lands because the second " +
      "photo IS the answer.",
  },
  {
    niche: "gym",
    levers: ["raw"],
    slides: [
      { text: "At long last...", photo: "him years ago, skinny" },
      { text: "I've ascended", photo: "him now, visibly strong" },
    ],
    technique:
      "Two words on the payoff slide. The transformation is carried ENTIRELY by " +
      "the photos; the text just frames it. Proof that the caption's job is " +
      "sometimes to get out of the way.",
  },
  {
    niche: "gym",
    levers: ["raw", "humor"],
    slides: [
      { text: "I go to the gym to stay healthy", photo: "him young and small" },
      { text: "I go to the gym to stay in shape", photo: "him young and small" },
      {
        text: "I go to the gym because it's the only thing I'm good at",
        photo: "him now, much bigger",
      },
    ],
    technique:
      "REPETITION WITH A TWIST. Two identical, boring, expected lines set a " +
      "rhythm — then the third breaks it with a self-deprecating truth. The joke " +
      "only exists because the first two were deliberately flat. People find " +
      "quiet self-humbling funny AND relatable at once.",
  },
  {
    niche: "gym",
    levers: ["value"],
    slides: [
      { text: "Top exercises for 3D shoulders", photo: "shoulders" },
      {
        text: "Lateral Raise 3/10\nYou'll mostly hit traps and won't get crazy shoulder growth if you do them wrong",
        photo: "dumbbells",
      },
      {
        text: "Dumbbell Raises 5/10\nGood if you're just starting out, but they're hard to progress on. Wouldn't really recommend",
        photo: "dumbbells",
      },
      {
        text: "Military Press 6/10\nPretty solid exercise. Hits the front delts, easy to get stronger on, but more prone to injury",
        photo: "military press",
      },
      {
        text: "Arnold Press 10/10\nThe most complete shoulder exercise. If this isn't in your shoulder day, you're leaving gains on the table. Hits all 3 heads, and there's a reason Schwarzenegger used to do it",
        photo: "posing",
      },
    ],
    technique:
      "Opinionated RATINGS. It trashes a popular exercise (lateral raise 3/10) — " +
      "that willingness to be wrong-in-public is the whole hook. Note the shape: " +
      "short verdict line, then a body sentence of real reasoning. Hedges like " +
      "'wouldn't really recommend' read human; a confident 10/10 with a reason " +
      "closes it.",
  },
  {
    niche: "gym",
    levers: ["raw", "humor"],
    slides: [
      {
        text: "Me when I'm looking in the mirror and finally see a little progress",
        photo: "any",
      },
      { text: null, photo: "him small" },
      { text: null, photo: "him big" },
    ],
    technique:
      "Caption on slide 1 ONLY. Slides 2 and 3 are silent — the photos deliver " +
      "the punchline. Adding text to those slides would kill it. Silence is a " +
      "technique.",
  },
  {
    // @lxki.sm · 334k views, 30k likes. #gym #GymTok #motivation
    // The MOTIVATION sub-genre of gymtok: no advice, no joke — a stated vow.
    niche: "gym",
    levers: ["raw"],
    slides: [
      { text: "I ain't dying", photo: "low-angle shot, dramatic dark lighting" },
      { text: "Before I look like this", photo: "mirror selfie, tank top" },
      { text: null, photo: "an extreme, aspirational physique — the payoff" },
    ],
    technique:
      "A VOW, not advice. \"I ain't dying before I look like this\" is an absolute, " +
      "slightly unhinged declaration of obsession — that intensity IS the content. " +
      "Three techniques stack here: (1) the sentence again splits across the swipe " +
      "(slide 1 → 2), so you cannot stop halfway; (2) the last slide has NO TEXT — " +
      "the aspirational image lands in silence; (3) \"ain't\" is non-standard " +
      "grammar a model would never choose, and it is exactly what makes it sound " +
      "like a real person. Note there is nothing useful here and it still did 334k " +
      "views: motivation posts trade on FEELING, not information. Do not staple a " +
      "tip or a CTA onto one.",
  },
  {
    // @graysonsav · 1.9M views, 163k likes. Fetched via
    // scripts/fetch-viral-example.mjs.
    niche: "gym",
    levers: ["raw"],
    slides: [
      { text: "All it takes", photo: "couple at the beach, a year ago" },
      { text: "Is one year", photo: "same couple, same beach, visibly transformed" },
    ],
    technique:
      "ONE SENTENCE SPLIT ACROSS THE SWIPE. Slide 1 is a grammatical fragment " +
      "that does not resolve until slide 2 — the swipe itself IS the payoff " +
      "mechanism, so you physically cannot stop halfway. Four words total. The " +
      "photos do all the work (same couple, same beach, one year apart); the text " +
      "only times the reveal. Note 'Is' is capitalised mid-sentence — a person " +
      "typing two separate text boxes, not a copywriter.",
  },
  {
    niche: "gym",
    levers: ["humor", "raw"],
    slides: [
      {
        text: "pros & cons of going to the gym",
        photo: "mirror selfie, casual outfit, bedroom",
      },
      {
        text: "cons: It takes time",
        photo: "mirror selfie, gym fit, side profile",
      },
      {
        text: "pros: time passes away",
        photo: "mirror selfie, different gym fit",
      },
    ],
    technique:
      "The ENTIRE post is one joke: the same fact — time — is framed as the con " +
      "and then the pro. Setup on slide 2, payoff on slide 3, 11 words total. " +
      "Two things to notice: (a) 'time passes away' is slightly wrong English, and " +
      "that imperfection is exactly what makes it read as a real person typing " +
      "fast; a model would have written 'time flies'. (b) It uses the label-colon " +
      "format ('cons: ...') that our own prompt BANS outright — proof the ban list " +
      "would forbid a genuinely viral post. The photos are physique-forward mirror " +
      "selfies: on this kind of post the images are the draw and the text is a " +
      "light joke riding on top.",
  },
  {
    niche: "gym",
    levers: ["value", "raw"],
    slides: [
      { text: "Top 5 ways to make progress in the gym", photo: "gym" },
      { text: "Go on a calorie and protein surplus", photo: "food" },
      { text: "2 sets of failure on everything with a warmup set before", photo: "training" },
      { text: "Don't forget your cardio", photo: "cardio" },
      { text: "Find a good playlist to train hard to", photo: "headphones" },
      { text: "Remember why you started", photo: "darker, low-contrast, moody" },
    ],
    technique:
      "A plain listicle that EARNS its last slide. Four practical items, then an " +
      "emotional close on a deliberately darker photo — no follow-ask, no CTA. " +
      "Most people start the gym to cope with something, and the deck quietly " +
      "acknowledges it. The payoff is a feeling, not a instruction.",
  },
];

/**
 * The techniques the corpus teaches, stated once. These are things our current
 * generator CANNOT do or does badly — kept explicit so the prompt can ask for
 * them directly.
 */
export const TECHNIQUES = [
  "Text can be 2-6 words. 'I've ascended' is a whole slide. Length is not value.",
  "Some slides should have NO text at all — let the photo land the punchline.",
  "SPLIT ONE SENTENCE ACROSS THE SWIPE. End slide 1 mid-thought (often on '...') so it only resolves on the next slide. The swipe becomes the payoff.",
  "Repetition with a twist: two flat parallel lines, then break the pattern.",
  "CALLBACK: repeat a phrase from the hook on the last slide with one word changed ('that stupid gym' → 'this stupid gym').",
  "Open on SOMEONE ELSE'S WORDS — a quoted accusation, a thing people say to you — then spend the deck answering it.",
  "'pov:' is a live, native frame that drops the viewer into the scene.",
  "Be willing to rate, rank and dislike things out loud (\"lateral raise 3/10\").",
  "Self-deprecation reads human; polish reads corporate. Roast yourself harder than a stranger would ('mentally unstable son that rots in the gym').",
  "A deck can close on a feeling instead of a call to action. Motivation posts carry ZERO information and still do millions of views — never staple a tip or a follow-ask onto one.",
  "Hedges (\"wouldn't really recommend\", \"honestly\") are human. Certainty everywhere is a bot tell.",
  "IMPERFECT GRAMMAR IS A SIGNATURE: 'ain't', 'time passes away', a capital mid-sentence. Do not polish these away.",
  "ABBREVIATIONS — 'lock tf in', 'ts', 'ngl', 'fr'. Powerful because no model reaches for them, but RARE and situational: use one only when it is genuinely the phrase a person would type, never as decoration. Wrong-footed slang is worse than none.",
  "Vary slide shape and length — BUT ONLY ON VOICE DECKS (a story, a joke, a feeling). Identically-built lines are the clearest AI signal there. On a REFERENCE deck (a workout, a recipe, a checklist) the opposite is true: repeat one tight template every slide, because the reader is scanning, not reading.",
  "VALUE = PRESCRIPTION, NOT DESCRIPTION. Name the thing, then the exact numbers (sets, reps, doses, times, temperatures), then who or what it is for. 'Incline dumbbell press, 2x6-8, upper chest' beats a paragraph about why chest training matters.",
  "Give the viewer a MENTAL MODEL, not just a list — 'upper / mid / lower chest' is worth more than three unconnected exercises because they keep it after the post ends.",
  "EARN THE ADVICE BEFORE GIVING IT: open with proof (the result, a before/after) so the viewer knows why they should listen. Advice from nobody gets scrolled.",
  "Know the audience's inside baseball — '(no gatekeeping)', 'naturally' — and speak to the suspicion they already have.",
] as const;

/* ── ANTI-EXAMPLES ────────────────────────────────────────────────────────────
   Real captions OUR generator produced that Ernest rejected. Each one is filed
   under the STRUCTURE it exhibits, not as a banned string — banning the string
   just makes the model emit a different instance of the same shape. Append here
   every time a bad caption is spotted. */

export interface AntiExample {
  /** Short name for the structure, so the model can recognise the shape. */
  pattern: string;
  bad: string[];
  /** The same idea written the way a person would. */
  better: string[];
  why: string;
}

export const ANTI_EXAMPLES: AntiExample[] = [
  {
    pattern: "The validation tail — a second sentence that only adds emphasis",
    bad: [
      "Don't skip the incline treadmill walks. Seriously, try it.",
      "Target your obliques every workout. They're the secret.",
      "Eat 180g of protein daily. This isn't optional.",
      "Rest days are non-negotiable. Let your core recover.",
    ],
    better: [
      "Never skip cardio. If you do, go on a walk and try to hit 10k steps",
      "Target your obliques every workout, this small muscle group is underrated af for an aesthetic physique",
    ],
    why:
      "Every bad line is the same shape: an instruction, a full stop, then a " +
      "short punchy fragment that carries NO new information — it just insists " +
      "the first half mattered. Nobody talks like this; it is the sound of a " +
      "model padding to a word count. THE RULE: if a caption has a second " +
      "sentence or clause, it must add something REAL — a number, a protocol, a " +
      "reason, an opinion. If you have nothing to add, stop after the first " +
      "sentence. Notice the fixes also swap the full stop for a comma, which " +
      "forces the thought to continue instead of starting a hollow new one.",
  },
];

export function antiExamplesBlock(): string {
  if (ANTI_EXAMPLES.length === 0) return "";
  return (
    "CAPTIONS WE HAVE ALREADY SHIPPED AND REJECTED — do not write anything with " +
    "these shapes:\n\n" +
    ANTI_EXAMPLES.map(
      (a) =>
        `✗ ${a.pattern}\n` +
        a.bad.map((b) => `   BAD:    "${b}"`).join("\n") +
        "\n" +
        a.better.map((b) => `   HUMAN:  "${b}"`).join("\n") +
        `\n   WHY: ${a.why}`,
    ).join("\n\n")
  );
}

/** Levers, stated for the model. */
export const LEVERS_BLOCK =
  "WHY A SLIDESHOW SPREADS — it needs at least one of these, or it is invisible:\n" +
  "1. VALUE — someone finishes it knowing something they can act on.\n" +
  "2. HUMOR — it is actually funny.\n" +
  "3. RAW / RELATABLE — it is honest, a little vulnerable, or hits a feeling the " +
  "viewer has had. Self-deprecation, a transformation, an unglamorous truth.\n" +
  "Lever 3 is the one machines miss: they write the safe, polished, agreeable " +
  "version. Real posts are blunter and more personal than feels comfortable.";

/**
 * Render the corpus as a prompt block. Prefers in-niche examples (a coffee deck
 * learns nothing about voice from a gym-only reference), then fills from the
 * rest so there is always something to imitate.
 */
export function viralExamplesBlock(niche?: string, limit = 4): string {
  const slug = (niche ?? "").toLowerCase();
  const inNiche = VIRAL_EXAMPLES.filter((e) => slug.includes(e.niche));
  const rest = VIRAL_EXAMPLES.filter((e) => !inNiche.includes(e));
  const picked = [...inNiche, ...rest].slice(0, limit);
  if (picked.length === 0) return "";

  const rendered = picked
    .map((e, i) => {
      const slides = e.slides
        .map((s, j) =>
          s.text === null
            ? `  slide ${j + 1}: (NO TEXT — the photo carries it) [photo: ${s.photo}]`
            : `  slide ${j + 1}: "${s.text.replace(/\n/g, " / ")}" [photo: ${s.photo}]`,
        )
        .join("\n");
      return `EXAMPLE ${i + 1} (${e.levers.join(" + ")}):\n${slides}\n  WHY IT WORKS: ${e.technique}`;
    })
    .join("\n\n");

  return (
    "REAL VIRAL SLIDESHOWS — transcribed from posts that actually performed.\n" +
    "READ THESE FOR VOICE, NOT FORMAT. They are here to show you how a human " +
    "sounds: the rhythm, the nerve, the bluntness, the imperfection. They are NOT " +
    "templates. Do not copy one of these structures onto this deck's subject — a " +
    "deck that reuses an example's shape reads as a knock-off. Absorb how these " +
    "people write, then write this deck as that kind of person would.\n\n" +
    rendered +
    "\n\nWHAT THESE TEACH — the transferable part:\n" +
    TECHNIQUES.map((t) => `• ${t}`).join("\n") +
    "\n\n" +
    antiExamplesBlock()
  );
}
