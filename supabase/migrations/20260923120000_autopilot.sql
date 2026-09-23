-- Autopilot (admin-only test feature, 2026-09-23): a per-admin plan that
-- generates decks from a topic list, writes the post description, runs a
-- review gate over the rendered slides, and parks each deck for a human
-- Approve before it posts. Service-role only — RLS on, no policies — because
-- every read/write goes through the admin allow-list in app code, exactly
-- like generation_runs. See lib/autopilot/run.ts.

create table if not exists public.autopilot_plans (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null unique references auth.users (id) on delete cascade,
  -- The cron only acts on enabled plans; the "Generate next" button ignores it.
  enabled           boolean not null default false,
  connection_id     uuid references public.tiktok_connections (id) on delete set null,
  -- null = stock photos; otherwise every deck is locked to this collection.
  collection_id     uuid references public.collections (id) on delete set null,
  topics            text[] not null default '{}',
  next_topic_index  integer not null default 0,
  slide_count       integer not null default 5,
  privacy_level     text not null default 'SELF_ONLY',
  -- The cron stops generating while this many decks await review.
  max_pending       integer not null default 2,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create table if not exists public.autopilot_items (
  id                uuid primary key default gen_random_uuid(),
  plan_id           uuid not null references public.autopilot_plans (id) on delete cascade,
  user_id           uuid not null references auth.users (id) on delete cascade,
  topic             text not null,
  slideshow_id      uuid references public.slideshows (id) on delete set null,
  description       text,
  -- generating → generated (deck saved) → needs_review (described + gated)
  -- → approved (posted) | rejected; failed at any step.
  status            text not null check (status in ('generating', 'generated', 'needs_review', 'approved', 'rejected', 'failed')),
  -- The gate's verdict: {verdict: post|hold, score, issues[], summary, model}.
  review            jsonb,
  attempts          integer not null default 1,
  error             text,
  tiktok_post_id    uuid references public.tiktok_posts (id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists autopilot_items_plan_created_idx
  on public.autopilot_items (plan_id, created_at desc);
create index if not exists autopilot_items_status_idx
  on public.autopilot_items (status);

alter table public.autopilot_plans enable row level security;
alter table public.autopilot_items enable row level security;
-- No policies on purpose: service role only.
