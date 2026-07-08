-- Stripe billing state on profiles. Written by the Stripe webhook via the
-- service-role admin client (bypasses RLS); read by the owner (the existing
-- "viewable by their owner" select policy already covers these columns).
-- Run in the Supabase SQL Editor.

alter table public.profiles
  add column if not exists stripe_customer_id text,
  add column if not exists stripe_subscription_id text,
  add column if not exists subscription_status text,
  add column if not exists plan text not null default 'free';

-- The webhook looks users up by customer id on subscription events.
create index if not exists profiles_stripe_customer_idx
  on public.profiles (stripe_customer_id);
