-- Multi-account TikTok: a user can connect several TikTok accounts and choose
-- which one a post goes to. Connecting a SECOND account is gated to the Scale
-- plan in the OAuth callback (the tier is sold as "for agencies &
-- multi-account"); the first account stays free.
-- Run manually in the Supabase SQL Editor. Idempotent.

-- One row per (user, TikTok account) instead of one per user.
alter table public.tiktok_connections
  drop constraint if exists tiktok_connections_user_id_key;

alter table public.tiktok_connections
  add column if not exists display_name text,
  add column if not exists avatar_url   text,
  add column if not exists is_default   boolean not null default false;

create unique index if not exists tiktok_connections_user_open_idx
  on public.tiktok_connections (user_id, open_id);

-- Every existing connection becomes its user's default (each user has at most
-- one row before this migration). MUST run before the partial unique index.
update public.tiktok_connections set is_default = true where not is_default;

-- Exactly one default per user.
create unique index if not exists tiktok_connections_default_idx
  on public.tiktok_connections (user_id) where is_default;

-- Which TikTok account a post went to. open_id (not connection id) because it
-- outlives a disconnect — the post row keeps meaning something.
alter table public.tiktok_posts
  add column if not exists open_id text;
update public.tiktok_posts p
  set open_id = c.open_id
  from public.tiktok_connections c
  where c.user_id = p.user_id and p.open_id is null;

-- Which account a queued post should publish to. Null (or a deleted
-- connection) falls back to the user's default at publish time.
alter table public.scheduled_posts
  add column if not exists connection_id uuid references public.tiktok_connections (id) on delete set null;

comment on column public.tiktok_connections.is_default is
  'The account used when no explicit choice is made (analytics, legacy callers). Exactly one per user via the partial unique index.';
