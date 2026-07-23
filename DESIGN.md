# Landing page design spec — "Content-Forward"

Locked 2026-07-22 after the "looks too AI" complaints. Every landing change either
conforms to this file or updates it deliberately. Scope: `components/landing/*` and
the `/` page only — the dashboard keeps its own Lovable-style language (CLAUDE.md).

## Direction

The product's output — real photos with TikTok Sans captions — supplies ALL of the
page's color and energy. The chrome around it is monochrome, typographic, and calm.
If a decorative element competes with a slide for attention, delete the element.

## Palette (chrome)

- Background: pure black `#000000`.
- Text ladder: `text-white` primary / `text-white/60` secondary / `text-white/35` tertiary.
- Hairlines: `ring-white/10` or `border-white/10`, only when a bg shift isn't enough.
- **Brand indigo `#6366f1` is the ONE CTA color** (user decision 2026-07-22, matching
  the logo tile): buttons, the "Most popular" badge, the composer ↑ — nothing else.
  Three static color washes: `.bg-landing-glow` (blue/violet/pink, hero),
  `.bg-landing-glow-mid` (violet, gallery), `.bg-landing-glow-b` (indigo, closer),
  all with the slow `animate-glow-breathe` opacity drift. The `tt-red`/`tt-cyan`
  tokens exist but are currently unused. No orbs, no accent-colored body text.
- **Motion:** hero composer typing + phones (product; the mini phones drift on
  float-a/b), one-shot `Reveal` rises per section with staggered children
  (~90-110ms steps), hover lifts on gallery tiles/pricing cards, CTA hover scale
  + periodic `btn-shine` sweep, breathing glows, and the animated gradient on
  exactly two headline phrases ("Go viral" / "one sentence away"). That's the
  budget — nothing else moves.
- **Color rhythm:** gradient `AccentBar` under every section h2; bold lead phrases
  in `text-accent-text`; CTAs are the indigo→fuchsia gradient.

## Type

- Display (h1/h2): **TikTok Sans 700/800** via `font-tiktok` (`--font-caption`) — the
  product's own caption font doubles as the brand voice.
- Body/UI: Inter (fine at body sizes; the "AI tell" is Inter display headlines).
- Sentence case everywhere. No all-caps eyebrows, no letter-spaced micro-labels,
  no gradient text, no serif-italic accent words.

## Surfaces & depth

The page is layered, not flat (added 2026-07-22 — pure type-on-hairlines read
"like a menu"). The kit, all in globals:

- `.card-depth` — THE elevated surface: gradient fill, indigo-tinted 1px border
  (`rgba(129,140,248,0.18)`), inner top highlight, soft drop shadow. Problem
  beats, steps, pricing cards, the closer panel.
- `.section-band` — indigo-tinted band (`rgba(99,102,241,0.06→0.02)`) under
  HowItWorks and Pricing, framed by `.seam` indigo gradient hairlines. This is
  deliberate visible contrast against the black rooms (2026-07-22: white-alpha
  alone was imperceptible).
- FUD lines render as outlined chips (`border-white/15`), not plain text.
- **Each room has ONE hue** (2026-07-22, "contrast between sections"): a single
  drifting `.glow-blob` per section — Problem sky, HowItWorks indigo, Why
  fuchsia, Gallery violet, Pricing indigo, FAQ faint sky — plus the hero and
  closer glows. One blob per room max; alphas ≤ 10%. The `.accent-bar` under
  each h2 grows in on reveal (scroll-triggered, reduced-motion shows it static).
- `.bg-noise` at ~5% — film grain over the hero glow and closer panel so large
  dark areas aren't flat vector black.
- Light pools: a soft accent blur behind featured phones (WhySlideshows).
- Gallery tiles carry `shadow-black/50`.

Still banned: glassmorphism/backdrop-blur on page chrome, colored box-shadows
except the CTA's own `shadow-accent`.

## Motion budget

**Ambient motion must be the product.** The hero gets exactly two, telling one
story: the composer typing prompts to itself (input) and the phone auto-advancing
(output). Everything below the fold is still. One-shot entrance rises are fine.
Banned: floating orbs, ping dots, shine sweeps, conic-gradient rims, gradient pans,
dot grids. (In-product UI shown *inside* a mockup — TikTok chrome, progress bars —
is content, not page decoration, and is exempt.)

## Copy voice

Specific beats hype. Banned: "go viral", "scroll-stopping", "game-changer",
"AI-powered" as a badge. Concrete nouns and numbers win. The prompt is a topic,
not a product plug — copy must match the current generator (no niche picker).

## Page structure (Lovable-style pivot, late 2026-07-22 — user direction)

Header (logo + nav as one LEFT cluster, "Log in" + white "Get started" right)
→ Hero: full-height room, nothing but "Build a slideshow you love", one
subline, and `LandingComposer` — a faithful click-through replica of the
dashboard composer (same card surface/pills/caret/accent ↑) typing prompts to
itself over `.bg-lovable-hero` (cool corners, warm sunrise bloom — the Lovable
scene). No CTA button in the hero; the composer IS the CTA.
→ Gallery as a community-style showcase ("Made with SlideShowAI": filter
pills + thumbnail cards with title bars and Remix affordance, all → /dashboard)
→ HowItWorks → WhySlideshows → Pricing → FAQ → FinalCTA → Footer.
Problem (PAS) section deleted in this pivot. PhoneSlideshow and lib/demo-data
survive — onboarding + HowItWorks/WhySlideshows still use them.

The hero composer is a *stand-in*, not a working form — one click anywhere on it
opens `/dashboard`. Keep it visually in sync with the real composer's language
(flush text, "Add photos", circular ↑ submit).
