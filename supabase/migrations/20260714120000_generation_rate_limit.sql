-- Per-user generate rate limit. Stamps the last generation so /api/generate can
-- enforce a short cooldown (RATE_LIMIT_MS in lib/billing/usage.ts) and block
-- scripted rapid-fire with a 429.
--
-- Split out of 20260713190000_billing_tiers rather than appended to it, because
-- that migration had already been run — never mutate a shipped migration, or
-- anyone who ran the earlier version silently misses the new column.
--
-- Service-role-write only, like the other billing columns (20260707180000 revoked
-- authenticated UPDATE on profiles and re-granted only the editable fields).
-- Run in the Supabase SQL Editor.

alter table public.profiles
  add column if not exists last_generated_at timestamptz;
