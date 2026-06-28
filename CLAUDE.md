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

## TikTok Content Posting API

Endpoint: `POST https://open.tiktokapis.com/v2/post/publish/content/init/`
Mode: `DIRECT_POST`, `media_type: PHOTO`, `source: PULL_FROM_URL` (TikTok pulls images from URLs — no binary upload).
Scope: `video.publish` (despite the name, works for photos).
OAuth: standard OAuth 2.0. Authorize at `https://www.tiktok.com/v2/auth/authorize/`, exchange at `https://open.tiktokapis.com/v2/oauth/token/`. Access token: 24h. Refresh token: 365 days rolling. Client key + secret (never `NEXT_PUBLIC_`).
Status polling: `POST https://open.tiktokapis.com/v2/post/publish/status/fetch/` with `publish_id`. Statuses: `PROCESSING_DOWNLOAD`, `PUBLISH_COMPLETE`, `FAILED`.

**Critical constraints:**
- TikTok only accepts JPEG/WebP — PNG is rejected (`file_format_check_failed`). Our slides are PNGs; convert via the image proxy.
- TikTok requires domain ownership verification. Supabase's `*.supabase.co` domain cannot be verified. Solution: proxy slides through our Vercel domain (`/api/tiktok/img/[id]/[pos]`) and verify that domain in the TikTok developer portal.
- URLs must stay alive for ~1 hour after the init call (the proxy handles this naturally).
- Until TikTok audits the app, all posts are forced `SELF_ONLY` regardless of requested privacy.
- Rate limit: 6 init calls/min per user token. Max 5 pending posts per user per 24h.

**Implementation pieces (not yet built):**
1. `/api/tiktok/img/[id]/[pos]` — proxy: downloads PNG from Supabase Storage, serves as JPEG via Sharp
2. `/api/auth/tiktok` + `/api/auth/tiktok/callback` — OAuth flow, stores tokens in `tiktok_connections` table
3. `/api/tiktok/post` — calls init endpoint with proxy URLs, returns `publish_id`
4. `/api/tiktok/status` — polls TikTok status, returns to client
5. DB migration: `tiktok_connections` table (open_id, access_token, refresh_token, expires_at) per user
6. UI: "Post to TikTok" in SlideshowDetail — TikTok connect gate → caption/privacy modal → post → poll status
7. Env vars needed: `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET`
