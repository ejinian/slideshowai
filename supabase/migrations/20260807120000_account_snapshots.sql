-- Point-in-time TikTok account stats, so growth can be charted.
--
-- TikTok's /v2/user/info/ only ever returns CURRENT values — there is no
-- historical endpoint on the Display API, and per-post engagement isn't
-- available to us at all (it lives in the Research API, restricted to vetted
-- researchers). So the only way to show a follower trend is to record what we
-- see, when we see it, and accumulate.
--
-- Rows are written at most once an hour per user (see lib/analytics/accountStats.ts),
-- on analytics page visits. That means the series is sparse and irregular —
-- gaps are real and the chart must not pretend otherwise.

create table if not exists public.account_snapshots (
  id              uuid        primary key default gen_random_uuid(),
  user_id         uuid        not null references auth.users (id) on delete cascade,
  captured_at     timestamptz not null default now(),
  follower_count  bigint,
  following_count bigint,
  likes_count     bigint,
  video_count     bigint
);

-- The only read pattern: this user's snapshots, newest first.
create index if not exists account_snapshots_user_time_idx
  on public.account_snapshots (user_id, captured_at desc);

alter table public.account_snapshots enable row level security;

-- Owner-only, matching every other user-scoped table here. Writes go through
-- the session client, so the same policy covers the hourly insert.
drop policy if exists "account_snapshots owner read" on public.account_snapshots;
create policy "account_snapshots owner read"
  on public.account_snapshots for select
  using (auth.uid() = user_id);

drop policy if exists "account_snapshots owner insert" on public.account_snapshots;
create policy "account_snapshots owner insert"
  on public.account_snapshots for insert
  with check (auth.uid() = user_id);

comment on table public.account_snapshots is
  'Hourly-at-most captures of TikTok account stats (user.info.stats scope). Exists because TikTok exposes only current values, so history has to be accumulated locally.';
