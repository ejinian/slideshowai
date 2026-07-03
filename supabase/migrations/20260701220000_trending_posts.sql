-- Trending TikTok slideshows cache. Populated by /api/cron/refresh-trends
-- (service role), read by the Trends page. Public trend data: readable by
-- everyone, writable only via the service role (which bypasses RLS).

create table if not exists public.trending_posts (
  id text primary key,                       -- TikTok item id
  niche text not null,
  title text not null default '',
  author text not null default '',
  cover_url text,
  slide_count integer not null default 0,
  views bigint not null default 0,
  views_per_hour bigint not null default 0,
  likes bigint not null default 0,
  posted_at timestamptz not null,
  tiktok_url text not null default '',
  raw jsonb,
  fetched_at timestamptz not null default now()
);

create index if not exists trending_posts_posted_at_idx
  on public.trending_posts (posted_at desc);
create index if not exists trending_posts_velocity_idx
  on public.trending_posts (views_per_hour desc);

alter table public.trending_posts enable row level security;

drop policy if exists "trending_posts_read" on public.trending_posts;
create policy "trending_posts_read" on public.trending_posts
  for select to anon, authenticated using (true);
