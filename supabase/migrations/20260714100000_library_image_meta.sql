-- Descriptive metadata for background relevance ranking (image ↔ caption
-- matching in lib/generate/imageSelection.ts). Populated for new ingests by
-- scripts/ingest-library.mjs; backfill existing rows with:
--   node scripts/ingest-library.mjs --backfill-meta
-- Until backfilled, alt/query are '' and selection falls back to random.

alter table public.library_images
  add column if not exists alt text not null default '',        -- Pexels alt/description
  add column if not exists query text not null default '',      -- search query that surfaced it
  add column if not exists source_w integer not null default 0, -- original photo dimensions
  add column if not exists source_h integer not null default 0, -- (0 = unknown / pre-migration)
  add column if not exists avg_color text not null default '';  -- Pexels avg_color hex
