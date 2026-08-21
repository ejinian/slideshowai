-- How each deck was generated, recorded at persist time so performance can be
-- attributed later (join tiktok_posts -> slideshows -> gen_meta, then scraped
-- public view counts against blueprint/hook/detail). Attribution is impossible
-- retroactively — a deck that doesn't record what steered it can never tell us
-- whether the steering worked — which is why this lands before the steering
-- itself is proven.
--
-- jsonb on purpose: the shape will evolve with the experiment (a `v` field
-- versions it), and nothing queries it in the hot path. Owner-only RLS on
-- slideshows already covers it. Run manually in the Supabase SQL editor.

alter table public.slideshows
  add column if not exists gen_meta jsonb;

comment on column public.slideshows.gen_meta is
  'Generation provenance: {v, detail, nicheSlug, formatSource: client|trend|null, blueprint?: {postId, hookType, author}, model}. Written by /api/generate; the code tolerates the column missing so deploy order does not matter.';
