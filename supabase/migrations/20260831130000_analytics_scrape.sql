-- Per-post engagement columns for Analytics (run 2026-08-31).
-- HISTORY: this migration originally served an Apify/ScrapTik public-profile
-- scrape; Christian rejected any Apify dependency the same day, and the data
-- source is now TikTok's own API (lib/analytics/officialStats.ts —
-- user.info.stats + video.list, pending the scope revision in
-- docs/tiktok-scope-revision.md). The columns are unchanged; only the writer
-- differs. username/tiktok_uid were for the scraper and are currently unused —
-- harmless to keep, and username may serve display purposes later.
-- Run manually in the Supabase SQL Editor. Idempotent.

alter table public.tiktok_connections
  add column if not exists username   text,
  add column if not exists tiktok_uid text;

-- Latest engagement counts per post, matched from /v2/video/list/.
-- Point-in-time history is not kept per post — the account_snapshots table
-- carries the trend; these are "current numbers", refreshed together.
alter table public.tiktok_posts
  add column if not exists aweme_id      text,
  add column if not exists view_count    bigint,
  add column if not exists like_count    bigint,
  add column if not exists comment_count bigint,
  add column if not exists share_count   bigint,
  add column if not exists metrics_at    timestamptz;

comment on column public.tiktok_posts.aweme_id is
  'TikTok public post id, matched from video.list by caption + timing. Once set, later refreshes match by id.';
