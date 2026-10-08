-- Outlier ranking for trends (2026-10-08). A post's views divided by its
-- author's MEDIAN views across their settled recent posts (older than 24h),
-- measured from the same ScrapTik profile scrape that already fetches ~20
-- recent posts per watchlist author — no extra spend.
--
-- WHY: views and views_per_hour reward big accounts. A 2M-follower creator's
-- ordinary post outranks a 5k creator's 50x breakout, but only the breakout's
-- FORMAT is what made it travel, so only it is worth copying. Above ~3x is a
-- signal; under ~1.5x is that account's normal day.
--
-- Null = no baseline (the author was never profile-scraped, or has fewer than
-- 5 settled posts). Consumers fall back to views_per_hour for those rows.

alter table public.trending_posts
  add column if not exists author_median_views bigint,
  add column if not exists outlier_multiple real;

create index if not exists trending_posts_niche_outlier_idx
  on public.trending_posts (niche, outlier_multiple desc nulls last);
