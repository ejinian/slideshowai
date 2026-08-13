# Gomez-ready plan — TEMPORARY

Delete this file when the last item ships. Working doc only; nothing here belongs
in CLAUDE.md until it's built and proven.

**Process:** strictly top to bottom. For each item — discuss to consensus FIRST,
then build, then one commit. No batching.

Status key: `todo` · `discussing` · `agreed` · `built` · `done` (committed)

---

## 0. PASS THE DIRECT POST AUDIT (rejected 2026-08-09) — TOP PRIORITY

**Status:** discussing — the resubmission is a re-recorded VIDEO, not a code fix.

**The rejection, verbatim:** "Your application did not follow our UX Guidelines…
The demo video should show the complete end-to-end flow of the integrations with
TikTok and the ending must show that had been post under TikTok. Please showcase
full interactions the privacy settings, interaction settings and Content
Disclosure Setting."

**Why it failed — every possibility, ranked:**
1. **(Stated by reviewer, near-certain)** The video reused was
   `tiktok_audit_slidelabs.mp4` — recorded for the earlier APP review (Login
   Kit / scopes), not for this audit's UX checklist. It did not END by opening
   TikTok and showing the published post live on the profile — the explicit
   "ending must show" requirement.
2. **(Stated by reviewer, near-certain)** It did not demonstrate FULL
   interactions: opening the privacy dropdown and selecting, toggling Allow
   comments, turning on the disclosure and ticking Your brand / Branded
   content. Showing the modal is not enough — they want to see each control
   operated.
3. **(Real code gap, fixed 2026-08-09)** The guidelines require label feedback
   when a disclosure option is picked — "Your photo will be labeled as
   'Promotional content' / 'Paid partnership'". Our modal never showed those
   lines; a reviewer pausing on the disclosure section could fail us on it
   alone. Now added to TikTokPostButton.
4. (Possible) The video showed a domain other than the org website submitted
   (`https://www.slidelabs.ai/`) — guidelines require the demo's domain to
   match. Old recording may show vercel.app or localhost.
5. (Unlikely but checkable) The flow shown was Send-to-drafts (`MEDIA_UPLOAD`),
   which never ends "posted under TikTok" — the audit is for DIRECT POST.

**What is NOT the problem:** the modal itself. Verified line-by-line against
the guidelines page: creator nickname shown, privacy from privacy_level_options
with no default, comment toggle unchecked by default (Duet/Stitch correctly
absent — photo posts), disclosure off by default, branded+private blocked with
the exact warning, declaration switches to Branded Content Policy + Music Usage
Confirmation, processing state + status polling. All present before the audit.

**The pass plan — re-record ONE video (5 requirements):**
1. Record on `https://www.slidelabs.ai` (domain visible in the URL bar, matches
   the application), logged in as a real non-admin-looking flow.
2. First flip the TikTok account to **Private** (Settings → Privacy → Private
   account ON) — unaudited clients can only DIRECT_POST to private accounts, and
   the audit video must show a REAL successful direct post.
3. Full flow in one take: connect TikTok (consent screen) → generate a deck →
   open Post to TikTok → **operate every control on camera**: open the privacy
   dropdown and pick an option; toggle Allow comments off and on; enable
   Disclose content promotion; tick Your brand (label line appears); tick
   Branded content (declaration gains Branded Content Policy); briefly select
   Only me to show the branded-private block, then back. Then Post now.
4. Show the processing state, then **open TikTok itself (app or web), navigate
   to the profile, show the post is live, and END THE VIDEO THERE.**
5. mp4, ≤50MB, ≤5 files. Then portal → Content Posting API → Direct Post →
   Reapply with the same written answers (they were not the problem).

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

**Status:** pinch + two-finger move + swipe DONE (2026-08-10). ROTATION NOT DONE
— it is the only part with no existing home. There is no rotation anywhere in
the stack: not in SlidePos, layout.ts, composite.ts, the reposition route, or
the DB. Adding it means a migration, a new field through layoutSlide, an SVG
transform in the resvg bake, a matching CSS transform in CaptionLayer, and
rotated-bbox math for the drag hit area — and the bake and the overlay must
agree exactly or WYSIWYG breaks. Worth doing deliberately, not as a rider.

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

**Status:** DONE (2026-08-10). The plumbing was already right — the auth route
takes ?return_to, the callback replays it from an httpOnly cookie, and
TikTokPostButton defaults to /dashboard/slideshows/<id>. The Generator was
overriding that default with a hardcoded returnTo="/dashboard", and the result
card lives in CLIENT state on /dashboard, so the round-trip landed on an empty
composer with the just-made deck invisible. Removing the prop was the whole fix.

**What happens:** connecting TikTok redirects to `/dashboard`, losing the deck
the user just made. It should return to that slideshow's detail view, which
already exists by then.

**To discuss before building:**
- The OAuth popup callback decides where to land; carry the origin through
  `state` (already signed) rather than a query param.
- Applies to the connect-from-post-modal flow specifically.

---

## 7. Gomez deck review — PRIORITY RAISED 2026-08-10 (presenting soon)

**Status:** deck built and pushed (`gomez_demo/deck.html`, 10 slides, self-contained).
Blocking work before presenting is SMALL:
- Swap slide 2's photo strip to real Instagram shots — the site photos I scraped
  are mostly licensed stock (the stethoscope-on-tree one especially). Jaime will
  recognise his own website's stock. This is the only real gap.
- Re-read slide 8 ("Straight talk"): it already says TikTok-only + drafts-first,
  which is still exactly true and now doubly important — the Direct Post audit
  was REJECTED (item 0), so public posting is not available. Drafts-first was
  always the Gomez plan, so nothing in the deck needs rewriting.
- Rehearse with a pre-generated backup deck; do not rely on a live generation.

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
