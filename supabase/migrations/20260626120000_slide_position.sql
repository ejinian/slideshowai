-- Per-slide caption position, as NORMALIZED coordinates (fractions 0..1) so a
-- drag in the browser maps exactly onto the 1080x1920 PNG export.
-- Run in the Supabase SQL Editor. Idempotent (safe to re-run).
--
--   position_x / position_y : anchor point. x meaning depends on `align`
--                             (left edge / center / right edge); y is the
--                             vertical CENTER of the text block.
--   align                   : horizontal text anchor.
--   max_width               : optional 0..1 fraction of slide width the text may
--                             fill before wrapping (NULL = role default).
--
-- Defaults reproduce the previous hardcoded look (bottom-centered).

alter table public.slides
  add column if not exists position_x double precision not null default 0.5,
  add column if not exists position_y double precision not null default 0.82,
  add column if not exists align text not null default 'center',
  add column if not exists max_width double precision;

-- Constrain align to the supported anchors (guarded so re-runs don't error).
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'slides_align_check'
  ) then
    alter table public.slides
      add constraint slides_align_check check (align in ('left', 'center', 'right'));
  end if;
end$$;
