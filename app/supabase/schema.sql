-- Translation Explanation Study: Supabase schema
-- Run once in the Supabase dashboard → SQL Editor. Safe to re-run.
--
-- Design: append-only event log. The browser holds the public "anon" key, so participants
-- may only INSERT rows. They cannot read, update or delete anything; researchers read the data
-- from the dashboard or with the service_role key, which must never go in the front end.

create table if not exists public.study_events (
  event_id    uuid primary key,                 -- generated in the browser; makes retries idempotent
  session_id  uuid not null,                    -- one per study run (a pid could repeat)
  pid         text not null check (char_length(pid) <= 64),
  condition   smallint not null check (condition between 0 and 15),
  kind        text not null check (kind in ('session_start', 'pre_survey', 'trial', 'post_survey', 'session_complete')),
  payload     jsonb not null check (pg_column_size(payload) < 256000),
  client_ts   timestamptz not null,
  created_at  timestamptz not null default now()
);

create index if not exists study_events_session_idx on public.study_events (session_id, client_ts);
create index if not exists study_events_pid_idx on public.study_events (pid);

alter table public.study_events enable row level security;

-- Only policy: anonymous participants can insert. With no SELECT/UPDATE/DELETE policies, those are denied.
drop policy if exists "participants can insert events" on public.study_events;
create policy "participants can insert events"
  on public.study_events for insert
  to anon
  with check (true);

-- Belt and braces: remove the default broad table grants, keep only INSERT for the browser.
revoke all on public.study_events from anon, authenticated;
grant insert on public.study_events to anon;


-- ---------------------------------------------------------------------------
-- Analysis views live in a private schema that the REST API does not expose.
-- Query them in the SQL Editor (or export to CSV from there).
-- ---------------------------------------------------------------------------
create schema if not exists analysis;
revoke all on schema analysis from anon, authenticated;

