# SlideShowAI

Generates ready-to-post **TikTok Photo Mode slideshows** for small businesses. You
type a topic (or upload your own photos, or just let the AI decide); the app
detects the niche, writes scroll-stopping captions modeled on what's trending,
finds a matching image for every slide, composites them into vertical 9:16
slides, and either lets you download them or **posts them straight to TikTok** —
immediately or on a schedule.

Live at **https://slideshowai-three.vercel.app**.

## Stack

- **Next.js 16** (App Router, Turbopack) + **TypeScript** + **Tailwind CSS v4**
- **Supabase** — auth (email + Google), Postgres, Storage
- **OpenAI** — `gpt-4o` (captions + vision image matching)
- **Pexels** — licensed stock photos (library ingest + live runtime search)
- **Sharp** + **@resvg/resvg-js** — on-demand slide compositing (TikTok Sans)
- **Stripe** — subscriptions + one-time credits
- **Apify** — live TikTok trend scraping (Grow suite)
- Deployed on **Vercel**

## How generation works

Two intake paths share one "vision brain" — see `lib/generate/` and
`app/api/generate/route.ts`:

1. **Copy** (`listicle.ts`, `gpt-4o`): your prompt is the *topic* that drives the
   whole slideshow. The model is fed the freshest real trending hooks for the
   niche (`trendExemplars.ts` reads the `trending_posts` table at runtime) and a
   viral-anatomy system prompt (slide 1 = pattern-interrupt hook; no exclamation
   marks / brand voice). Structured JSON: title → reasons → optional native plug → CTA.
2. **Images** — one of three, depending on source:
   - **Your uploads** (`imageFirst.ts`) — the primary flow. A `gpt-4o` vision call
     *sees* your photos, writes captions grounded in them, orders the strongest on
     the hook slide, and **excludes** ones that don't fit.
   - **Stock** (`liveImages.ts`) — search Pexels at runtime with each slide's
     keywords, and a strict vision judge picks the photo that genuinely depicts
     the caption (misses fall back to the best available result).
   - **Frozen library** (`imageSelection.ts`) — the fallback when `PEXELS_API_KEY`
     is absent: a vision → keyword → random ladder over the `library_images` table.
3. **Compositing** (`renderSlide.ts`) — captions are **never baked into storage**;
   only the text-free background (`{i}-bg.jpg`) is stored. Text is composited
   on-demand at display/download/post via `/api/slideshows/[id]/render/[pos]`, so
   everything stays editable (drag-to-reposition is a pure DB write).

## Features

- **Post to TikTok** — full Content Posting API flow (`DIRECT_POST`, pull-from-URL).
  Posts are private (`SELF_ONLY`) until TikTok audits the app. See **My Posts**.
- **Scheduling** — queue posts (`scheduled_posts`); an external cron hits
  `/api/cron/publish-scheduled` every ~10 min to publish due posts. Requires a
  connected TikTok account.
- **Billing** — Stripe multi-tier subscriptions (Growth / Scale / Unlimited) +
  one-time credit packs, with hard monthly-quota and rate-limit enforcement.
- **Grow suite** — Trends (live via Apify), Inspiration, Collections, Schedule,
  and Analytics dashboard sections.

## Getting started

```bash
npm install
cp .env.local.example .env.local   # fill in the values (see below)
npm run dev          # http://localhost:3000
npm run build        # production build
npm run lint
npm run e2e          # headless Playwright smoke test
```

Migrations in `supabase/migrations/` are **run manually** in the Supabase SQL
Editor (not applied by deploy). Run them in filename order on a fresh project.

### Environment variables

Server-only keys must **never** be prefixed `NEXT_PUBLIC_`. See `.env.local.example`.

| Variable | Purpose |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Supabase (browser) |
| `SUPABASE_SECRET_KEY` | Supabase admin (`sb_secret_…`) — service-role writes, image proxy |
| `OPENAI_API_KEY` | Captions + vision image matching |
| `PEXELS_API_KEY` | Stock library ingest **and** live runtime image search |
| `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET` | TikTok Content Posting API |
| `NEXT_PUBLIC_APP_URL` | Prod domain — OAuth redirects + image proxy URLs |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICES` | Billing (`STRIPE_PRICES` = one JSON blob mapping plan/credit ids → Stripe price ids) |
| `APIFY_TOKEN` | Live TikTok trends (falls back to mock data if absent) |
| `CRON_SECRET` | Shared secret guarding the `/api/cron/*` endpoints |

## Project structure

```
app/
  api/generate/            The generation pipeline (copy → images → composite)
  api/slideshows/[id]/     render/[pos], reposition, zip download
  api/tiktok/, api/auth/tiktok/   TikTok OAuth + posting + image proxy
  api/schedule/, api/cron/ Scheduled posting queue + publisher
  api/stripe/              Checkout, webhook, customer portal
  dashboard/               Generator + Grow suite (trends/inspiration/schedule/…)
lib/generate/
  listicle.ts              gpt-4o caption copy (topic-driven, trend-fed)
  trendExemplars.ts        Feeds real trending hooks into the copy prompt
  imageFirst.ts            Image-first vision pipeline for user uploads
  liveImages.ts            Live Pexels search + strict vision judge (stock)
  imageSelection.ts        Frozen-library matcher (fallback)
  renderSlide.ts, layout.ts, composite.ts, fonts.ts   On-demand compositing
lib/trends.ts              Apify trend ingest + gpt-4o-mini curation
lib/billing/               Plans, usage/quota, Stripe helpers
utils/supabase/            client / server / admin Supabase clients
supabase/migrations/       SQL migrations (run manually in the SQL Editor)
scripts/ingest-library.mjs Pexels library ingest / metadata backfill
e2e/                       Playwright specs (pre-push gate)
```

## Testing

`npm run e2e` runs a headless Playwright smoke test; `githooks/pre-push` runs it
on every `git push` and **blocks the push on failure** (bypass:
`git push --no-verify`). It mocks `/api/generate` and TikTok — **zero OpenAI
spend, no real posts**. Fresh clones need `npx playwright install chromium` once.

## Design

Modeled on [Lovable.dev](https://lovable.dev): pure-black (`#000`) background,
full-page hero gradient, transparent navbar, custom (never native) dropdowns,
indigo accent (`#6366f1`), no emojis in the UI. See `CLAUDE.md` for the full
design system and engineering notes.
