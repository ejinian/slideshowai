@AGENTS.md

## Design Philosophy — Lovable-Style Hyper-Frictionless UI

The dashboard is modeled almost entirely on [Lovable.dev](https://lovable.dev)'s design language. When making any UI decision, ask: "Would this feel at home on Lovable?" If not, don't ship it.

**Core principles:**
- **Zero friction above all else.** Every extra click, modal, border, or label is a failure. Remove it.
- **Black background (#000000) everywhere.** Not dark-gray, not navy — pure black. Cards are `#1c1c1e` (iOS system background). No gradients on cards.
- **Full-page hero gradient** sits behind everything including the navbar — lives on the layout wrapper, not the page. Class: `bg-hero-glow` (blue/indigo/violet → pink via radial-gradients on pure black).
- **Transparent navbar** — no border, no backdrop-blur, no background. Just floats over the gradient.
- **Cards have no visible borders.** Use `bg-white/[0.02]` or `bg-[#1c1c1e]` for depth. `border border-white/[0.08]` max — almost invisible.
- **Custom dropdowns only** — never native OS `<select>`. Build with absolute-positioned panel, `useRef` + `mousedown` for click-outside. Panel: `bg-[#1a1a1c] rounded-xl border border-white/[0.08] shadow-2xl`.
- **Composer (2026-07-14, from the "Composer Redesign" Claude Design file, then simplified twice):** ONE seamless card with **no internal borders or boxes** — the textarea is flush/borderless (transparent, no inner box, no hairline dividers, no footer border), with the chat-style "Add photos" attachment strip directly under it (drag-drop works on the whole card; photos go to `/api/generate` as `userImages`, used for the first slides). Five pill dropdowns in the top settings row (Niche / Slides / Layout / Source / **Goal** — goal is appended to the model prompt). No numbered steps or section headers. Accent `Generate ↑` pill in the footer (keep `aria-label="Generate"` — e2e depends on it).
- **No emojis** in the UI. Ever. (Exception: image collection cards use emoji visually in their gradient tiles, not as text labels.)
- **Typography:** text-white at full opacity for primary, `text-white/50` for secondary, `text-white/30` for placeholder. No colored text except the accent.
- **Accent color:** `#6366f1` (indigo-500). Used sparingly — only for active states and the logo.
- **rounded-2xl** for cards, `rounded-xl` for panels, `rounded-full` for pills and avatar.
- **Try suggestions** (3 max, collapsed so they never truncate) change dynamically based on the selected image collection. Source: `NICHE_SUGGESTIONS` in `lib/generator-options.ts`.
- **Options above textarea** — Niche, Slides, Layout dropdowns sit in an options bar above the text input inside the same card. No separate section.

**What we explicitly removed:**
- Native `<select>` elements
- Any border/outline on the main form card
- The standalone "Generate Slideshow" button
- Emojis from labels and suggestions
- The navbar border/line
- `overflow-hidden` on the generator card (breaks dropdown panels)

## TikTok Content Posting API — LIVE (end-to-end working as of 2026-07-03)

Full flow works: OAuth connect → init → TikTok pulls proxied JPEGs → status poll → `PUBLISH_COMPLETE` → private post lands on the target user's profile. Posts persist to `tiktok_posts` and render in **My Posts** (`/dashboard/posts`).

**API:**
- Init: `POST .../v2/post/publish/content/init/` — `DIRECT_POST`, `media_type: PHOTO`, `source: PULL_FROM_URL` (no binary upload).
- OAuth: authorize `https://www.tiktok.com/v2/auth/authorize/`, exchange + refresh `.../v2/oauth/token/`. Scope `video.publish` (works for photos). Access token 24h; refresh token 365d rolling. Client key/secret never `NEXT_PUBLIC_`.
- Status: `POST .../v2/post/publish/status/fetch/` with `publish_id` → `PROCESSING_DOWNLOAD` | `PUBLISH_COMPLETE` | `FAILED`.
- **Token endpoint responses are FLAT** (top-level `access_token`/`refresh_token`/`open_id`; errors as `{error, error_description}` strings) for BOTH exchange AND refresh — NOT nested under `data`. (Content-posting endpoints DO nest under `data` with `{error:{code,message}}`.) Reading `.data` on token responses is the recurring bug — it hit both the callback and `getValidToken`.
- Rate limits: 6 init/min per user; max 5 pending posts / 24h.

**Hard-won gotchas (all resolved):**
- **Unaudited app ⇒ the TikTok *account* must be set to Private** (Settings → Privacy → Private account). Error `unaudited_client_can_only_post_to_private_accounts` is about the account's privacy setting, NOT the post's `privacy_level`. Also: all posts forced `SELF_ONLY` until TikTok audits the app.
- **PNG rejected** (JPEG/WebP only). Proxy `/api/tiktok/img/[id]/[pos]` downloads the slide from Storage and re-encodes to JPEG via Sharp. Auth = 2h HMAC token in the query string (`utils/tiktok.ts`).
- **Domain verification** is done via **URL prefix + signature file** (NOT DNS — no DNS control over ngrok/vercel subdomains). Signature file lives at `public/tiktok<token>.txt`, served at the domain root, verified in portal (Content Posting API → Direct Post → Verify domains → URL prefix). `*.supabase.co` can't be verified → hence the proxy.
- **ngrok free tier is incompatible.** Its browser-warning interstitial (ERR_NGROK_6024) is served to browser-UA fetchers, so TikTok gets HTML instead of the file/JPEG → domain-verify + photo-pull both fail. **We moved to Vercel** (no interstitial). Prod domain: `slideshowai-three.vercel.app`. See the deployment memory.
- **`photo_pull_failed`** was caused by an **invalid/truncated `SUPABASE_SECRET_KEY`** — the proxy's admin query failed and the route *masked it as 404 "Slide not found."* The route now surfaces admin/DB errors as 500. A valid `sb_secret_…` key is required for the proxy's admin client.
- **Sandbox app** (client key prefix `sbaw…`): only accounts added as **Target Users** in the sandbox can connect; unaudited ⇒ SELF_ONLY. Public visibility needs a production app + TikTok audit.
- **Test mode can't post** — the Generator's mock (`test-mock-id`) has no DB row and uses `data:` image URLs. Use Real mode (Source = Stock photos → real backgrounds from live Pexels / the library; caption text is cheap). Generate once, reuse for post tests.

**Files (all built):** `utils/tiktok.ts`; `app/api/auth/tiktok/route.ts` + `callback/route.ts` (popup OAuth); `app/api/tiktok/{post,status}/route.ts` + `img/[id]/[pos]/route.ts`; `components/dashboard/slideshows/TikTokPostButton.tsx` (modal portalled to `document.body`); `app/dashboard/posts/{page.tsx,[id]/page.tsx}` + `components/dashboard/posts/PostViewer.tsx` (My Posts).

**DB migrations** (run manually in Supabase SQL Editor, RLS owner-only): `tiktok_connections` (20260626130000) + `tiktok_posts` (20260703120000: slideshow_id, publish_id, caption, privacy_level, cover_index, status, fail_reason).

**Env vars:** `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET`, `NEXT_PUBLIC_APP_URL` (= prod Vercel domain), `SUPABASE_SECRET_KEY` (valid `sb_secret_…`, used by the proxy admin client).

## Slide rendering — text is NEVER baked into storage (on-demand compositing)

Captions are live data (`slides.caption` + `position_x/y`, `align`, `max_width`); stored images are the **text-free background only** (`{i}-bg.jpg`). Text is composited on demand — never saved into the image — so everything stays editable until post.

- **Shared renderer**: `lib/generate/renderSlide.ts` (`renderSlideJpeg`) = clean bg + DB text → JPEG. The ONLY place text gets baked.
- **Where it runs**: in-app display `app/api/slideshows/[id]/render/[pos]` (session-authed), the TikTok pull proxy `app/api/tiktok/img/[id]/[pos]` (HMAC), and the `.zip` download. Hub thumbnails / PostViewer / Generator filmstrip all point at the render endpoint.
- **Reposition is a pure DB write** (`app/api/slideshows/[id]/reposition`) — no Sharp, so caption stacking is structurally impossible. (The old bug: reposition re-baked onto the already-baked image because a `.replace(/\.png$/,'-bg.jpg')` regex no-op'd on `.jpg` paths.)
- **Fonts on Vercel**: sharp's librsvg **ignores embedded `@font-face` on Linux** (tofu glyphs, though fine on macOS). So text is rendered with **`@resvg/resvg-js`** (`fontFiles` = the caption TTFs in `assets/fonts/`), which is deterministic cross-platform. Requires `outputFileTracingIncludes: {"**": ["./assets/fonts/**/*"]}` + `serverExternalPackages: ["@resvg/resvg-js","sharp"]` in `next.config.ts`.
- **Caption font = TikTok Sans** (`TikTokSans-700/800.ttf` = Bold / ExtraBold static weights from TikTok's own display family — the exact classic caption font; Montserrat/Inter were only approximations). resvg matches `font-family: "TikTok Sans"` + `font-weight` 700/800 to the right file (the 800 file's RIBBI family is `TikTok Sans ExtraBold`, but its typographic family — name-table ID 16 — is `TikTok Sans`, which resvg honors). `lib/generate/fonts.ts` (`CAPTION_FAMILY`, `captionFontFiles`) feeds the resvg bake; the editor overlay (`CaptionLayer`) uses `var(--font-caption)` loaded via `next/font/local` in `app/layout.tsx` — same family both places = WYSIWYG.
- **No decorations, classic TikTok captions only (2026-07-10)** — the purple accent elements (title rule, CTA pill, number badge) were removed everywhere. Slides are white TikTok Sans text with a **black outline** and no scrim (the classic TikTok caption look, added 2026-07-17): the bake uses SVG `paint-order="stroke"` + `stroke-width ≈ 0.15·fontSize` (resvg honors paint-order, so the stroke sits behind the fill and letters keep their weight); the editor overlay mirrors it with `-webkit-text-stroke` + `paint-order: stroke`. The old radial scrim was removed from both — the outline does the legibility work. Numbered slides carry the number INLINE in the caption ("1. …", added by `layoutSlide` unless already numbered). Default caption `y` = **0.58** (upper-middle) so it clears TikTok's bottom UI chrome.
- Generation auto-saves slideshows (`status:'saved'`) — no manual "Save to library" button.
- **Background library**: ~355 Pexels photos per collection in the public `library` bucket + `library_images` table (migration 20260707140000; metadata `alt/query/source_w/source_h/avg_color` added by `20260714100000_library_image_meta.sql`). Ingest / top-up / backfill: `node scripts/ingest-library.mjs [--collections=a,b] [--backfill-meta]` (needs `PEXELS_API_KEY`; resumable, paced under Pexels' 200/hr). Only `ecommerce` is empty; every other collection has ~355 rows. **The library is now just the FALLBACK** for stock backgrounds — real image selection is the live Pexels pipeline in the generation section below. (`lib/generate/backgrounds.ts` random sampling was replaced by `imageSelection.ts`.)

## Slideshow generation — v2 (relevance-aware + trend-driven, 2026-07-16)

Two intake directions share one vision brain. Orchestrated in `app/api/generate/route.ts`.

**Copy** (`lib/generate/listicle.ts`, model `gpt-4o` — NOT gpt-4o-mini anymore):
- **The user's prompt is the TOPIC that drives the whole slideshow** (it used to be treated as a "product to plug on one slide" — that produced generic niche listicles for real topics). The product plug is now conditional (only if the topic names a product).
- **Trend-fed**: `lib/generate/trendExemplars.ts` reads the freshest high-velocity real hooks for the niche from `trending_posts` at runtime (niche-mapped by slug AND label — `Generator.tsx` sends the label; 5-min cache) and injects them as few-shot exemplars.
- **Voice is hard-constrained**: no exclamation marks, no Title Case, no clichés ("you're probably making", "game-changer"). Viral-anatomy system prompt (slide 1 = pattern-interrupt hook).
- **Explicit list count is honored**: `explicitListCount()` reads "3 exercises" → 5-slide deck, so the headline number never contradicts the topic.
- Structured JSON, validated + retried: title (numbered hook) → reasons → one optional plug → cta. `image_keywords` per slide feed image sourcing.

**Images — user uploads = the PRIMARY flow, image-first** (`lib/generate/imageFirst.ts`): one `gpt-4o` vision call SEES the uploads, writes captions grounded in them, orders the most scroll-stopping on the hook slide, and **EXCLUDES** unrelated/low-quality photos (route returns an `excludedPhotos` count). `photoIndex = -1` slides fall through to stock fill. Falls back to copy-first + positional on any vision failure.

**Images — stock, LIVE Pexels sourcing** (the caption-accurate path; used when there are no uploads):
1. `lib/generate/liveImages.ts` — searches **Pexels at runtime** with each slide's keywords, then a **strict `gpt-4o` vision judge** picks the result that genuinely depicts the caption or returns **-1** (specific subjects must be depicted; generic hooks/CTAs stay lenient). Pexels HAS the specific movements the frozen library lacked (verified: "incline dumbbell press", "bench press" return exact matches) — runtime search fixes the root cause for ANY topic. `-1` slides take the best Pexels result / a bundled local photo.
2. Falls back to the **frozen library** (`imageSelection.ts`: vision → LLM-text → keyword → random) only when `PEXELS_API_KEY` is absent.

**Requirements:** `PEXELS_API_KEY` must be set **in Vercel** (was local-only) for the live tier — without it, stock silently uses the old library.

**AI image generation was REMOVED (2026-07-17).** The `gpt-image-1` fallback (`lib/generate/aiImage.ts`), the "AI" Source option, and the `"auto"` background mode are all gone (MVP scope). The composer Source dropdown is now just **Upload** (default; the user's own photos, image-first) and **Stock photos** (live Pexels). Don't reintroduce AI-gen without asking.

## Billing — Stripe LIVE (multi-tier + credits)

`lib/billing/` — multi-tier subscriptions (Growth $19 / Scale $29 / Unlimited $79, fair-use ceiling) + one-time credit packs, on the `profiles` table (**service-role-write only** — entitlements must NOT live in `user_metadata`, which the browser can edit). Hard monthly-quota + per-user generate rate-limit enforcement in `/api/generate`. `app/api/stripe/{checkout,webhook,portal}`; `components/dashboard/BillingModal.tsx`. Env: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` (prod differs from the local `stripe listen` one), `STRIPE_PRICES` (one JSON blob mapping ids → Stripe price ids). Migrations `20260707180000_billing.sql` + `20260713190000_billing_tiers.sql` + `20260714120000_generation_rate_limit.sql`.

## Scheduling — external cron (NOT GitHub Actions)

Queue posts (`scheduled_posts`, migration `20260708130000`) → an **external cron (cron-job.org)** hits `POST/GET /api/cron/publish-scheduled?secret=$CRON_SECRET` every ~10 min → publishes due posts (optimistic `queued→publishing` claim, then `publishSlideshowToTikTok`). Requires a connected TikTok account to schedule. `CRON_SECRET` must match in Vercel + the cron service. **The GitHub Actions pinger was abandoned** — it stalled on forks and 401'd on a stale secret; the endpoint accepts GET so cron-job.org's default works.

## Merged UI work — Christian (2026-07-03)

Christian's `ui-changes` (from `Team-CE-26/slideshowai`) was merged into this fork's `main`. All frontend; coexists with the TikTok/render work. See the grow-suite memory. Highlights + config:
- **Landing overhaul** (`components/landing/*`), **Google auth + onboarding** (`components/auth/GoogleButton.tsx`, `components/onboarding/*`, `app/onboarding/*`, `app/auth/callback`), and the **Grow suite** — dashboard sections Trends / Inspiration / Collections / Schedule / Analytics (`app/dashboard/{trends,…}`, `components/dashboard/grow/*`, Sidebar `GROW_NAV`; analytics uses **recharts**).
- **Live trends** via **Apify** (`lib/trends.ts`, falls back to `lib/mock-data.ts`), daily cron `app/api/cron/refresh-trends` (`vercel.json`, `CRON_SECRET`). Ingest is a **two-provider hybrid**: keyword discovery via `clockworks~tiktok-scraper` (3 queries/niche, per-result $3.70/1k — the ONLY scraper whose search returns photo-mode posts; ScrapTik's search is video-only, verified 2026-07-06) + a 40-author watchlist scraped via `scraptik~tiktok-api` (`userPosts_userId`, flat $0.002/request; aweme_type 150 = photo post, converted to the clockworks item shape by `awemeToApifyItem`). ~$1.15/run + pennies. Then a **gpt-4o-mini curation pass** drops off-niche posts and writes each post's `why_it_works` (fails open if `OPENAI_API_KEY` absent). Covers are copied into the public `trend-covers` Storage bucket at ingest (TikTok CDN URLs expire in ~a day; the UI shows a niche-gradient placeholder for dead/missing covers). Feed is balanced per niche (top 24 each), not one global chart.
- **His features need config**: `APIFY_TOKEN` env (else mock trends), `PEXELS_API_KEY` (library ingest), **Google OAuth enabled in Supabase**, and run migrations `20260701220000_trending_posts.sql` + `20260706120000_trending_why.sql` + `20260706130000_trend_covers_bucket.sql` + `20260707120000_trend_insights.sql` + `20260707140000_library_images.sql`.

## Testing — headless E2E (Playwright), runs on every push

`npm run e2e` (also `git push` via `githooks/pre-push`, which **blocks the push on failure**; bypass with `git push --no-verify`). Zero OpenAI, no real TikTok posts.

- **Config** `playwright.config.ts`: headless chromium, single worker, `webServer` cold-starts `next dev` on **:3210**, loads `.env.local` via `@next/env`. A `setup` project (auth) that the main project depends on. `prepare` npm script auto-wires `git config core.hooksPath githooks` on `npm install`.
- **Auth** `e2e/auth.setup.ts`: provisions a reusable onboarded test user `e2e@slideshowai.test` + a fake `tiktok_connections` row via `SUPABASE_SECRET_KEY` (admin), logs in through the real form, saves `storageState`. Touches your Supabase (never OpenAI).
- **Spec** `e2e/generator.spec.ts`: drives all 4 option dropdowns (Niche/Slides/Layout/Source — cycle Source *last*, its "AI" option hides the carousel), the collection carousel, prompt → **mocks `/api/generate`** (fake slideshow) → asserts result → opens the Post-to-TikTok modal. Uses `toPass` retry to dodge the client-hydration race on first click.
- **Coverage is a shallow happy-path smoke test.** NOT covered: post-submit/polling/redirect, Send-to-drafts, the slide editor + render/resvg pipeline, the Slideshows hub / post viewer / disconnect / zip, and all of Christian's merge (onboarding, Grow, trends, Google auth).
- Fresh clones need `npx playwright install chromium` once (browser binary, not committed). The client **test-mode toggle was removed** (2026-07-06) — tests mock at the network layer instead.
