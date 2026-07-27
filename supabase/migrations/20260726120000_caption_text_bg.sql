-- Caption contrast plate
--
-- White caption text sitting on a bright background (a white app screenshot, a
-- sunlit curtain, a notebook page) is unreadable even with the black glyph
-- stroke. At generation time we now measure the WCAG contrast ratio of white
-- against the mean colour of the background INSIDE the caption's own box
-- (lib/generate/contrast.ts) and record the verdict here.
--
-- The decision is stored rather than recomputed, so the SVG bake and the HTML
-- drag editor cannot disagree about whether a plate is drawn — the same rule as
-- position_x/position_y.

-- Per slide: did this slide's background fail the contrast floor at generation?
alter table public.slides
  add column if not exists text_bg boolean not null default false;

-- Per slideshow: how to apply that verdict.
--   'auto' (default) — honour each slide's measured text_bg
--   'on'             — force the plate on every slide
--   'off'            — never draw a plate
alter table public.slideshows
  add column if not exists text_bg_mode text not null default 'auto';

alter table public.slideshows
  drop constraint if exists slideshows_text_bg_mode_check;

alter table public.slideshows
  add constraint slideshows_text_bg_mode_check
  check (text_bg_mode in ('auto', 'on', 'off'));

comment on column public.slides.text_bg is
  'Measured at generation: white caption text failed the contrast floor against this background, so it needs a plate. Applied per slideshows.text_bg_mode.';
comment on column public.slideshows.text_bg_mode is
  'auto = per-slide measurement, on = plate everywhere, off = never.';
