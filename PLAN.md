# Gomez-ready plan — TEMPORARY

Delete this file when the last item ships. Working doc only; nothing here belongs
in CLAUDE.md until it's built and proven.

**Process:** strictly top to bottom. For each item — discuss to consensus FIRST,
then build, then one commit. No batching.

Status key: `todo` · `discussing` · `agreed` · `built` · `done` (committed)

---

## 1. Alen's cryptic error — "generating too fast" on a first attempt

**Status:** DONE — root cause was a missing profiles row, not the rate limit

**Symptom:** Alen made one slideshow, one time, on his phone, and got an error
about generating too fast.

**Diagnosis (high confidence).** `/api/generate` calls `claimGenerationSlot()`,
which does `admin.rpc("claim_generation_slot")` and returns
`!error && data === true`. An RPC *error* is therefore indistinguishable from a
genuine rate-limit denial, and both produce the 429 "You're generating a bit
fast — give it a few seconds." Until the billing migration was run (today), those
functions did not exist in the database, so **every** generate attempt errored
and every user saw a rate-limit message on their first try.

`spendCredits()` has the identical flaw: it fails closed to `null`, which the
route renders as 402 "You've reached your plan's slideshow limit" — a lie when
the real cause is a missing function or a DB outage.

**CONFIRMED.** Ernest, in the same place on the same network, saw no error — because
`ernest.jinian@gmail.com` is in `ADMIN_EMAILS` and `if (!isAdmin)` skips both guards
entirely. The bug was invisible to the only person testing it and hit every real user.

**Proposed fix:** separate infrastructure failure from policy denial.
- `claimGenerationSlot` / `spendCredits` return a discriminated result — denied
  vs errored — instead of a bare boolean/null.
- Errored → 500 with a real message, and log the Postgres error.
- Denied → the existing 429/402 copy.
- Fail-closed behaviour is KEPT (an error must never grant free generation); only
  the message the user sees changes.

**ACTUAL ROOT CAUSE (proven against a local Postgres).** Six users had NO
`profiles` row. `claim_generation_slot` is `update profiles where id = p_user`
returning `row_count > 0` — no row means zero rows updated, false, and a 429
"generating too fast" on a first-ever attempt, forever. `spend_credits` returns
-1 the same way, which reads as "you've reached your plan's limit". The row was
supposed to be guaranteed by the signup trigger; `loadBilling()` used to upsert
it as a side effect and quietly covered every case the trigger missed, and the
hardening pass removed loadBilling.

Fixed by `20260810000000_profiles_selfheal.sql`: backfill, a trigger that can no
longer fail a signup or a re-run, and `ensure_profile()` called at the top of all
three guards so they never again depend on the trigger having worked. Verified on
a scratch schema: bug reproduced (f / -1), backfill → 0 missing, and a brand-new
user with the trigger DELETED still generates because the guard heals the row.

**Still open — Ernest's ask:** diagnostics must capture failures like this. Right
now `lib/generate/diagnostics.ts` only dumps successful pipeline runs, so a
request rejected at the billing gate leaves no trace at all. See item 8.

---

## 2. TikTok reference URL — "make one like this"

**Status:** DONE (2026-08-09, commit 8a6be08). /api/reference (1 credit, reserve→
refund), lib/reference/tiktok.ts (tikwm→Apify + one gpt-4o vision call →
FormatBlueprint riding the Remix channel), vibrant gradient composer section +
"+ → Make one like this". Photos analyzed and discarded, never stored.

**What Ernest wants:** somewhere in the composer, a field for a TikTok URL. If
that post is a slideshow, we download its images, analyse what makes it work, and
rebuild that structure using the user's OWN photos.

**To discuss before building:**
- Where it lives in the composer (its own `+` section, like Product link?).
- How we fetch a TikTok post's images server-side. TikTok answers server-side
  fetchers with a bot wall (documented for TikTok Shop + Kalodata). Apify is
  already wired for trend scraping — likely the same route.
