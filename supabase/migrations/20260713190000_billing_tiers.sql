-- Multi-tier billing: a per-plan monthly slideshow allowance + a one-time credit
-- balance. Extends the profiles billing columns from 20260707180000_billing.
-- All service-role-write only: that earlier migration revoked authenticated UPDATE
-- on profiles and re-granted only the editable profile fields, so usage/credits
-- can't be tampered with from the browser. Run in the Supabase SQL Editor.

alter table public.profiles
  add column if not exists plan_quota integer,          -- slideshows/month; null = unlimited
  add column if not exists slideshows_used integer not null default 0,
  add column if not exists period_end timestamptz,      -- usage-reset boundary
  add column if not exists credits integer not null default 0;
