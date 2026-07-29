-- Caption contrast plate
--
-- White caption text sitting on a bright background (a white app screenshot, a
-- blown-out highlight) is unreadable even with the black glyph stroke. At
-- generation time we measure the contrast of white against the background
-- INSIDE the caption's own box (lib/generate/contrast.ts) and record the
-- verdict here.
--
-- The decision is stored rather than recomputed, so the SVG bake and the HTML
-- drag editor cannot disagree about whether a plate is drawn — the same rule as
-- position_x/position_y. The user can then flip it per slide in the editor.

-- Per slide: does this slide's caption need a plate behind it? Seeded from the
-- contrast measurement at generation, then owned by the user.
alter table public.slides
  add column if not exists text_bg boolean not null default false;

comment on column public.slides.text_bg is
  'Draw a black plate behind this slide''s caption. Seeded by the contrast measurement at generation (lib/generate/contrast.ts), then user-editable per slide.';

-- NOTE: this migration originally also added slideshows.text_bg_mode, a
-- deck-wide auto/on/off override. That was the wrong shape — legibility is a
-- property of one photo, not of a deck — so the control became a per-slide
-- toggle and the column was dropped. It is deliberately not recreated here.