- What "analyse" means concretely: slide count, hook shape, caption rhythm,
  photo→caption relationship. Output must be the shape `/api/generate` already
  takes, exactly like `/api/product` — the reader/generator split stays intact.
- Do we ever show the source post's images to the user, or only learn from them?
  (Copyright: we must not republish someone else's photos.)

---

## 3. Multiple TikTok accounts per SlideLabs account

**Status:** todo

**What Ernest wants:** connect 2–3 TikTok accounts, pick which one to post to,
disconnect one, or disconnect all with one button.

**To discuss before building:**
- `tiktok_connections` is keyed one-row-per-user (`onConflict: "user_id"`).
  Needs a real multi-row model + a "which is active" concept.
- Migration: unique on `(user_id, open_id)`, keep existing rows working.
- Every read path assumes one connection — post, status, scheduled publish, the
  cron publisher, analytics snapshots, the settings panel.
- Scheduled posts must remember WHICH account they were queued for.
- UI: account switcher in the post modal + Settings.

---

## 4. "Let AI decide" — the plug fails

**Status:** todo

**What Ernest reports:** plugging completely doesn't work in "Let AI decide"
mode. Ernest will supply a diagnostics run.

**Note:** the mandatory plug slide was REMOVED 2026-07-19 (every middle slide is
a pure-value `reason`; `SlideRole` still permits `"plug"` for old decks). A later
commit — `45419ec` "honor an explicit plug request instead of banning it" — put
back conditional plugging. So the bug is probably that `/api/suggest`'s planner
output never carries the plug intent through to `/api/generate`. Confirm against
the diagnostics before touching anything.

**Blocked on:** Ernest's diagnostics folder.

---

## 5. Mobile touch: pinch-to-resize text, swipe between slides

**Status:** todo

**What Ernest wants:** two-finger pinch to scale caption text, exactly like the
TikTok and Instagram editors. And horizontal drag on the slide should move
between slides — not scroll the page — like the TikTok app's own slideshows.

**To discuss before building:**
- Caption size already exists as `font_scale` (clamped `FONT_SCALE_MIN/MAX`,
  saved via the reposition route). Pinch drives that value; no new storage.
- Pinch and the existing caption DRAG must not fight each other.
- Horizontal swipe needs `touch-action` handling so the page doesn't scroll, and
  must not swallow vertical scrolling of the editor below.
- Where it applies: the just-generated view AND the detail view (same component).

---

## 6. After connecting TikTok, land on the slideshow — not the dashboard

**Status:** todo

**What happens:** connecting TikTok redirects to `/dashboard`, losing the deck
the user just made. It should return to that slideshow's detail view, which
already exists by then.

**To discuss before building:**
- The OAuth popup callback decides where to land; carry the origin through
  `state` (already signed) rather than a query param.
- Applies to the connect-from-post-modal flow specifically.

---

## 7. Gomez deck review

**Status:** todo — LAST. Every bug above outranks it.

- Swap slide 2's photo strip to real Instagram shots (the site ones are stock).
- Re-read the copy once the product actually does what the deck claims.

---

## 8. Diagnostics must capture failures, not just successful runs

**Status:** DONE (2026-08-09). `logFailure()` in diagnostics.ts writes one JSON
per failed request to diagnostics/Failures/ (dev-only, image payloads stripped):
wired into every generate gate rejection, both generate pipeline paths (JSON +
stream), and every reference failure (with the resolver/analysis detail). First
real catch: reference analysis failed because OpenAI's fetcher can't read
TikTok's referer-checked CDN — slides now download server-side and go up as
base64, mirroring trend-slide-text.

`lib/generate/diagnostics.ts` dumps a forensic folder for runs that reach the
pipeline. Alen's request never got that far — it was rejected at the billing gate
— so there was nothing to read, and the cause took a DB query to find. Anything
that returns non-200 from /api/generate should leave a dump: the request, the
user id, which guard rejected it, and the raw Postgres error where there is one.
