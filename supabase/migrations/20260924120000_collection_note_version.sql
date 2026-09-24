-- Version stamp for the cached vision note on each collection photo.
--
-- The notes written since 20260922130000 describe a photo generically —
-- "gray sports car on an empty lot", "white sports car in a parking lot" —
-- and the copy step is written against those lines. On the first outside
-- collection test (2026-09-24, 25 supercars) that produced a bang-for-buck
-- listicle naming a Miata, a Camaro and a Mustang EcoBoost, none of which
-- were in the pool, and the matcher then put "ford mustang ecoboost" on the
-- nearest Ford: a Ford GT. The notes now IDENTIFY the subject when it is
-- recognisable (make and model, brand and product, landmark), so the copy can
-- only name what the photos contain and the matcher can refuse a named thing
-- the pool lacks.
--
-- A note's version says which prompt wrote it. Notes older than the current
-- NOTE_VERSION in lib/generate/poolNotes.ts are re-described once (about a
-- tenth of a cent per photo) and re-cached; new photos are stamped on write.
-- The code tolerates this column missing (it then trusts every cached note as
-- current and spends nothing), so deploy order does not matter — but until it
-- runs, existing collections keep their generic notes and the Ford GT class
-- of mismatch stays possible on them. Run manually in the Supabase SQL editor.

alter table public.collection_images
  add column if not exists note_version smallint;

comment on column public.collection_images.note_version is
  'Which DESCRIBE prompt wrote vision_note (lib/generate/poolNotes.ts NOTE_VERSION). Null/older = re-describe on next use.';
