-- Every generation run — success, mid-pipeline failure, or gate rejection —
-- recorded in the DB so a client's "why did it come out like that" is
-- answerable from the admin dashboard without a screenshot or a local repro.
--
-- This is the production twin of the local diagnostics/Run_N folders: the SAME
-- ~30 call sites in /api/generate and lib/generate feed it (see the RunLogger
-- interface in lib/generate/diagnostics.ts), so local and prod cannot drift.
-- One row per run instead of one folder: every stage's payload lives in
-- `stages` keyed by the file name it would have had locally (02_lean_prompt.txt,
-- 03b_lean_pick.json, 04_pool_match.json…), the 00_SUMMARY sections in `notes`.
--
-- Images are NOT copied. A run references its slideshow; the slides rows
-- already hold every background's Storage path, and the rendered slide is a
-- render-endpoint call away. `images` holds names and byte counts only —
-- enough to see that 9 uploads went in and which were excluded, never the
-- bytes. Reference-TikTok slides are never stored anywhere (copyright).
--
-- FAILURES ARE THE POINT. The local dumps only captured runs that got past
-- the gates; here a billing rejection, a resolver 400 and a throw halfway
-- through images all get a row, with the last stage that logged before the
-- throw (`failed_at`) and the classified error.
--
-- Size, measured: 37-60KB per successful legacy-path run, less on the lean
-- copy path (1.5k prompt, no judge) and for failures. At ~450 runs/month that
-- is ~25MB/month against Pro's 8GB — no retention needed for a long time.
--
-- SERVICE-ROLE ONLY: RLS enabled with NO policies. Rows carry prompts and
-- upload metadata and are read exclusively by the admin dashboard through the
-- secret-key client. /api/generate's writes are best-effort and never throw,
-- so deploying before running this is safe — you just collect nothing until
-- it runs. Run manually in the Supabase SQL editor.

create table if not exists public.generation_runs (
  id            uuid primary key,
  user_id       uuid references auth.users (id) on delete cascade,
  -- First deck this run produced (a 2-versions run lists both in stages).
  -- set null on delete: the run outlives the deck — that is the record of
  -- what we generated even after the user throws it away.
  slideshow_id  uuid references public.slideshows (id) on delete set null,
  status        text not null check (status in ('ok', 'failed', 'rejected')),
  -- production | preview | development. Local dev writes here too (the local
  -- .env points at this project), tagged so it filters out of client views.
  env           text not null,
  -- upload | stock — which intake direction (mirrors the local folder suffix).
  kind          text,
  -- lean | legacy | showcase | before_after — which copy machinery SHIPPED.
  copy_path     text,
  -- Slide 1's caption, for list views.
  hook          text,
  -- Last stage that logged before the throw; null on success.
  failed_at     text,
  -- {code, message, stack?} — code is the PipelineError/gate code.
  error         jsonb,
  -- The request minus image bytes (prompt ≤500 chars, counts, modes).
  request       jsonb,
  -- stage name → payload. Text stages are strings, json stages are objects.
  stages        jsonb not null default '{}'::jsonb,
  -- [{section, body}] — the 00_SUMMARY.md sections, in order.
  notes         jsonb not null default '[]'::jsonb,
  -- The auto-detected anomaly flags from the summary, denormalised for lists.
  anomalies     text[] not null default '{}',
  -- [{name, bytes}] — references only, never image data.
  images        jsonb not null default '[]'::jsonb,
  -- stage name → ms since the run started. The waterfall.
  timings       jsonb not null default '{}'::jsonb,
  duration_ms   integer,
  created_at    timestamptz not null default now(),
  finished_at   timestamptz
);

comment on table public.generation_runs is
  'One row per /api/generate run (ok | failed | rejected). Production twin of the local diagnostics folders: stages keyed by their local file names, images by reference only. Service-role only.';

-- "What did this person generate" — the query the admin page runs.
create index if not exists generation_runs_user_created
  on public.generation_runs (user_id, created_at desc);
-- "What happened today" — the feed.
create index if not exists generation_runs_created
  on public.generation_runs (created_at desc);
-- "What broke" — partial, so it stays tiny.
create index if not exists generation_runs_problems
  on public.generation_runs (created_at desc)
  where status <> 'ok';
create index if not exists generation_runs_slideshow
  on public.generation_runs (slideshow_id)
  where slideshow_id is not null;

alter table public.generation_runs enable row level security;
-- Deliberately no policies: nothing but the service-role client can read or
-- write. Users never see their own rows — this is our forensic record.
