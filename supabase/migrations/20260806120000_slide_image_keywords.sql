-- Remember what each slide's photo was searched with.
--
-- The copy model writes `image_keywords` per slide — concrete subject phrases
-- like "kava root" or "incline dumbbell press" — and /api/generate uses them to
-- source the photo, then throws them away. That was fine while images were
-- decided once at generation, but the editor's "Try another photo" has to run
-- the SAME search again later, and with nothing stored it was reduced to
-- guessing from the caption: the first two words of "4 reasons calming pouches
-- are your best stress-free pickup" gave a Pexels query of literally
-- "4 reasons", so the replacement photos were unrelated to the deck.
--
-- Nullable on purpose: every deck generated before this migration has no
-- keywords, and the route derives a query from the caption for those.

alter table public.slides
  add column if not exists image_keywords text[];

comment on column public.slides.image_keywords is
  'Subject phrases the copy model wrote for this slide, used to source its photo. Re-used by /api/slideshows/[id]/image to search again. Null for slides generated before 2026-08-06.';
