-- The on-slide caption text of each trending slideshow, transcribed at ingest
-- by the vision pass in lib/trend-slide-text.ts. One entry per slide, in order;
-- "" for a slide that carries no overlay text. Null = not yet transcribed
-- (every consumer falls back to `title`, exactly as before this column).
--
-- WHY THIS EXISTS: `title` is TikTok's video DESCRIPTION — the text UNDER the
-- post — which is hashtag soup roughly a third of the time (fetchTrendExemplars
-- sorts by proseWordCount purely to float the readable ones). The hook that
-- actually stopped the scroll is white text baked into slide 1's JPEG, and
-- until now it existed nowhere in the database. lib/generate/viralExamples.ts
-- is hand-transcribed for exactly this reason: "there is no scrapeable corpus
-- of on-slide text — it only exists baked into images." This column is that
-- corpus, and it grows on every cron run.

alter table public.trending_posts
  add column if not exists slide_texts jsonb;
