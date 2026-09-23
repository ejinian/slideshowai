-- Autopilot, fully automatic mode (2026-09-23, Christian: "fully automatic,
-- where I could set how many posts a day I want, with examples of hooks or
-- the general idea of what I want"). Adds the brief the topics are invented
-- from, the daily budget, the reviewer threshold that gates auto-posting, and
-- the timestamp the spacing is measured from. Existing plans keep working:
-- auto_post defaults off, so nothing posts by itself until it is switched on.
alter table public.autopilot_plans
  add column if not exists auto_post      boolean not null default false,
  add column if not exists posts_per_day  integer not null default 1,
  add column if not exists min_score      integer not null default 7,
  add column if not exists brief          text not null default '',
  add column if not exists last_posted_at timestamptz;
