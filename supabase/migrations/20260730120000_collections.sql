-- Image collections: the user's own reusable photo library.
--
-- Replaces the throwaway per-generation attach. Previously the composer sent
-- photos to /api/generate as base64 data URLs INSIDE the request body, which
-- forced a 10-photo cap, browser downscaling, and still hit Vercel's ~4.5MB
-- body limit. Collection images live in Storage, so generation sends ids and
-- the server reads the bytes — no cap, no body limit.
--
-- Owner-only RLS on both tables (same convention as scheduled_posts), and a
-- PRIVATE bucket keyed by user id (same convention as the slideshows bucket).
-- Run this in the Supabase SQL Editor. Self-contained and idempotent (safe to
-- re-run).

-- updated_at helper. Re-created here for the same reason the slideshows
-- migration does it: this project never had init_profiles applied, so the
-- function can't be assumed to exist. create-or-replace is safe either way.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.collections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null default 'Untitled collection',
  -- When true these are product shots, which the generator may place on a
  -- specific slide rather than using as a general backdrop.
  is_product_images boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.collection_images (
  id uuid primary key default gen_random_uuid(),
  collection_id uuid not null
    references public.collections(id) on delete cascade,
  -- Denormalized so RLS and the storage-path prefix can be checked without a
  -- join, and so a delete can find the object without loading the parent.
  user_id uuid not null references auth.users(id) on delete cascade,
  -- `${userId}/${collectionId}/${uuid}.jpg` in the `collections` bucket.
  storage_path text not null unique,
  name text not null default '',
  width integer,
  height integer,
  -- Manual ordering; generation uses the user's chosen order.
  position integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists collections_user_idx
  on public.collections (user_id, updated_at desc);
create index if not exists collection_images_collection_idx
  on public.collection_images (collection_id, position, created_at);

alter table public.collections enable row level security;
alter table public.collection_images enable row level security;

drop policy if exists "collections_own" on public.collections;
create policy "collections_own" on public.collections
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "collection_images_own" on public.collection_images;
create policy "collection_images_own" on public.collection_images
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Keep updated_at current so the grid can sort by "recently changed".
drop trigger if exists collections_set_updated_at on public.collections;
create trigger collections_set_updated_at
  before update on public.collections
  for each row execute function public.set_updated_at();

-- ============================================================ storage bucket
-- Private: these are the user's own photos, served via signed URLs.
insert into storage.buckets (id, name, public)
values ('collections', 'collections', false)
on conflict (id) do nothing;

-- Owner-only by first path segment: `${userId}/${collectionId}/${uuid}.jpg`.
-- The browser uploads straight here with the user's session — a Next route
-- body could not carry a bulk drop of 50 photos.
drop policy if exists "Collection objects readable by owner" on storage.objects;
create policy "Collection objects readable by owner" on storage.objects
  for select using (
    bucket_id = 'collections' and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "Collection objects insertable by owner" on storage.objects;
create policy "Collection objects insertable by owner" on storage.objects
  for insert with check (
    bucket_id = 'collections' and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "Collection objects updatable by owner" on storage.objects;
create policy "Collection objects updatable by owner" on storage.objects
  for update using (
    bucket_id = 'collections' and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "Collection objects deletable by owner" on storage.objects;
create policy "Collection objects deletable by owner" on storage.objects
  for delete using (
    bucket_id = 'collections' and (storage.foldername(name))[1] = (select auth.uid())::text
  );
