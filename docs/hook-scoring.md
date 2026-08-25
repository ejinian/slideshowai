# Hook scoring — learning which hook shapes actually win

> **Living doc / spec.** Phase 3 of the hook-diversity work started 2026-08-10
> (phases 1 and 2 shipped; see the history section). This is the design for the
> scoring layer itself. Update it as we learn.
> Pointer in `CLAUDE.md`.

Last updated: **2026-08-24**. **Step A shipped** — see the history section.

---

## What this actually is

**Not a greenfield feature.** Two things in `lib/generate/` already choose "what's
winning in this niche" and both do it by ordering on `views_per_hour` descending:

| Consumer | What it selects | How |
|---|---|---|
| `trendExemplars.fetchTrendExemplars` | top 24 → 8 few-shot voice exemplars | `order(views_per_hour, desc).limit(24)` |
| `trendBlueprints.fetchTrendBlueprint` | **one** post whose mechanic steers the whole deck | `order(views_per_hour, desc).limit(12)`, first row passing the quality gate |

So phase 3 is **replacing a ranking function that is already live and already
wrong**, not adding a new system. That is the cheapest framing and the one this
spec builds to. `hookBank.ts` even anticipated the seam:

> *"A dynamic, trend-sourced version can layer on later without changing the injection seam."*

---

## Findings (measured 2026-08-24, n=1344 posts / 759 transcribed)

### 1. `views_per_hour` mostly measures post AGE, not hook quality

`lib/trends.ts:383` — `views_per_hour: Math.round(views / hours)`, a **lifetime
average frozen at ingest**. Bucketing the labelled corpus by age-at-scrape:

```
age    0-24h   n=199   medVPH=11   medViews=1265
age   24-72h   n= 34   medVPH= 7   medViews=1586
age  72-168h   n= 56   medVPH= 5   medViews=1459
age 168-720h   n=158   medVPH= 2   medViews=1467
age    720h+   n=170   medVPH= 2   medViews=2328
```

**Views are flat across age; vph falls 5.5×.** Ranking by vph largely ranks
"scraped soon after posting." This confound is *larger* than the follower-count
one flagged in the original analysis, and it hits both live consumers.

### 2. The live blueprint picks are mostly off-model

Replaying `fetchTrendBlueprint`'s exact query + gate per niche today:

| Niche | Author | hook_type | Hook that steers every plain deck |
|---|---|---|---|
| Gym & Fitness | @jacob.tigerbutworse | Callout | "you need big surplus to build muscle" ✅ |
| Food & Dining | @hirableeh | Curiosity gap | "Just minding my business, don't believe me? Swipe to see ->" |
| E-commerce | @maisie_crompton | Transformation arc | "Things I did to help me feel better after loosing another pregnancy" |
| B2C App | @apps.i.need | POV story | "ANDROID APPS THAT FEEL ILLEGAL Android users are spoiled." ✅ |
| Local Service | @teasdigitaldiaries | Photo dump | "photos i feel weirdly pretty in" |

Three of five steer a **value listicle generator** with a mechanic that carries no
value payload — and E-commerce is steering every plain deck with a personal
pregnancy-loss post. The prose gate is doing its job (it correctly rejected
`"SLIDESHOW IDEA!!"` and two empty-slide posts), but *velocity is not taste*.

A 5-minute cache means every deck in a niche gets the same one.

### 3. `hook_type` is free text and has fragmented

72 distinct labels over 759 transcribed rows. 55 are singletons; 11 labels with
n≥10 cover ~80% of the corpus. Aggregating over the raw field is not possible.

```
128 Photo dump   107 Transformation arc   86 Curiosity gap   82 POV story
 77 Listicle      44 Numbered listicle    39 Callout         22 Before and after
 13 Price anchor  10 Product showcase     78 (null)
```

Phase 2 fixed the *input* (curation now reads real slide text) but never
constrained the *output vocabulary*, so labels drift per run.

### 4. Author normalization is feasible — the corpus supports it

- 139 distinct authors; **697 of 759 posts (92%) belong to an author with ≥3 posts.**
- **90 of 130 authors used ≥2 distinct hook shapes, covering 534 posts** — enough
  for a within-author (fixed-effects) comparison, which is the statistically
  correct way to control for audience size.

