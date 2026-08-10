-- Every billing guard assumed a profiles row exists. Six real users had none,
-- and each of them was permanently unable to generate.
--
-- WHAT HAPPENED. `claim_generation_slot` is `update public.profiles ... where
-- id = p_user` and returns `row_count > 0`. With no row it updates nothing,
-- returns false, and the route reports "You're generating too fast" — forever,
-- on a user's very first attempt. `spend_credits` has the same shape via
-- `if not found then return -1`, which surfaces as "you've reached your plan's
-- limit". Both failure modes are indistinguishable from the real thing, and
-- founder accounts skip the guards entirely (lib/admins), so nobody testing the
-- app could see it.
--
-- The row was supposed to be guaranteed by the on_auth_user_created trigger
-- (20260623120000). `loadBilling()` used to upsert the row as a side effect,
-- which silently covered every case the trigger missed; the billing-hardening
-- pass removed loadBilling from the flow and the gap became load-bearing.
--
-- THE RULE THIS ENCODES: a missing profiles row is an infrastructure fault, and
-- an infrastructure fault must never be charged to the user. So we fix it three
-- ways — backfill what's broken, make the trigger unable to fail silently, and
-- make every guard self-healing so it can never again depend on the trigger
-- having worked.

-- ── 1. Backfill ─────────────────────────────────────────────────────────────
-- Everyone currently missing a row. Defaults on the billing columns give them a
-- normal free-tier profile, exactly as if the trigger had fired at signup.

insert into public.profiles (id, email, business_name)
select u.id,
       u.email,
       u.raw_user_meta_data ->> 'business_name'
  from auth.users u
  left join public.profiles p on p.id = u.id
 where p.id is null
on conflict (id) do nothing;

-- ── 2. The trigger can no longer break, or half-work ────────────────────────
-- Two changes from 20260623120000:
--   * ON CONFLICT DO NOTHING — re-running or racing another writer is a no-op
--     instead of a unique violation.
--   * The exception handler. This trigger runs inside the auth.users INSERT, so
--     anything it raises rolls back the SIGNUP. A profile row is not worth
--     failing a signup over; the guards below heal a missing row anyway. We log
--     rather than swallow silently, so the cause is recoverable from the logs.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, email, business_name)
  values (
    new.id,
    new.email,
    new.raw_user_meta_data ->> 'business_name'
  )
  on conflict (id) do nothing;
  return new;
exception
  when others then
    raise warning 'handle_new_user: could not create profile for %: %',
      new.id, sqlerrm;
    return new;   -- NEVER block signup
end;
$$;

-- Re-assert the trigger — if it was ever dropped on this project, that alone
-- would explain the six missing rows.
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ── 3. Self-healing guards ──────────────────────────────────────────────────
-- The guards stop trusting that the row exists. This is the part that makes the
-- bug structurally impossible rather than merely fixed today.

create or replace function public.ensure_profile(p_user uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, business_name)
  select u.id, u.email, u.raw_user_meta_data ->> 'business_name'
    from auth.users u
   where u.id = p_user
  on conflict (id) do nothing;
end;
$$;

-- spend_credits: identical to 20260806130000 except for the ensure_profile call.
-- `if not found then return -1` now means what it says — the user id is not a
-- real user — instead of also meaning "the trigger didn't fire".
create or replace function public.spend_credits(p_user uuid, p_n int)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_quota   int;
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

  select plan_quota, slideshows_used, credits, period_end
    into v_quota, v_used, v_credits, v_period
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

  -- NULL plan_quota means "unlimited" for display; enforcement still caps at the
  -- fair-use ceiling so a runaway can't rack up unbounded OpenAI + storage cost.
  v_cap := coalesce(v_quota, 2000);

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

-- claim_generation_slot: the one that produced the false "generating too fast".
create or replace function public.claim_generation_slot(p_user uuid, p_ms int)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rows int;
begin
  perform public.ensure_profile(p_user);

  update public.profiles
     set last_generated_at = now()
   where id = p_user
     and (last_generated_at is null
          or last_generated_at < now() - make_interval(secs => p_ms / 1000.0));
  get diagnostics v_rows = row_count;
  return v_rows > 0;
end;
$$;

-- claim_rate_window: same fault — a missing row read as "over the limit".
create or replace function public.claim_rate_window(
  p_user uuid, p_limit int, p_window_secs int
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
  v_start timestamptz;
begin
  perform public.ensure_profile(p_user);

  select suggest_count, suggest_window_start
    into v_count, v_start
    from public.profiles
   where id = p_user
     for update;

  if not found then
    return false;
  end if;

  if v_start is null or v_start < now() - make_interval(secs => p_window_secs) then
    update public.profiles
       set suggest_count = 1, suggest_window_start = now()
     where id = p_user;
    return true;
  end if;

  if v_count >= p_limit then
    return false;
  end if;

  update public.profiles set suggest_count = v_count + 1 where id = p_user;
  return true;
end;
$$;

-- ── 4. Lock the new function down like the rest ─────────────────────────────
-- Called only from the SECURITY DEFINER guards above, never from the browser.
revoke all on function public.ensure_profile(uuid) from public, anon, authenticated;

-- ── 5. Verify ───────────────────────────────────────────────────────────────
-- Both counts must be 0. The second is the standing invariant: if it is ever
-- non-zero again, users are silently locked out.
--
--   select count(*) as missing_profiles
--     from auth.users u left join public.profiles p on p.id = u.id
--    where p.id is null;
--
--   select count(*) as trigger_missing
--     from pg_trigger
--    where tgname = 'on_auth_user_created' and not tgisinternal;
--   -- ^ this one must be 1, not 0.
