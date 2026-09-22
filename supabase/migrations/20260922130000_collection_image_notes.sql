-- What each collection photo shows, and whether it carries baked-in text.
-- Written once per photo by vision at first use (lib/generate/poolNotes.ts)
-- and read on every later run, so a 60-photo collection is described once.
--
-- vision_note feeds the copy step (captions are written to what the pool can
-- carry — run 94 put "hiring my first team member" over a pile of cash because
-- the copy never saw the photos) and rides beside each thumbnail into the
-- matcher. has_text drops photos with their own text (screen text, quotes,
-- screenshots) from the pool, mechanically — a caption over a screenshot reads
-- as a mistake. The code tolerates these columns missing: it just re-describes
-- the pool on every run until this is applied.
alter table public.collection_images
  add column if not exists vision_note text,
  add column if not exists has_text boolean;

comment on column public.collection_images.vision_note is
  'One-line vision description of the photo (<=120 chars), cached by lib/generate/poolNotes.ts. Null = never described.';
comment on column public.collection_images.has_text is
  'Photo has readable text baked in (on-screen text, quotes, screenshots) — excluded from collection decks. Null = never described.';
