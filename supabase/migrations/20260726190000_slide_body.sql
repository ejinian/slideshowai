-- Second text block per slide
--
-- Real value slideshows are a bold heading plus a paragraph carrying the actual
-- substance — the protocol, the numbers, the caveat. One caption per slide could
-- not express that, so a slide that says "eat in an aggressive caloric deficit"
-- had nowhere to put "600-800 cal, coke zero and rice cakes are how you stay
-- full", which is the part worth saving.
--
-- Populated for SHORT decks only (1-3 slides). Decks of 4+ leave it null and
-- render exactly as before.

alter table public.slides
  add column if not exists body text;

comment on column public.slides.body is
  'Optional paragraph rendered under the caption. Short decks (1-3 slides) only; null on 4+ listicle decks.';
