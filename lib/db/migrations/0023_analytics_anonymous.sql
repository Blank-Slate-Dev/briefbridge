-- =============================================================================
-- 0023 — Allow anonymous analytics events
-- =============================================================================
--
-- analytics_events.user_id was NOT NULL because every event so far came from
-- an authenticated action: a chat query, an empty retrieval. Page views are
-- different — most of the traffic worth measuring is LOGGED OUT. The
-- programmatic legislation pages, the homepage, the demo: nobody has an
-- account when they land on those, and those visits are precisely the ones
-- that answer "is any of this reaching real lawyers".
--
-- So user_id becomes nullable, and null means "not signed in" rather than
-- "missing data". Every query that groups by user must now filter out nulls
-- explicitly — see app/(app)/admin/analytics/page.tsx, where the per-user
-- tables all carry `WHERE user_id IS NOT NULL`.
--
-- The path index exists because the traffic tables group by
-- metadata->>'path'. Without it that is a sequential scan over every event
-- ever recorded, which gets slow well before the table gets large.
--
-- SAFE ON EXISTING DATA: dropping a NOT NULL constraint cannot fail and
-- cannot invalidate a row that already satisfies it.

alter table analytics_events
  alter column user_id drop not null;

-- Partial index: only page_view events are ever grouped by path, and they
-- will come to dominate the table. Indexing just those keeps it small.
create index if not exists analytics_events_path_idx
  on analytics_events ((metadata->>'path'))
  where event_type = 'page_view';

-- The dashboard's traffic queries filter on event type and date together.
create index if not exists analytics_events_type_created_idx
  on analytics_events (event_type, created_at desc);

-- Grants are unaffected by column changes, but restate them so a database
-- provisioned from migrations alone ends up in the working state.
grant select, insert on analytics_events to briefbridge_app;