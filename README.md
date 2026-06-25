# SlideShowAI

Auto-generates ready-to-post **TikTok Photo Mode slideshows** for businesses to
promote their products. A user picks their niche, the app pulls images from a
library, the Claude API writes captions, the captions are composited onto images
as styled vertical (9:16) slides, and the user downloads them to post.

## Stack

- **Next.js** (App Router) + **TypeScript** + **Tailwind CSS v4**
- **Supabase** — auth, Postgres, storage _(later milestone)_
- **Anthropic API** — caption generation _(later milestone)_
- **Sharp** — image compositing _(later milestone)_
- Deploy target: **Vercel**

## Getting started

```bash
npm install
cp .env.local.example .env.local   # then fill in the Supabase values (see below)
npm run dev          # http://localhost:3000
npm run build        # production build
npm run lint
```

### Environment variables

`.env.local` (gitignored) holds the Supabase connection, copied from the
project's Connect dialog → Framework (Next.js):

```
NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
```

## Project structure

```
app/                       Next.js App Router (layout, page, globals.css)
components/
  landing/                 Landing-page sections (Hero, NicheDemo, etc.)
  ui/                      Shared primitives (Button)
lib/
  demo-data.ts             Hardcoded niche → sample slides for the demo
utils/supabase/
  client.ts                Browser Supabase client (Client Components)
  server.ts                Server Supabase client (RSC / Route Handlers / Actions)
  session.ts               updateSession() — refreshes auth cookies + route guards
proxy.ts                   Next.js 16 proxy (formerly middleware) — runs updateSession
app/login, app/signup      Auth pages + server actions (login/signup/signout)
app/auth/confirm           Email-confirmation route handler
app/dashboard              Generator UI — app shell (sidebar) + step-based create flow
components/dashboard/      Sidebar + Generator (UI/UX only, not wired to a backend)
lib/generator-options.ts   Static options for the generator
lib/generate/listicle.ts   OpenAI (gpt-4o-mini) listicle copy (structured output)
lib/generate/composite.ts  Sharp: caption → 9:16 PNG over a gradient scrim
app/api/generate           Route handler: captions + compositing → slides
supabase/migrations/       SQL migrations (run these in the Supabase SQL Editor)
public/demo/               Placeholder 9:16 slide images (generated)
scripts/
  gen-placeholders.mjs     Regenerates the placeholder images
```

Run `node scripts/gen-placeholders.mjs` to regenerate the demo placeholder images.

## Milestones

- [x] **M1 — Scaffold + landing page** (current): static landing page with a
      working client-side niche-switcher demo. No backend.
- [ ] M2 — Auth + Supabase data layer
- [ ] M3 — Niche → image library
- [ ] M4 — Caption generation (Anthropic API)
- [ ] M5 — Compositing pipeline (Sharp, 9:16 slides)
- [ ] M6 — Download / export
- [ ] M7 — Push to TikTok drafts (Content Posting API)

## Design

Dark theme, generous whitespace, single accent color (indigo — `#4f46e5` fills /
`#818cf8` text on dark), Inter font, rounded corners, mobile-responsive. Colors
are centralized as design tokens in `app/globals.css`.
# slideshowai