### 5. …but naive "lift vs own median" is degenerate

Per-post `views_per_hour ÷ author median`, authors with ≥3 posts (n=549):

```
p10=0.17  p25=0.67  p50=1.00  p75=1.67  p90=4.00  max=124.0
24% of posts have lift EXACTLY 1.00
```

Median-of-lift per cell came back `1.00` in 17 of 24 niche×shape cells — the
statistic is self-referential (an author's own median post scores 1.0 by
construction) and the tail is wild (124× from a 2-post author). **Do not ship
median-of-lift.** Needs a log transform, winsorization, and a within-author
paired design.

### 6. `trend_snapshots` already gives an age-robust metric

**35,299 snapshots, 1050 distinct posts, 843 with ≥3 captures, spanning
2026-07-07 → 2026-08-19** (28 capture days). `lib/trends.ts:1190` already computes
`risingVph` from consecutive deltas for the feed and documents exactly why:

> *"unlike the lifetime views_per_hour (frozen at ingest), it measures what's climbing NOW."*

The scoring layer should use the same delta, not the frozen average.

> ⚠️ Last capture is **2026-08-19**, 5 days before this doc. Worth confirming the
> daily sweep is still writing snapshots before trusting recency-weighted scores.

---

## Design

### Layer 0 — a closed hook vocabulary (`lib/generate/hookTaxonomy.ts`)

A canonical enum, aligned to the six shapes in `hookBank.ts` so the score's output
is directly actionable:

```
curiosity_gap · forbidden_secret · cost_stakes · callout
before_after · outcome_promise · listicle · pov_story · price_anchor
```

Plus a **`NOT_STEERABLE`** set — `photo_dump`, `sentiment`, `engagement_bait`,
`product_promo` — shapes that exist in the corpus but carry no value payload.
These are scored for observability and **excluded from steering** (this alone
fixes the Local Service and E-commerce picks above).

Two consumers:
1. **Curation prompt** constrains `hook_type` to the enum (no new model spend —
   it already writes the field; this is prompt text plus a server-side clamp,
   the same shape as the `DETAIL_VALUES` / niche-slug clamping already used).
2. **`canonicalizeHookType(raw)`** maps the 72 legacy free-text labels for
   backfill and for rows written before the clamp. Regex table, no model call.

### Layer 1 — the metric

Per post, per snapshot interval:

```
delta        = views[t] - views[t-1]
hours        = (captured_at[t] - captured_at[t-1]) / 3.6e6
climbRate    = delta / hours                       ← age-robust (finding 6)
score        = log1p(climbRate)                    ← tames the 124× tail
authorLift   = score - median(score for that author)   ← within-author (finding 4)
```

Winsorize `climbRate` at the per-niche p95 before the log. Fall back to
`log1p(views_per_hour)` for posts with <2 snapshots, flagged so the two
populations can be compared rather than silently mixed.

### Layer 2 — the estimator

**Within-author fixed effects**, not a raw group mean:

- For each author who used ≥2 shapes, compute their per-shape mean `authorLift`.
- Average those author-level contrasts across authors per `(niche, shape)`.
- **Shrink toward the niche prior** (empirical Bayes / James–Stein):
  `shrunk = (n·observed + k·prior) / (n + k)`, `k ≈ 5`.
  A 2-post cell then can't win on noise — the exact failure mode finding 5 shows.
- Emit `{niche, shape, n, shrunkScore, confidence}` and **require `n ≥ 8`** to
  influence steering at all.

Recency: weight posts by `exp(-ageDays / 30)` so a shape that stopped working
decays out.

### Layer 3 — selection is SAMPLING, never argmax

This is the point the original analysis turned on: *a score picks a winner, so you
get 100% "curiosity gap" instead of 100% "5 ways to…" — the same monotony wearing
a different hat.*

```
weight(shape) = exp(shrunkScore / T)     // T ≈ 0.7, tunable
```

Sample one shape from the steerable set. Floor every steerable shape at a small
non-zero weight so nothing is ever fully starved (also keeps exploration alive for
future scoring rounds). Seed the RNG per generation, and record the drawn shape in
`gen_meta` — attribution is already wired (migration `20260820120000`).

