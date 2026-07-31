# Anti-AI-Voice — making captions read genuinely human

> **Living doc.** This is the working space for the ongoing effort to stop
> Supercharge's judge (and the base copy model) from producing captions that
> *read* as AI-written even when they're technically fine. Update it as we learn.
> Pointer in `CLAUDE.md`; recall pointer in the auto-memory (`project-anti-ai-voice`).

Last updated: **2026-07-29**.

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

> Add new patterns here as we spot them. The user is the best source — every
> caption they call out goes in with a name + why.

## Options on the table

| # | Approach | What | Status | Cost/risk |
|---|----------|------|--------|-----------|
| A | Persona + hook archetypes | Judge system prompt embodies a real creator + named hook shapes | **DONE** (2026-07-29) | Free, in-prompt |
| B | RAG real captions → judge | Retrieve top-k real high-performing captions in the deck's niche/topic and show the judge "this is how humans phrase it" | **Proposed — likely best lever** | Retrieval infra; ~free per gen if we reuse our own trend pipeline |
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

## Open questions
- RAG: retrieve by topic-embedding similarity, by niche, or both? How many exemplars
  before the prompt gets diluted?
- Do we want a second judge pass (the user's "another model looks AGAIN" idea) that
  focuses *only* on voice, after the value/hook judge?
- `aiLingo.ts`: how aggressive before false positives hurt (some tells are legit in
  the right caption)?
