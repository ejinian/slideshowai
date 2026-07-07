-- Background image library: one row per stock photo, stored in the public
-- `library` Storage bucket (created via the Storage API) under
-- {collection}/{source_id}.jpg. Populated by scripts/ingest-library.mjs
-- (Pexels API). Public read; writes via the service role only.

create table if not exists public.library_images (
  id bigint generated always as identity primary key,
  collection text not null,              -- generator collection id: gym, food, …
  path text not null,                    -- bucket path: {collection}/{source_id}.jpg
  url text not null,                     -- public URL (denormalized for speed)
  width integer not null default 1080,
  height integer not null default 1920,
  source text not null default 'pexels', -- provenance + license trail
  source_id text not null,
  source_url text not null default '',
  photographer text not null default '',
  created_at timestamptz not null default now(),
  unique (source, source_id)
);

create index if not exists library_images_collection_idx
  on public.library_images (collection);

alter table public.library_images enable row level security;

drop policy if exists "library_images_read" on public.library_images;
create policy "library_images_read" on public.library_images
  for select to anon, authenticated using (true);
