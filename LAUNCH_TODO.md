# MVP Launch Weekend — To-Do

Priority order. 🔴 = launch blocker, 🟡 = should-have, 🟢 = nice-to-have.

## 1. Generation quality (the product)
- 🔴 **Set `PEXELS_API_KEY` in Vercel** — without it the new live-Pexels tier silently falls back to the frozen library and image quality reverts. Verify `gpt-image-1` is enabled on the prod OpenAI key too.
- 🔴 **Systematic quality pass**: generate 3–5 slideshows in EVERY niche (+ off-niche topics like "why you should sleep more"), grade captions and image relevance, tune the listicle/vision-judge prompts from what you see. This is the weekend's core work.
- 🔴 **Measure end-to-end latency** — the pipeline is now gpt-4o captions + live Pexels + vision judge + possible AI-gen (~15s/slide). If paid-plan generations regularly exceed ~45–60s, ship the proposed progressive per-slide loading UI (needs the `bg_status` migration) or cap AI-gen slides per deck.
- 🟡 **Run the library metadata migration + backfill** (`20260714100000` + `node scripts/ingest-library.mjs --backfill-meta`) so the library fallback also matches captions.
- 🟡 **Storage upload retry** — the "bad record mac" TLS flake kills whole generations; add a retry to `rawStorageUpload` so one flaky upload doesn't 500 the run.
- 🟢 Editor WYSIWYG spot-check after all the pipeline changes (drag captions, re-render, zip).

## 2. Scheduling
- 🔴 **True end-to-end test**: queue a post for +15 min → cron-job.org fires `publish-scheduled` → post lands on TikTok → shows in My Posts. Verify `CRON_SECRET` matches in prod.
- 🟡 Test the failure paths: cancel a queued post, schedule with a disconnected TikTok account, expired TikTok token mid-queue.
- 🟡 Timezone sanity check around midnight (partner just fixed "today" being UTC — verify it stuck).

## 3. Analytics
- 🟡 **Decide honestly what launches**: wire it to real data we have (`tiktok_posts` history, post statuses, generation counts) and cut anything mock-driven. A small real dashboard beats a big fake one.
- 🟢 If TikTok metrics (views/likes per posted slideshow) are reachable via the API for posted content, pull them; otherwise label clearly as "coming soon".

## 4. Images
- 🟡 Review the vision judge's accept/reject balance per niche after the quality pass — tighten "specific subject must be depicted" if wrong images still slip through.
- 🟡 Top up weak library collections (ecommerce is empty) and add candid-biased ingest queries where results look stocky.
- 🟢 Raise ingest quality floor / add more per-niche queries based on what the quality pass reveals.

## 5. Subscriptions rework (quotas & pricing)
- 🔴 **Re-derive the ladder from real unit costs** (~2–3¢/stock slideshow, +~2¢ per AI-gen slide): decide final quotas (free 5? Growth 150? Scale 400?), whether AI-gen backgrounds are all-paid-tiers or Scale+, and credit pack sizing.
- 🔴 **Update Stripe to match**: new prices in the Stripe dashboard → `STRIPE_PRICES` env in Vercel → `lib/billing/plans.ts` display values. Test a real live-mode checkout + webhook + portal round-trip on prod.
- 🟡 Verify quota/rate-limit UX: hitting 402/429 shows the upgrade path, not a scary error.
- 🟢 Landing page has no pricing section — decide if launch needs one.

## 6. Launch blockers you didn't list (my additions)
- 🔴 **TikTok app audit** — unaudited app = posts are SELF_ONLY and only Private accounts can connect. Either submit for TikTok review NOW (takes days) or make the UI honestly set expectations ("posts publish as private until approval"). This is the single biggest launch-experience risk.
- 🔴 **Supabase auth config**: add the prod callback to Redirect URLs (Google double-login fix), confirm email-confirmation setting is what you want for launch signups.
- 🔴 **Billing safety on prod**: confirm `STRIPE_WEBHOOK_SECRET` (prod), quota enforcement, and the fair-use cap actually block over-generation — this is what protects your OpenAI bill.
- 🟡 **Monitoring & spend alarms**: OpenAI usage alert, Apify budget cap (~$130/mo trends), Vercel/Supabase quotas (free-tier 1GB storage will fill with AI images + library — consider Supabase Pro before launch), and a quick error-visibility plan (even just Vercel log drains).
- 🟡 **Mobile pass** on the funnel: landing → signup → onboarding → composer → result on a phone viewport. The composer/editor were desktop-verified only.
- 🟡 **Onboarding & empty states**: fresh-account walkthrough — no slideshows, no TikTok connected, free plan — should feel guided, not empty.
- 🟡 **E2E gaps**: the suite covers only the generator happy path. At minimum add scheduling + billing-gate smoke tests before launch weekend ends.
- 🟢 **Real domain**: `slideshowai-three.vercel.app` is fine for MVP, but a custom domain means redoing TikTok domain verification + `NEXT_PUBLIC_APP_URL` + Supabase/Google/TikTok redirect URLs — decide now whether it's pre- or post-launch.
- 🟢 Support/contact channel + a review pass of Privacy/Terms pages (they predate billing and scheduling).
