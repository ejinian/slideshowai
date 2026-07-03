-- Per-user record of a slideshow posted to TikTok.
-- Run in the Supabase SQL Editor after 20260626130000_tiktok_connections.sql.
-- Idempotent (safe to re-run). Relies on set_updated_at() from the slideshows migration.

create table if not exists public.tiktok_posts (
  id            uuid        primary key default gen_random_uuid(),
  user_id       uuid        not null references auth.users (id) on delete cascade,
  slideshow_id  uuid        not null references public.slideshows (id) on delete cascade,
  publish_id    text        not null,
  caption       text        not null default '',
  privacy_level text        not null default 'SELF_ONLY',
  cover_index   int         not null default 0,
  -- Mirrors TikTok status/fetch: PROCESSING_DOWNLOAD | PUBLISH_COMPLETE | FAILED
  status        text        not null default 'PROCESSING_DOWNLOAD',
  fail_reason   text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (publish_id)
);

create index if not exists tiktok_posts_user_idx
  on public.tiktok_posts (user_id, created_at desc);
create index if not exists tiktok_posts_publish_idx
  on public.tiktok_posts (publish_id);

alter table public.tiktok_posts enable row level security;

drop policy if exists "TikTok posts selectable by owner" on public.tiktok_posts;
create policy "TikTok posts selectable by owner" on public.tiktok_posts
  for select using ((select auth.uid()) = user_id);

drop policy if exists "TikTok posts insertable by owner" on public.tiktok_posts;
create policy "TikTok posts insertable by owner" on public.tiktok_posts
  for insert with check ((select auth.uid()) = user_id);

drop policy if exists "TikTok posts updatable by owner" on public.tiktok_posts;
create policy "TikTok posts updatable by owner" on public.tiktok_posts
  for update using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "TikTok posts deletable by owner" on public.tiktok_posts;
create policy "TikTok posts deletable by owner" on public.tiktok_posts
  for delete using ((select auth.uid()) = user_id);

drop trigger if exists tiktok_posts_set_updated_at on public.tiktok_posts;
create trigger tiktok_posts_set_updated_at
  before update on public.tiktok_posts
  for each row execute function public.set_updated_at();
