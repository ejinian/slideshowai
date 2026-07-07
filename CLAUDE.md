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
- **Circular send button** (Lovable-style): `h-9 w-9 rounded-full bg-white text-black` with an up-arrow SVG. No separate "Generate" button.
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
- **Test mode can't post** — the Generator's mock (`test-mock-id`) has no DB row and uses `data:` image URLs. Use Real mode (Source = Photos → library images; cheap, no AI image gen enabled — only caption text). Generate once, reuse for post tests.

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
- **Number badge is editor-only** — `CaptionLayer` draws it, but `compositeSlide` deliberately does NOT bake it (never in posted image / post viewer / thumbnails). Default caption `y` = **0.58** (upper-middle) so it clears TikTok's bottom UI chrome.
- Generation auto-saves slideshows (`status:'saved'`) — no manual "Save to library" button.
- **Background library is LIVE (2026-07-07)**: ~350 Pexels photos per collection (9 collections, all 1080x1920 JPEG, attention-cropped) in the public `library` Storage bucket + `library_images` table (migration 20260707140000; provenance columns for licensing). Ingest/top-up: `node scripts/ingest-library.mjs [--per-niche=N] [--collections=a,b]` (needs `PEXELS_API_KEY`; resumable, paced under Pexels' 200 req/hr). Generation samples random backgrounds per selected collection via `lib/generate/backgrounds.ts`, falling back to the bundled `public/library/gym/` set (19 photos) only when a collection has no rows. Target is 1000/niche once Supabase Pro is confirmed (free tier storage cap is 1GB).

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
