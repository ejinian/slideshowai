# Anti-AI-Voice — making captions read genuinely human

> **Living doc.** This is the working space for the ongoing effort to stop
> Supercharge's judge (and the base copy model) from producing captions that
> *read* as AI-written even when they're technically fine. Update it as we learn.
> Pointer in `CLAUDE.md`; recall pointer in the auto-memory (`project-anti-ai-voice`).

Last updated: **2026-09-02**.

---

## The goal

A caption can be true, on-topic, and grammatical and *still* scream "a model wrote
this." That's the failure we're killing. The judge already improves value + hooks
(see the persona/archetype work in `lib/generate/judge.ts`); this doc is about the
separate axis of **voice authenticity** — sounding like a real creator typed it.

## The tell taxonomy (GROWING — this is the heart of the doc)

Real examples from `diagnostics/Run_1_Diagnostics_Stock` (coffee deck) that the judge
did NOT flag but obviously read as AI. Each is a *named pattern* so we can (a) teach
the judge to catch it, and (b) eventually catch it mechanically in `aiLingo.ts`.

1. **Evaluative tail clause** — a comma followed by a generic praise phrase.
   - ❌ "mocha blend adds a chocolatey twist**, perfect for a creamy finish**"
   - Why it's a tell: humans don't append a marketing-blurb verdict to a sentence.
     The "…, perfect for X" / "…, great for Y" / "…, ideal when Z" tail is pure
     copywriter filler.
   - Fix instinct: cut the tail, or replace with a concrete consequence.

2. **Abstract sensory nouns** — nominalized tasting-note words nobody says out loud.
   - ❌ "espresso's **sharpness**", "a creamy **finish**", "that sweet **hit**"
   - Why it's a tell: these are menu-copy abstractions. A real person says "it's
     not bitter" not "layers sweetness over espresso's sharpness."

3. **Twee personification / cutesy metaphor**
   - ❌ "peppermint mocha is **the refreshing buddy to** your standard brew"
   - Why it's a tell: assigning a friendly persona to a drink is a model reaching
     for "fun." Reads as trying-too-hard, not casual.

4. **Over-balanced parallelism** — too-neat symmetric construction.
   - ❌ "the caramel macchiato **layers sweetness over** espresso's sharpness"
   - Why it's a tell: the tidy "X over Y" balance is a model's instinct for
     "elegant." Humans are messier and blunter.

