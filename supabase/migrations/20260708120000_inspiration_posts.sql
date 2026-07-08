-- Inspiration: the viral slideshow hall of fame. Same shape as
-- trending_posts, but a 12-month window ranked by raw views instead of a
-- 90-day momentum pool. Populated by scripts/ingest-inspiration.mjs
-- (clockworks search + ScrapTik author expansion + AI curation); covers are
-- cached into the trend-covers bucket at ingest. Public read, service-role
-- writes only.

create table if not exists public.inspiration_posts (
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
  why_it_works text,
  hook_type text,
  anatomy jsonb,
  raw jsonb,
  fetched_at timestamptz not null default now()
);

create index if not exists inspiration_posts_views_idx
  on public.inspiration_posts (views desc);
create index if not exists inspiration_posts_niche_idx
  on public.inspiration_posts (niche);

alter table public.inspiration_posts enable row level security;

drop policy if exists "inspiration_posts_read" on public.inspiration_posts;
create policy "inspiration_posts_read" on public.inspiration_posts
  for select to anon, authenticated using (true);
