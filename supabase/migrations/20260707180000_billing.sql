-- Stripe billing state, attached to public.profiles (from 20260623120000_init_profiles).
-- Written ONLY by the Stripe webhook via the service-role admin client; the owner
-- can READ these columns (the existing "viewable by their owner" select policy
-- covers them). Run in the Supabase SQL Editor.

-- Safety net: this project has every migration EXCEPT init_profiles applied, so
-- create profiles if it's missing, then backfill a row for every existing auth
-- user (the signup trigger only fires for NEW users) so current accounts have a
-- row to attach billing to.
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  business_name text,
  niche text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

drop policy if exists "Profiles are viewable by their owner" on public.profiles;
create policy "Profiles are viewable by their owner"
  on public.profiles for select using ((select auth.uid()) = id);

insert into public.profiles (id, email)
  select id, email from auth.users
  on conflict (id) do nothing;

-- Billing columns.
alter table public.profiles
  add column if not exists stripe_customer_id text,
  add column if not exists stripe_subscription_id text,
  add column if not exists subscription_status text,
  add column if not exists plan text not null default 'free';

-- The webhook looks users up by customer id on subscription events.
create index if not exists profiles_stripe_customer_idx
  on public.profiles (stripe_customer_id);

-- Entitlement is service-role-write only. Supabase grants `authenticated` broad
-- UPDATE by default; revoke it and re-grant only the user-editable columns, so a
-- user can't self-grant Pro by updating their own profiles row from the browser.
-- (service_role keeps its grant, so the webhook still writes every column.)
revoke update on public.profiles from anon, authenticated;
grant update (email, business_name, niche, updated_at)
  on public.profiles to authenticated;