5. **Deck-level structural uniformity (low burstiness)** — THE dominant tell, and
   the one phrase-fixes don't touch.
   - ❌ every reason slide the same grammatical shape: "vanilla chai latte, for when
     you want…" / "caramel macchiato, the go-to for people who…" / "honey lavender
     latte, if you want…" / "mocha, for the chocolate lover who…" (Run 2).
   - Why it's a tell: detectors (GPTZero) score **predictability + burstiness**, not
     clichés. A list where every line is `[item], [clause]` is maximally low-burstiness
     → flags AI no matter how good the individual words are. The listicle FORMAT is
     inherently uniform, which fights us.
   - Fix instinct: make slides structurally DIFFERENT from each other — vary length,
     shape, register (one blunt fragment, one full sentence, one aside). This is a
     DECK-LEVEL constraint, not per-caption. Exactly what real captions (RAG) carry.
   - **Second confirmed variant (Run 65, 2026-08-27): the balanced two-clause
     contrast.** "you keep curling **but** your arms are still flat every week" /
     "your shoulders are stealing the work**, not** your arms" / "if it burns, you
     drop the dumbbells**, so** your arms stay small" / "…**and wonders why** nothing
     happens" — six slides, one shape. Crucially the JUDGE wrote these: the raw
     gpt-4.1 draft was bursty and human ("your reps stop as soon as it actually
     gets hard") and every judge rewrite converged on the contrast shape, while the
     judge's own prompt said "no two captions may share the same shape". Also note
     the smoother-but-wrong word swap that rides along ("arms are **flat**" — nobody
     says that; it's chest/stomach vocabulary).
   - **MECHANICALLY ENFORCED since 2026-08-27** (`scanDeckShape` in `aiLingo.ts`):
     a 4+-slide deck with ≥3 contrast-shaped captions (`but/yet`, `, not`, `, so`,
     `and wonder`) fails validation and retries in BOTH copy paths, and a judge
     `rewrite_caption` that would add a third contrast shape to the deck is skipped
     (the skip reason names this doc). Verified against Run 65: judged deck flagged
     (slides 1, 2, 5, 6), raw draft passes, two contrasts allowed.

6. **Zinger cadence — every slide is a crafted punchline (Run 75, 2026-09-02,
   Christian).** The opposite failure to #5: the lines are all *different* shapes,
   and every one of them is visibly trying. Christian's reference deck on the same
   topic ("5 Things Highly Successful People Do Differently") reads:
   "plan their day the night before" / "avoid toxic people" / "focus on solutions,
   not problems" / "take calculated risks" / "keep learning constantly" — 3-6
   words, third person, calm, zero cleverness. Ours:
   - ❌ "if you don't read one money book a month, **you're losing the race**"
   - ❌ "**money moves in rooms** you never get into by looking rich"
   - ❌ "own your apartment **before you own** a closet of designer shoes"
   - ❌ "**skip the flex** if your savings account is empty"
   - Why it's a tell: **visible effort.** A human typing a slideshow writes the
     plain version and moves on; a model asked to "sharpen" produces a bar. Five
     bars in a row is a motivational-poster account, not a person. Sub-shapes that
     ride along: the **conditional threat** ("if you don't X, you're losing / staying
     broke / falling behind"), **specificity theatre** (an invented quota — "one
     money book a month" — added purely for punch, which fakes the value doctrine
     rather than serving it), **aphorism metaphor** ("losing the race", "rooms you
     get into"), and **accusatory second person on every slide** — real decks are
     "things I did" / "what successful people do", not "you're losing".
   - **The JUDGE wrote all four.** The raw draft was closer ("every wealthy
     20-something i know reads about money, not just trending stocks"); the judge's
     own rewrite reasons say "sharper", "more arresting", "more punch", "a sharply
     human take that can't be guessed" — its rubric vocabulary IS the tell
     generator. Its persona ("an ear for how a caption has to be phrased to stop a
     thumb") selects for maximum punch per line, and "LAND ONE real specific line"
     gets applied to every line.
   - Reconciling with the value doctrine: plainness of VOICE and concreteness of
     CONTENT are separate axes. "read a money book every month" is exactly as
     concrete as the zinger version, minus the threat and the metaphor. Concrete
     AND plain is the target; the zinger wrapper is what reads as AI.
   - Contributing rule: the copy prompts demand 6-12 words per caption, so the
     plain 3-word slide ("avoid toxic people") is *below our floor*, and padding to
     six words is what invites the metaphor.
   - **SHIPPED 2026-09-02 (prompt + mechanical):** both copy prompts and the
     judge carry a PLAIN BEATS CLEVER block (rewrite direction is *plainer*, at
     most ONE edged line per deck, no conditional threats, no "you" lecture, no
     invented quotas); the word floor dropped from 6 to 2 ("avoid toxic people"
     is a complete caption); and `scanZingers` in `aiLingo.ts` enforces it like
     `scanDeckShape`: any threat-shaped caption (`if/unless/until you …, you're /
     you'll / your …` or `you're losing / falling behind / staying broke`) fails
     validation and retries in BOTH copy paths, a 4+ deck with more than
     `ceil(n/2)` second-person captions does the same, and a judge
     `rewrite_caption` that introduces a threat shape or pushes the deck past the
     "you" cap is skipped. Verified: Run 75's judged deck flags (threat on 3,
     "you" on 2-5), its raw draft passes, the reference deck passes, 0 of 298
     `viralExamples.ts` strings false-positive. Known precision trade: the threat
     regex needs the comma ("if you don't eat enough protein you won't grow" is
     left to the prompt) so that "if you want abs you'll need 10-15% body fat"
     stays legal.
   - Correction to an earlier assumption: the judge DOES already see the
     transcribed `slide_texts` exemplars and the `viralExamples` corpus (both are
     in `03e_judge_prompt.txt`). B's second half is not the missing lever here;
     the judge had the real register in front of it and still wrote bars because
     its rubric asked for punch.

> Add new patterns here as we spot them. The user is the best source — every
> caption they call out goes in with a name + why.

## Options on the table

| # | Approach | What | Status | Cost/risk |
|---|----------|------|--------|-----------|
| A | Persona + hook archetypes | Judge system prompt embodies a real creator + named hook shapes | **DONE** (2026-07-29) | Free, in-prompt |
| B | RAG real captions → judge | Retrieve top-k real high-performing captions in the deck's niche/topic and show the judge "this is how humans phrase it" | **Corpus SHIPPED 2026-08-07** (see log); retrieval into the *judge* still open | Retrieval infra; ~free per gen if we reuse our own trend pipeline |
| C | AI-detector API → judge | Call an AI-detector on each caption / the deck, feed the score back so the judge revises | **Analyzed — low value as a per-caption judge input** (see below) | API cost + latency; unreliable on short text |
| D | Expand mechanical tell-detector | Add the taxonomy above to `lib/generate/aiLingo.ts` as regex/heuristics so tells are caught deterministically pre- and post-judge | **Proposed** | Free; false-positive tuning |

### On B (RAG) — the recommended direction
The strongest "not-AI" lever is **positive real examples**, not more rules. Retrieve
5–10 real captions matching the deck's niche/topic and inject them into the judge
prompt as the voice target. Best corpus = **our own Apify `trending_posts` pipeline**
(live, niche-tagged, license-clean). Optional cold-start augment: the MIT-licensed
`benxh/tiktok-hooks-finetune` HF dataset (46.6k real hooks+captions+engagement
metrics — filter to high performers). Still ONE judge call, just with retrieved
exemplars in context.

### On C (AI detectors) — the honest analysis
Feeding a detector score back to the judge sounds great but has real problems:
- **Detectors are unreliable on short text.** They score perplexity/burstiness over
  paragraphs; an 8-word caption gives near-random output. Even the whole concatenated
  deck is short + stylized.
- **A score isn't actionable.** "72% AI" doesn't tell the judge *which phrase* is the
  tell or *how* to fix it — which is exactly the signal our taxonomy DOES give.
- **Where a detector IS useful:** as a **diagnostics metric** to track progress over
  time ("did our output trip GPTZero?"), and possibly as a coarse loop-gate on the
  full deck (regenerate if it flags) — but expect noise.
- **Conclusion:** the judge itself, taught the taxonomy above + shown real examples
  (B), is a better and more actionable "detector" for our domain than any external API.

### Detector tools (for manual spot-checking Run diagnostics)
Paste a Run's captions here to sanity-check — but concatenate the WHOLE deck (more
text = less noise), and treat one-line results as unreliable:
- **GPTZero** — https://gptzero.me (free 10k words/mo, no hard signup)
- **ZeroGPT** — https://www.zerogpt.com (unlimited, no signup, ~80%)
- **Originality.ai** — most accurate in head-to-heads, but paid.

## Current thinking (recommendation)
1. **B (RAG our own trend captions into the judge)** is the highest-ROI next build.
2. **D (encode the taxonomy in `aiLingo.ts`)** in parallel — cheap deterministic backstop, and it strengthens the judge's retry loop too.
3. **C (detector)** only as a *diagnostics metric*, not a per-caption judge input.
4. Keep feeding the taxonomy from real flagged captions.

## Decisions / log
- **2026-07-29** — Doc created. Persona+archetypes shipped (A). User flagged the
  coffee-deck tells (evaluative tail clause, abstract sensory nouns, twee
  personification, over-balanced parallelism) — seeded the taxonomy. Leaning B+D;
  C demoted to a metric. Nothing implemented from this doc yet (research/plan only).
- **2026-07-29 (later)** — GPTZero's **free web tool** scanned the coffee deck →
  **100% AI**, and its "most AI sentences" were exactly the evaluative-tail ("…
  perfect for a creamy finish") and over-balanced ("layers sweetness over espresso's
  sharpness") lines. **Validates the taxonomy.** ZeroGPT detected ~nothing (weaker).
  GPTZero **API is ~$45/mo** — bad ROI for a low-value, non-actionable runtime input.
  **Decisions:** (1) use GPTZero's *free web tool* as our manual dev/eval harness to
  grow the taxonomy — NOT a runtime dependency. (2) If we ever want an *automated*
  score at ~zero extra cost, compute **perplexity/burstiness from OpenAI logprobs**
  (we already pay for those tokens) instead of paying a detector API — still just a
  diagnostics metric, short-text caveat stands. (3) Runtime lever stays B+D.
- **2026-07-29 (even later)** — Refined the B-vs-D priority after looking at the
  concrete tells + the concrete dataset. **Order flipped: do D FIRST, then B if
  needed.** Reasoning: the flagged tells (evaluative tail clause, abstract sensory
  nouns, twee personification) are STYLE/STRUCTURE problems, not knowledge gaps —
  RAG (great for injecting facts) only *nudges* voice, whereas `aiLingo.ts` regex +
  judge-prompt rules *deterministically* force a rewrite, with zero infra/cost.
  **benxh judged a WEAK fit** and dropped as a corpus: its `caption` field is the
  TikTok *video description* (different genre, hashtag-stuffed) not on-slide overlay
  text, plus ToS murk. **If/when we do B, the corpus is our OWN `trending_posts`
  pipeline, not benxh.** RAG stays a real phase-2 voice lift (needs embeddings +
  pgvector + a retrieval step per judge call), just not the first move.
- **2026-07-29 (impl)** — Shipped D (partial), local/unpushed: added the
  **evaluative-tail-clause** regex to `aiLingo.ts` (`/,\s*(perfect|great|ideal|
  amazing|excellent|wonderful)\s+(for|when|to|if)\b/i`) — verified it flags "…,
  perfect for a creamy finish" and none of the other Run-1 captions (no false
  positives; also feeds the base copy model's retry loop). Added an **"AI-TELL
  STRUCTURES"** block to the judge system prompt naming all four patterns (tail
  clause + abstract sensory nouns + twee personification + over-balanced
  parallelism) so the judge rewrites the semantic ones regex can't safely catch.
  Next: run a Supercharge gen locally, paste captions into GPTZero, confirm drop.
- **2026-07-29 (Run 2 analysis) — KEY INSIGHT.** Phrase fixes landed (judge killed
  the matcha/not-coffee, the "creamy finish"/"caramel drizzle" abstractions, sharpened
  the CTA) but GPTZero still 100% AI. Root cause = **taxonomy #5, structural uniformity**,
  NOT phrases: the judge homogenized all four reasons into one "[drink], [clause]"
  template (lower burstiness than the base copy). It also dodged the new regex by
  dropping the adjective ("for when you want" ≠ "perfect for") — confirms phrase-banning
  is whack-a-mole. **Two new work items:** (1) add a DECK-LEVEL burstiness/variety rule
  to the judge + base copy prompt (vary shape/length/register across slides) — the lever
  that actually moves a detector; re-elevates RAG (real captions are bursty). (2) add an
  **`add_slide`** op + hook-count reconciliation: the count mismatch returned (hook "5",
  4 delivered) because the judge correctly tried to add a 5th coffee but the applier has
  no add_slide op → skipped. **Reality check:** GPTZero 0% on a <100-word listicle is a
  brutal, maybe-unwinnable bar (it warns on short text; real viral listicles often flag
  too because the format is uniform). Truer goal = "a human scroller doesn't clock it,"
  which burstiness + concreteness largely achieves — don't contort captions to please the
  proxy.
- **2026-07-29 (impl #1+#2)** — Local/unpushed. Judge now has a **"SOUND HUMAN"**
  directive attacking taxonomy #5 head-on: (a) VARY EVERY SLIDE — no two captions
  share shape/length/opening; break the "[thing], [clause]" list; (b) STOP
  EXPLAINING — drop the "for people who want…" audience-clause reflex; (c) LAND ONE
  REAL SPECIFIC LINE (opinion/comparison a model wouldn't default to); (d) pick the
  sharper/less-predictable word; (e) read-it-like-a-text test. Added **`add_slide`**
  op (judge can now insert a missing promised item) + a deterministic **count
  backstop** in the applier (rewrites the hook's leading list-count to match the real
  reason-slide count; scoped to a small leading integer so real stats are safe —
  unit-tested). tsc clean. Retest: Supercharge coffee gen → captions should be
  structurally VARIED, count consistent → paste into GPTZero.

- **2026-08-07 — THE CORPUS PROBLEM IS SOLVED (B, first half).** Every plan for B
  stalled on "where does a corpus of real on-slide captions come from" —
  `viralExamples.ts` says outright that no scrapeable one exists, which is why it
  is hand-transcribed. It was in `trending_posts.raw` the whole time:
  `slideshowImageLinks` (the per-slide JPEG URLs) has been stored on every row
  since the ScrapTik switch and never read. New `lib/trend-slide-text.ts` runs a
  `gpt-4o` vision pass over them at ingest and writes the transcription to a new
  `slide_texts jsonb` column. **Cost is ~$0.0009/post** (`detail:"low"` = 85
  image tokens; note gpt-4o-mini is *not* cheaper here — it bills 2833 tokens
  for the same image). Transcription is cached per post, so each one is paid for
  exactly once.
  **Why this matters more than any prompt rule:** `fetchTrendExemplars` was
  feeding the copy model `trending_posts.title`, which is the video
  *description* — a different genre entirely. Verified against the live table:
  the gym block was eight entries of blog-paragraph text truncated mid-word at
  140 chars ("…target every head of the bice") plus `"My comfort zone #gym
  #reposts #slideshow #trend #audio"`, all introduced to the model as "REAL
  TikTok posts going viral — match this energy." The first live transcription
  returned `"whos ready for fall fits"` — missing apostrophe intact. That is the
  register we have been writing thirty prohibitions to try to reach.
  `exemplarsBlock` now renders transcribed decks and description-only posts as
  **separate, differently-labelled groups**: presenting a search-optimised
  description as though it were a slide hook is what taught the model to write
  descriptions in the first place.
  Also handles taxonomy #5 for free — each exemplar carries its following slides
  (`then: …`), so the model sees real deck *shape*, which is the one thing a ban
  list structurally cannot teach.
  ⚠️ Emoji are stripped at the **prompt boundary, not at ingest**: real creators
  use them constantly, so the stored corpus stays a faithful transcription, but
  an exemplar containing an emoji would contradict the same prompt's emoji ban
  (and emoji bake as tofu boxes). Same leak class as the "secret weapon" one.
  **Next:** feed the same transcriptions to the judge (B's second half), and to
  the *curation* pass — it currently judges relevance from hashtag soup, and
  could now read what the slides actually say.

- **2026-09-02 — Taxonomy #6 (zinger cadence) added from Run 75.** Christian
  compared our luxury/wealth deck against a real "5 things successful people do
  differently" deck: theirs is plain 3-6-word lines, ours is five crafted bars.
  Every offending line was a judge `rewrite_caption` justified as "sharper /
  more punch / more arresting". Shipped the same day (see #6) and re-ran the exact
  prompt twice:
  - **Run 76** (prompt + mechanical pass): the copy retry fired as designed
    (attempt 0 had "you" on 4/5 slides → retry passed with 0). No threats, no
    metaphors. But the judge still rewrote 5/5, calling flat sentences "without
    texture" — its rubric could not APPROVE a plain deck, so it swapped the
    zinger voice for a first-person-story voice ("read 'rich dad poor dad' at
    17, went broke trying things i learned").
  - **Run 77** (after telling the judge a flat deck is the target register and
    that rewriting every slide means it is imposing its voice): judge rewrote
    3/5. Final: "track every dollar for 30 days, most people never stop leaking
    money" / "the richest people get tunnel vision on one industry and go deep"
    / "people judge your shoes more than your car, fix the details". Third
    person is back, one edged line at most, "you" on 2/5.
  - **Remaining gap, honestly:** lines are still 10-13-word two-clause
    sentences, not the 3-6-word "avoid toxic people" register. The draft model
    still reaches for the bar on attempt 0 ("buy the watch, not the shoes.
    people notice your wrist before your feet in every boardroom") and the
    14-word cap is what knocks it back. If plainer is wanted, the next lever is
    a LOWER cap (10-12) or a deck-average word budget, not more prose rules.
  - **Run 78 — `MAX_CAPTION_WORDS` 14 → 10 (prompts: 2-8, 10 max).** Attempt 0
    still came back with 12-14-word bars ("nobody tells you how weird it feels
    spending on real luxury when you're 22") and the cap retried it; the retry
    was the plainest draft yet, every line 7-9 words: "saved almost every bonus
    i got at 22" / "asked for advice from people already wealthy" / "worked jobs
    that paid commission not just salary". Judge still rewrote 3/5 (its
    complaint this time: "three slides open with bland verbs"), but every
    rewrite stayed under the cap and plain: final deck "i did these things way
    before i had money" / "copied how rich people spent their weekends" / "i
    wanted big commission checks, never just a salary". 0 threats, 0 "you", 0
    metaphors. This is the closest to the reference register so far; the cap
    is the lever that moved it, not the prose rules.

## Open questions
- RAG: retrieve by topic-embedding similarity, by niche, or both? How many exemplars
  before the prompt gets diluted?
- Do we want a second judge pass (the user's "another model looks AGAIN" idea) that
  focuses *only* on voice, after the value/hook judge?
- `aiLingo.ts`: how aggressive before false positives hurt (some tells are legit in
  the right caption)?
