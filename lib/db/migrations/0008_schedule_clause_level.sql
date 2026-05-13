-- =============================================================================
-- 0008_schedule_clause_level.sql — add 'schedule_clause' to level enum
-- =============================================================================
--
-- Chunk 8 follow-up. The original 0007_legislation.sql CHECK constraint
-- allowed:
--     'chapter', 'part', 'division', 'subdivision',
--     'section', 'subsection', 'schedule', 'schedule_part'
--
-- That was missing a level for the actual numbered clauses inside a
-- schedule. The Privacy Act 1988's Schedule 1 contains the Australian
-- Privacy Principles (APPs 1–13). They are clauses within Parts within
-- a Schedule, and AGLC4 cites them as `sch 1 cl 11`, NOT `s 11`.
--
-- Without this fix, the parser was emitting APPs as `level='section'`,
-- which produced citations like `Privacy Act 1988 (Cth) s 11` for APP 11.
-- That's a real, harmful citation error — s 11 is "File number recipients",
-- not APP 11. Trust-killing for a tool whose differentiator is verification.
--
-- This migration adds 'schedule_clause' to the allowed values. The parser
-- and citation builders are updated in the same commit.
--
-- ---------------------------------------------------------------------------
-- Re-ingestion required after this migration
-- ---------------------------------------------------------------------------
--
-- Existing legislation_sections rows for the Privacy Act 1988 are at the
-- wrong levels (schedule clauses are stored as 'section'). They need to
-- be deleted and re-ingested under the new schema. The ingest script
-- already handles this — re-running `npm run ingest:legislation` for the
-- Privacy Act will drop and re-insert its sections.
--
-- If multiple Acts have been ingested before this migration applies,
-- re-ingest each one. For Chunk 8 Phase 2 we only have the Privacy Act
-- so the manual step is:
--
--   DELETE FROM legislation WHERE id = '<privacy-act-id>';
--   -- (CASCADE removes its sections)
--   npm run ingest:legislation -- \
--     --registration-id=C2004A03712 \
--     --short-title="Privacy Act 1988" \
--     --compilation-date=2025-02-01 \
--     --from-file=./privacy-act-doc1.html

ALTER TABLE "legislation_sections"
  DROP CONSTRAINT IF EXISTS "legislation_sections_level_check";
--> statement-breakpoint

ALTER TABLE "legislation_sections"
  ADD CONSTRAINT "legislation_sections_level_check"
  CHECK ("level" IN (
    'chapter',
    'part',
    'division',
    'subdivision',
    'section',
    'subsection',
    'schedule',
    'schedule_part',
    'schedule_clause'
  ));