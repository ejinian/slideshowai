-- What a slideshow COST us to make.
--
-- The admin dashboard estimates our OpenAI/Pexels spend from the decks in the
-- database, but the two things that move that number most were never stored:
-- whether Supercharge ran (it adds a gpt-4.1 judge pass and can trigger a full
-- regenerate) and which image path was taken (uploads = one vision call over
-- the photo set; stock = a vision judge PER SLIDE, several times pricier).
-- Without them every deck looks identical and the estimate is flat wrong.
--
-- Both default to the cheap case, so rows that predate this migration are
-- counted as plain stock generations. That UNDERSTATES historical cost, which
-- is the honest direction to be wrong in — and the dashboard says so rather
-- than presenting a number it can't support.

alter table public.slideshows
  add column if not exists supercharged boolean not null default false,
  -- 'collection' = stock/Pexels (per-slide vision judge)
  -- 'single'     = the user's own photos (one image-first vision call)
  add column if not exists background_mode text;

-- The browser must not be able to write these: they are a cost record, not
-- user content. profiles/slideshows already use a column-level allowlist
-- (20260806130000_billing_atomic.sql) — re-assert it so the new columns are
-- covered and the existing writable set is unchanged.
revoke update on public.slideshows from anon, authenticated;
grant update (title, niche, description, layout, slide_count, status, updated_at)
  on public.slideshows to authenticated;
