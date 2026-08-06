-- Atomic billing.
--
-- WHY: every guard was read-modify-write against a snapshot taken seconds
-- earlier, so none of them actually held under concurrency:
--   * consume() did `slideshows_used = <value read earlier> + n` — an absolute
--     SET with no predicate. N parallel requests all read the same `used` and
--     all wrote the same number, so N decks cost one charge.
--   * rateLimited() was a pure check on that same stale read and markGenerated()
--     an unconditional UPDATE, so the 4s cooldown never serialised anything.
--   * /api/suggest's 3-round cap lived in the request body, with an in-memory
--     map as backup that dies on every cold start and is per-lambda anyway.
--
-- Each function below does its check and its write in ONE statement (or under a
-- row lock), so the database is the arbiter instead of the application.
--
-- All are SECURITY DEFINER and revoked from anon/authenticated: they are called
-- with the service-role key from lib/billing/usage.ts, never from the browser.

-- ── new columns ──────────────────────────────────────────────────────────────

-- Durable replacement for the per-instance in-memory throttle on /api/suggest
-- (and /api/sharpen, /api/trends/remix). A rolling window per user.
alter table public.profiles
  add column if not exists suggest_count int not null default 0,
  add column if not exists suggest_window_start timestamptz;

-- Per-slideshow AI image-swap counter. Lives on the deck, not the profile, so
-- "3 swaps per credit" is scoped to one generation run as intended.
alter table public.slideshows
  add column if not exists image_swaps int not null default 0;

-- The browser must not be able to write any of these. profiles already uses a
-- column-level allowlist (20260707180000_billing.sql) — re-assert it so the new
-- columns are covered, and keep the existing writable set intact.
revoke update on public.profiles from anon, authenticated;
grant update (email, business_name, niche, updated_at)
  on public.profiles to authenticated;

-- slideshows IS user-writable via RLS (title edits etc.), so image_swaps needs
-- an explicit carve-out: the counter is the billing record for swaps.
revoke update on public.slideshows from anon, authenticated;
grant update (title, niche, description, layout, slide_count, status, updated_at)
  on public.slideshows to authenticated;

-- ── spend ────────────────────────────────────────────────────────────────────

-- Draw n slideshows: monthly allowance first, then never-expiring credits.
-- Writes NOTHING when the user can't cover it.
--
-- RETURNS the number drawn from CREDITS, or -1 for "insufficient". The caller
-- needs that split to refund correctly: credits never expire and allowance
-- resets monthly, so refunding the wrong bucket silently robs the user (pay 1
-- credit, get 1 allowance back, lose the credit at month end).
--
-- The row lock is what makes this safe: two concurrent calls serialise, so the
-- second sees the first's decrement instead of the same stale balance.
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

-- Give back a reservation when the pipeline fails after charging. Takes the
-- SAME split spend_credits returned, so each bucket gets back exactly what it
-- gave. Never pushes slideshows_used below zero.
create or replace function public.refund_credits(
  p_user uuid, p_n int, p_from_credits int
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_credits_back int := greatest(0, coalesce(p_from_credits, 0));
  v_allow_back   int;
begin
  if p_n is null or p_n <= 0 then
    return;
  end if;
  v_allow_back := greatest(0, p_n - v_credits_back);

  update public.profiles
     set slideshows_used = greatest(0, slideshows_used - v_allow_back),
         credits         = credits + v_credits_back
   where id = p_user;
end;
$$;

-- ── rate limit ───────────────────────────────────────────────────────────────

-- Compare-and-swap on last_generated_at. Returns true only if THIS call won the
-- slot; concurrent callers get false because the WHERE no longer matches once
-- the first UPDATE lands.
create or replace function public.claim_generation_slot(p_user uuid, p_ms int)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rows int;
begin
  update public.profiles
     set last_generated_at = now()
   where id = p_user
     and (last_generated_at is null
          or last_generated_at < now() - make_interval(secs => p_ms / 1000.0));
  get diagnostics v_rows = row_count;
  return v_rows > 0;
end;
$$;

-- ── generic rolling-window counter (suggest / sharpen / remix) ───────────────

-- Returns true when the call is allowed and records it. One row lock per user,
-- so the count can't be raced, and the window resets lazily.
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

-- ── swap counter ─────────────────────────────────────────────────────────────

-- Atomically bump a deck's AI-swap counter and hand back the new total, so the
-- caller can decide whether this swap opens a new paid block of three. Scoped by
-- user_id as well as id: the function is SECURITY DEFINER and therefore bypasses
-- RLS, so ownership has to be proven here.
create or replace function public.bump_image_swaps(p_slideshow uuid, p_user uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_new int;
begin
  update public.slideshows
     set image_swaps = image_swaps + 1
   where id = p_slideshow
     and user_id = p_user
  returning image_swaps into v_new;

  return v_new;  -- NULL when the deck isn't theirs / doesn't exist
end;
$$;

-- ── lock the functions to the service role ───────────────────────────────────
revoke all on function public.spend_credits(uuid, int) from public, anon, authenticated;
revoke all on function public.refund_credits(uuid, int, int) from public, anon, authenticated;
revoke all on function public.claim_generation_slot(uuid, int) from public, anon, authenticated;
revoke all on function public.claim_rate_window(uuid, int, int) from public, anon, authenticated;
revoke all on function public.bump_image_swaps(uuid, uuid) from public, anon, authenticated;
