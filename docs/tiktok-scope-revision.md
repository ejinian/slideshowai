# TikTok scope revision — user.info.stats + video.list

**Goal:** first-party analytics with zero scraping. `user.info.stats` returns the
account's follower/likes/video counts; `video.list` returns the user's own posts
WITH `view_count` / `like_count` / `comment_count` / `share_count`. Together they
replace the Apify/ScrapTik dependency Christian rejected on 2026-08-31.

**State of the code (already shipped, dormant):** everything is built and gated on
`TIKTOK_STATS_SCOPES`. While unset, the authorize call requests only the held
scopes (so connecting keeps working) and `/api/analytics/refresh` answers
`not_enabled` (so the page stays on internal numbers, no banner). Flipping the
flag is the ONLY post-approval code-side step.

## Why a revision, and what it risks

Adding scopes to the production app requires **Create Revision** in the developer
portal — a re-review of the app with an updated demo video. The app's standing is
the best it has ever been (app review passed 2026-08-04, Direct Post audit
approved 2026-08-31), but a revision re-opens review; do not bundle unrelated
changes into it.

⚠️ **Never put the new scopes into the authorize call before approval.** A scope
the app doesn't hold makes TikTok reject authorize *before* the consent screen —
the generic error page — which breaks CONNECTING for every user, not just
analytics (this exact mistake forced `user.info.stats` out on 2026-08-08). The
env gate exists so this cannot happen by accident.

## Pre-submission verification (sandbox, do FIRST)

The one genuine unknown: **does `/v2/video/list/` return PHOTO posts?** Our posts
are photo slideshows; if the endpoint only lists videos, per-post counts are
impossible via the official API and only `user.info.stats` is worth requesting.
Verify before writing the submission:

1. Sandbox app (`sbaw…`): enable Login Kit + Display API, add scopes
   `user.info.basic`, `user.info.stats`, `video.list`, and add the test TikTok
   account as a Target User. (Sandbox grants scopes instantly, no review.)
2. Point local `.env.local` at the sandbox key/secret, set
   `TIKTOK_STATS_SCOPES=on`, connect the test account locally
   (sandbox accepts the localhost redirect; production doesn't).
3. Visit `/dashboard/analytics` — the refresh fires automatically. Check:
   follower cards populate, and whether the photo posts published earlier by the
   test account appear with view counts.
4. **Restore the production key in `.env.local` afterwards** and confirm with
   `node scripts/check-proxy.mjs` (must name the production app). A forgotten
   sandbox key is what poisoned the first Direct Post audit video.

If photo posts are missing from `video.list`, submit the revision for
`user.info.stats` only and drop `video.list` from the env-gated scope string.

## Portal steps

1. developers.tiktok.com → Manage apps → **SlideShowAI (production, awlhy3…)** →
   **Create Revision**.
2. Products: ensure **Login Kit** and **Display API** are added (`video.list`
   belongs to Display API; `user.info.stats` to Login Kit's user info).
3. Scopes: add `user.info.stats` and `video.list` (keep `user.info.basic`,
   `video.publish`, `video.upload` exactly as they are).
4. While in there, consider fixing the app **name** — the portal still says
   "SlideShowAI" while the org/website say SlideLabsAI / slidelabs.ai. A reviewer
   comparing form to video will notice. (Optional, but this revision is the
   natural moment.)
5. Attach the demo video and per-scope justifications below; submit.

## Scope justifications (paste into the form)

**user.info.stats** — "SlideLabsAI creators publish photo slideshows to their own
TikTok accounts through the app. The Analytics page shows each creator their own
account's follower count, total likes, and video count, and charts follower
growth over time from periodic reads. Data is fetched only for the authenticated
creator's own account, displayed only to that creator on their private
dashboard, and never shared, published, or used for any other purpose."

**video.list** — "The Analytics page lists the posts the creator published
through SlideLabsAI with their view, like, comment, and share counts, so the
creator can see how their own content performs. The app reads the authenticated
creator's own video list only, matches it to posts made through the app, and
displays the counts only to that creator. Read-only; no content is downloaded,
republished, or shown to anyone else."

## Demo video shot list

Film at `https://www.slidelabs.ai` (desktop browser, URL bar visible), logged in
as the demo TikTok account. **Lessons from the rejected Direct Post audit
(2026-08-19): the consent screen must read "SlideShowAI" with NO "(Sandbox)", and
the URL bar must show the production `client_key=awlhy3…` — if either is wrong,
stop and fix the key, don't finish the take.** Note the tension: production can't
request unapproved scopes, so for a SCOPE revision TikTok expects the sandbox app
to demonstrate the new scopes — check the current revision-form wording; if
sandbox footage is acceptable (it was for the original app review), film there
and show the production app everywhere else. If the form demands production
footage of unheld scopes, contact TikTok developer support before guessing.

1. Dashboard → disconnect any stale TikTok connection.
2. Connect TikTok: show the consent screen listing EVERY requested scope,
   including the two new ones; approve.
3. Open **Analytics**: show follower / total likes / video count cards
   populating, and the follower trend chart.
4. Scroll to the posted table: show real view/like counts against posts.
5. Briefly show that nothing outside the creator's own dashboard uses the data.

## After approval

1. Vercel: set `TIKTOK_STATS_SCOPES=on`, redeploy (env changes need one).
2. Reconnect flow: tokens issued before the flip lack the new grants. The
   analytics page detects this (`needs_reconnect`) and shows a Reconnect button —
   no announcement needed, but Christian should reconnect his own account to see
   real data end-to-end.
3. Verify live: visit `/dashboard/analytics`, confirm a fresh
   `account_snapshots` row and view counts on recent posts.
4. Local dev: add `TIKTOK_STATS_SCOPES=on` to `.env.local` too.