### Layer 4 — wiring (two small diffs, no prompt changes)

1. **`hookBank.hookBankBlock()`** takes an optional ranked shape list and reorders
   / annotates the six formulas ("landing hardest in this niche right now").
   Static bank stays the fallback; the injection seam is unchanged, as designed.
2. **`trendBlueprints.fetchTrendBlueprint()`** stops being `order(vph).first()`.
   It scores the candidate window, filters to steerable shapes, and samples.
   Keep the existing quality gate (transcribed slides, ≥2 anatomy beats, prose
   hook ≥3 words) exactly as-is — it is working.

`listicle.ts` / `imageFirst.ts` / `/api/generate` stay untouched, same as every
other reader-shaped feature (product link, TikTok reference).

### Layer 5 — guardrails

- **Kill switch** `HOOK_SCORING=off`, matching `TREND_BLUEPRINTS=off`.
- **Zero new model spend.** One indexed SELECT + a 5-min cache, like its two
  neighbours. The scoring aggregate can be a materialized view refreshed by the
  existing cron if the live query gets expensive.
- **Fails to the static bank**, never to an error — same contract as
  `fetchTrendBlueprint` returning null.

---

## Staged plan

**Step A ✅ shipped 2026-08-24.** `lib/generate/hookTaxonomy.ts` (closed enum +
`canonicalizeHookType` over the 72 legacy labels) and `trendBlueprints.ts`
(steerable-shape filter, rank-weighted sampling over the candidate window,
canonical shape recorded in `gen_meta`). No new tables, no new model spend.

Measured over 40 draws per niche afterwards: 4-6 distinct posts drawn per niche
instead of 1, and the "photos i feel weirdly pretty in" Photo-dump steering is
gone from Local Service.

> ⚠️ **What Step A did NOT fix:** the E-commerce pregnancy-loss post is labelled
> *Transformation arc* → `before_after`, which is a legitimately steerable shape,
> so the filter does not touch it. Sampling cut it from 100% of decks to ~1 in 3,
> but a shape filter is structurally the wrong tool for "sensitive personal
> content". If that matters before step B, the fix is a sensitive-topic screen in
> the ingest curation pass, not a change here.

**Step B — the estimator.** Layers 1–2 over `trend_snapshots`, offline first:
dump the ranking per niche and eyeball it against intuition before it touches
generation. If shapes rank in a way nobody can explain, the metric is wrong.

**Step C — wire into `hookBank`.** Only once B's ranking survives inspection.

Step A is worth doing on its own even if B never ships.

---

## The limitation that none of this fixes

**Survivorship.** Everything in `trending_posts` already won — we scrape top search
results and a chosen watchlist. The score measures *which shape wins among
winners*, not which shape wins. No amount of normalization fixes a corpus with no
losers in it.

The only real fix is our own posts' outcomes — deck → `slideshows.gen_meta` →
`tiktok_posts` → scraped public views. That join key ships already, deliberately,
but the loop is **parked until the Direct Post audit clears** (it needs public
posts). Until then, treat every number here as a prior, not a measurement — which
is another argument for sampling over argmax.

---

## History

- **2026-08-10** — Original analysis. Found the numbered-hook monotony was a hard
  validator (`isValid` rejecting any 4+ deck whose hook lacked the digit), not
  model taste. Four objections raised to a naive score: survivorship, unreliable
  `hook_type`, follower-count dominance, small cells — plus the argmax-monotony
  problem.
- **Phase 1 ✅** (`3c5ec37`) — dropped the number requirement; `numbered` now
  derives from the hook. Measured 3 of 6 decks unnumbered afterwards.
- **Phase 2 ✅** — transcription moved *before* curation so `hook_type` and
  relevance are judged on real on-slide text, not the video description.
  (Nearly shipped a regression that treated a missing transcription as grounds
  for dropping the post — would have emptied the feed at 741/742 rows.)
- **Phase 3 ⏸️ → this doc.** Was gated on corpus size: 1 of 742 rows had
  `slide_texts` on 2026-08-10. Now **759 of 1344**. Gate is open.
