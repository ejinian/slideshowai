-- Manual caption size control
--
-- Caption size was derived entirely from the slide's role plus the shrink-to-fit
-- pass, with no way for a user to nudge it. This multiplier feeds layoutSlide()
-- BEFORE wrapping, so changing it re-wraps the text properly rather than just
-- scaling already-wrapped lines past their intended width.
--
-- 1.0 = the generated default. Clamped to [0.6, 1.6] in the layout module and
-- again in the API route.

alter table public.slides
  add column if not exists font_scale real not null default 1.0;

comment on column public.slides.font_scale is
  'User multiplier on the caption font size. 1.0 = as generated. Applied before wrapping in lib/generate/layout.ts.';
