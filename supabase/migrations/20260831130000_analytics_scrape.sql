-- Analytics via public-profile scrape (ScrapTik), replacing the dead
-- user.info.stats path: that scope was removed from the authorize call on
-- 2026-08-08 (re-adding it needs a full TikTok re-review), so account stats
-- and per-post views now come from scraping the user's PUBLIC profile — the
-- same ScrapTik actor the trends watchlist already uses, ~$0.002/request,
-- at most once an hour per user, triggered by analytics page visits.
-- Run manually in the Supabase SQL Editor. Idempotent.

-- The scrape needs the user's @handle (resolved once via the Content Posting
-- API's creator_info, which video.publish already grants) and TikTok's
-- numeric uid (resolved from the profile scrape; userPosts requires it).
alter table public.tiktok_connections
  add column if not exists username   text,
  add column if not exists tiktok_uid text;

-- Latest engagement counts per post, matched from the profile scrape.
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
  'TikTok public post id, matched from a profile scrape by caption + timing. Once set, later scrapes match by id.';