-- One row per session with its progress.
create or replace view analysis.sessions as
select
  session_id,
  min(pid)                                              as pid,
  min(condition)                                        as condition,
  min(client_ts)                                        as started_at,
  max(client_ts) filter (where kind = 'session_complete') as completed_at,
  count(*) filter (where kind = 'trial' and not coalesce((payload->>'tutorial')::boolean, false)) as trials_done,
  bool_or(kind = 'session_complete')                    as completed,
  -- 'moderated' | 'remote' | 'async' (from ?mode=; 'online' = self-serve before 'async' existed; null = before
  -- this field). moderated/remote sessions do the pre- and post-surveys as live interviews.
  min(payload->>'mode') filter (where kind = 'session_start') as mode,
  -- given on the welcome page; the pid is derived from it unless the link sets ?pid= (null for older sessions)
  min(payload->>'email') filter (where kind = 'session_start') as email,
  -- answered anything but 'Not at all' to "How well can you read Korean?" (or, in an interview, the researcher
  -- ended the session as not eligible); the app ends those sessions there
  bool_or(case when payload->>'format' = 'interview' then payload->>'eligible' is not distinct from 'no'
               else payload->>'korean_proficiency' is distinct from 'Not at all' end)
    filter (where kind = 'pre_survey')                  as screened_out,
  -- overall time from consent to submitting the exit survey, in ms (null until completed; older sessions
  -- without durationMs fall back to their recorded timestamps)
  max(coalesce((payload->>'durationMs')::bigint,
               (payload->>'completedAt')::bigint - coalesce((payload->>'consent')::bigint, (payload->>'startedAt')::bigint)))
    filter (where kind = 'session_complete')            as duration_ms,
  -- total time spent on the notices themselves, in ms (also counts dropouts' finished notices)
  sum(coalesce((payload->>'durationMs')::bigint,
               (payload->>'completedAt')::bigint - (payload->>'startedAt')::bigint))
    filter (where kind = 'trial')                       as trials_ms,
  -- length of the live pre- / post-interview screens, in ms (null for survey sessions)
  max((payload->>'durationMs')::bigint) filter (where kind = 'pre_survey' and payload->>'format' = 'interview')  as pre_interview_ms,
  max((payload->>'durationMs')::bigint) filter (where kind = 'post_survey' and payload->>'format' = 'interview') as post_interview_ms
from public.study_events
group by session_id;

-- One row per (non-practice) trial, flattened for analysis.
create or replace view analysis.trials as
select
  e.session_id,
  e.pid,
  e.condition,
  e.payload->>'stimulusId'                               as stimulus_id,
  (e.payload->>'isFlawed')::boolean                      as is_flawed,
  (e.payload->>'tutorial')::boolean                      as tutorial,
  e.payload->'baseline'->>'decision'                     as baseline_decision,
  (e.payload->'baseline'->>'confidence')::int            as baseline_confidence,
  e.payload->'revised'->>'decision'                      as revised_decision,
  (e.payload->'revised'->>'confidence')::int             as revised_confidence,
  -- correct = rejected a flawed translation or accepted a correct one
  ((e.payload->'baseline'->>'decision') = 'reject') = (e.payload->>'isFlawed')::boolean as baseline_correct,
  ((e.payload->'revised'->>'decision')  = 'reject') = (e.payload->>'isFlawed')::boolean as revised_correct,
  e.payload->'rankings'->'understandability'->'types'    as rank_understandability,
  e.payload->'rankings'->'understandability'->>'justification' as why_understandability,
  e.payload->'rankings'->'decision_support'->'types'     as rank_decision_support,
  e.payload->'rankings'->'decision_support'->>'justification'  as why_decision_support,
  e.payload->'tabViewMs'                                 as tab_view_ms,
  jsonb_array_length(coalesce(e.payload->'originalViews', '[]'::jsonb)) as original_views,
  e.client_ts,
  s.payload->>'mode'                                     as mode,
  -- added with the notices.json data (null for earlier sessions); new columns must stay at the end
  e.payload->>'version'                                  as version,          -- 'correct' | 'flawed'
  e.payload->>'stakes'                                   as stakes,           -- 'high' | 'low'
  e.payload->'comprehension'->>'choice'                  as comprehension_choice,
  e.payload->'comprehension'->>'answerKey'               as comprehension_answer, -- 'correct' | 'flawed' | 'unsure'
  (e.payload->'comprehension'->>'isRight')::boolean      as comprehension_right,
  -- added with the image-first layout (null for earlier sessions)
  (e.payload->>'hints')::boolean                         as hints,               -- true on the session's first (hinted) notice
  jsonb_array_length(e.payload->'transcriptionOpens')    as transcription_opens, -- retired: the transcription was removed (null from then on)
  -- the key question also asked before the explanations (null for earlier sessions)
  e.payload->'baselineComprehension'->>'answerKey'       as baseline_comprehension_answer, -- 'correct' | 'flawed' | 'unsure'
  (e.payload->'baselineComprehension'->>'isRight')::boolean as baseline_comprehension_right,
  -- single 6-point scale (1-3 get it checked, 4-6 rely); decision/confidence above are derived from it, and
  -- confidence is then 1-3 (distance toward that end) rather than the earlier 1-7 rating. Null for earlier sessions.
  (e.payload->'baseline'->>'scale')::int                 as baseline_scale,
  (e.payload->'revised'->>'scale')::int                  as revised_scale,
  -- time on the notice, in ms (older sessions fall back to completedAt - startedAt)
  coalesce((e.payload->>'durationMs')::bigint,
           (e.payload->>'completedAt')::bigint - (e.payload->>'startedAt')::bigint) as duration_ms,
  -- time on each step, in ms; they sum to duration_ms. Null for sessions before step timing was added.
  (e.payload->'stepMs'->>'baseline')::bigint             as baseline_ms,  -- first impression
  (e.payload->'stepMs'->>'reveal')::bigint               as reveal_ms,    -- explanations + revised decision
  (e.payload->'stepMs'->>'question')::bigint             as question_ms,  -- key question after explanations
  (e.payload->'stepMs'->>'rank')::bigint                 as rank_ms       -- rankings + justifications
from public.study_events e
left join public.study_events s on s.session_id = e.session_id and s.kind = 'session_start'
where e.kind = 'trial';
