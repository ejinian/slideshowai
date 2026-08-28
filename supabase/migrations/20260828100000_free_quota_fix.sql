-- Free-plan quota hole (found 2026-08-27 while verifying the 3-credit charge).
--
-- profiles.plan_quota was NULL for every free signup: nothing in the signup
-- trigger, ensure_profile, or the selfheal backfill ever set it — only the
-- Stripe webhook writes it, and only paid tiers go through the webhook. The
-- app's JS side (lib/billing/usage.ts) resolves NULL to the plan's configured
-- quota (free = 5) for DISPLAY, but the enforcement RPC spend_credits resolves
-- NULL to the 2000 fair-use ceiling — a fallback written for the Unlimited
-- tier that free rows inherited. Net effect: every free account was capped at
-- 2000 slideshows/month while its UI said "/ 5". Observed live: a free test
-- user at 24 used of a displayed 5, still generating.
--
-- Three layers, so NULL can only ever mean "Unlimited tier" again:
--   1. Column default 5 — every insert path (signup trigger, ensure_profile,
--      any future backfill) provisions the free quota without each function
--      having to remember to. The webhook OVERWRITES it per tier on upgrade
--      (growth 150 / scale 400 / unlimited NULL), which explicit writes still
--      do against a default.
--   2. Backfill existing free rows.
--   3. spend_credits falls back plan-aware: NULL quota on a non-unlimited row
--      caps at the FREE quota (failing safe), not the fair-use ceiling. Paid
--      tiers always have the column set by the webhook, so this branch only
--      fires for broken rows.
--
-- Run manually in the Supabase SQL editor (like every migration here).

alter table public.profiles
  alter column plan_quota set default 5;

update public.profiles
   set plan_quota = 5
 where plan_quota is null
   and coalesce(plan, 'free') <> 'unlimited';

-- spend_credits: identical to 20260810000000 except v_plan is read and the
-- v_cap fallback is plan-aware.
create or replace function public.spend_credits(p_user uuid, p_n int)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_quota   int;
  v_plan    text;
  v_used    int;
  v_credits int;
  v_period  timestamptz;
  v_cap     int;
  v_from_allowance int;
begin
  if p_n is null or p_n <= 0 then
    return 0; -- nothing to charge
  end if;

  perform public.ensure_profile(p_user);

  select plan_quota, plan, slideshows_used, credits, period_end
    into v_quota, v_plan, v_used, v_credits, v_period
    from public.profiles
   where id = p_user
     for update;               -- ← serialises concurrent spenders

  if not found then
    return -1;
  end if;

  -- LAZY MONTHLY ROLLOVER. This used to live in loadBilling(), which the
  -- generate route no longer calls — without it slideshows_used would never
  -- reset and every user would be permanently capped after their first month.
  -- Doing it under the same row lock keeps it atomic with the spend.
  if v_period is null or v_period < now() then
    v_used   := 0;
    v_period := now() + interval '30 days';
    update public.profiles
       set slideshows_used = 0, period_end = v_period
     where id = p_user;
  end if;

  -- NULL plan_quota means "Unlimited tier" (the webhook writes it that way);
  -- enforcement still caps unlimited at the fair-use ceiling so a runaway
  -- can't rack up unbounded OpenAI + storage cost. A NULL on any OTHER plan is
  -- a broken row (the webhook always sets paid quotas) — cap it at the free
  -- quota, failing safe instead of open. This is the enforcement-side twin of
  -- the display fallback in lib/billing/usage.ts.
  v_cap := coalesce(
    v_quota,
    case when v_plan = 'unlimited' then 2000 else 5 end
  );

  if greatest(0, v_cap - v_used) + v_credits < p_n then
    return -1;
  end if;

  v_from_allowance := least(p_n, greatest(0, v_cap - v_used));

  update public.profiles
     set slideshows_used = v_used + v_from_allowance,
         credits         = v_credits - (p_n - v_from_allowance)
   where id = p_user;

  return p_n - v_from_allowance;
end;
$$;
