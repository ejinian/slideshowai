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

## Surfaces

Borderless-first, in this order: whitespace → background shift (`bg-white/[0.02]`) →
hairline ring. `rounded-2xl` cards, `rounded-full` pills. No glassmorphism, no glow
or colored box-shadows.

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

## Page structure (locked with the 2026-07-22 overhaul)

Header → Hero (headline + click-through composer left, PhoneSlideshow right —
the page's ambient motion) → HowItWorks (three type-only steps on hairlines) →
FAQ (hairline accordion + JSON-LD + guide links) → FinalCTA (type + white pill)
→ Footer. Deleted: NicheDemo, SlidePreview, Eyebrow, Reveal, SlideMarquee
(the user preferred the single phone over the slide strip, 2026-07-22).
PhoneSlideshow and lib/demo-data are shared with the onboarding wizard — keep.

The hero composer is a *stand-in*, not a working form — one click anywhere on it
opens `/dashboard`. Keep it visually in sync with the real composer's language
(flush text, "Add photos", circular ↑ submit).
