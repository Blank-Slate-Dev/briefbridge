-- =============================================================================
-- 0006_chunk7.sql — Chunk 7: AI access controls + file reading metadata
-- =============================================================================
--
-- Same hand-written pattern as 0004 and 0005 — drizzle-kit's TS generator
-- doesn't ergonomically support our CHECK constraints + we want full
-- control over the ALTER TABLE order so dev DBs don't end up half-migrated
-- if something fails partway.
--
-- =============================================================================
-- IMPORTANT — Apply this migration carefully
-- =============================================================================
--
-- Chunk 6 taught us that `npm run db:migrate` can silently fail to apply a
-- migration that contains certain statement combinations, leaving the
-- __drizzle_migrations table out of sync with reality. If `db:migrate`
-- doesn't report `[✓] 0006_chunk7 done!`, apply this SQL manually via the
-- Supabase SQL editor (it's idempotent-ish; the ALTER COLUMN .. IF NOT
-- EXISTS pattern below means re-running is safe), then INSERT a row into
-- drizzle.__drizzle_migrations manually. See the Chunk 6 README §10 for
-- the recipe.
--
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. matters — AI access controls
-- ---------------------------------------------------------------------------
--
-- ai_access_mode: 'off' | 'all' | 'subset'
--   'off'    (default)    — Claude has zero file access for this matter.
--                           System prompt does NOT list files. read_files
--                           tool calls return an error message Claude
--                           can surface.
--   'all'                  — Claude can see every active, ai_readable,
--                           non-blocked file for this matter.
--   'subset'               — Same as 'all' EXCEPT files where
--                           files.ai_excluded_in_matter = true are removed
--                           from the listing.
--
-- ai_access_committed_at:  Timestamp when the lawyer last hit "Confirm" in
--                          the AI access panel. NULL until first confirm.
--                          We use it for two things:
--                            (a) Detecting "lawyer enabled access but never
--                                confirmed exclusions" — UI shows panel as
--                                pending in that state.
--                            (b) Invalidation on new upload — when a file
--                                is uploaded into an 'all' or 'subset'
--                                matter, we NULL this column to force the
--                                lawyer to re-confirm. Claude treats
--                                "mode != 'off' AND committed_at IS NULL"
--                                as effectively off until reconfirmed.
--
-- The CHECK constraint enforces the three valid mode values at the DB level
-- (defense in depth alongside the TS-level $type<AiAccessMode>() in
-- schema.ts). If a row somehow gets an invalid mode, the INSERT/UPDATE
-- fails at the DB layer.

ALTER TABLE "matters"
  ADD COLUMN IF NOT EXISTS "ai_access_mode" text NOT NULL DEFAULT 'off';
--> statement-breakpoint

ALTER TABLE "matters"
  ADD COLUMN IF NOT EXISTS "ai_access_committed_at" timestamp with time zone;
--> statement-breakpoint

-- CHECK constraint, separate ALTER so the column exists first.
-- Drop-if-exists then re-create so re-running this migration is safe.
ALTER TABLE "matters" DROP CONSTRAINT IF EXISTS "matters_ai_access_mode_check";
--> statement-breakpoint

ALTER TABLE "matters"
  ADD CONSTRAINT "matters_ai_access_mode_check"
  CHECK ("ai_access_mode" IN ('off', 'all', 'subset'));
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 2. files — AI access gates and Anthropic Files API tracking
-- ---------------------------------------------------------------------------
--
-- ai_blocked_by_user: boolean, default false.
--   When true, this file is ALWAYS excluded from Claude's view regardless
--   of the matter's ai_access_mode. Lawyer-driven privilege protection.
--   Set via the kebab menu on a file row. Shows a "Protected" badge.
--
-- ai_excluded_in_matter: boolean, default false.
--   Used when ai_access_mode = 'subset'. When true, this file is removed
--   from Claude's view for THIS matter only. Lawyer-driven scope reduction
--   within an otherwise-allowed matter.
--
--   Note: this column lives on files (not on a join table) because a file
--   belongs to exactly one matter — files.matter_id is single-valued. So
--   "excluded in this matter" and "excluded for the lawyer who owns this
--   file" are the same thing. No need for a (file_id, matter_id) join.
--
-- anthropic_file_id: text, nullable. Already added in Chunk 6's migration
--   but never populated. We populate it from /api/files-tool when Claude
--   first reads a file. Stored so we don't re-upload on subsequent reads.
--
-- anthropic_last_used_at: timestamp, nullable.
--   Set to now() every time we successfully use a file via Anthropic's
--   Files API (read or fresh upload). The design calls for 30-day TTL —
--   we record the timestamp now, defer the actual cron-based cleanup to
--   a later chunk. Anthropic's own retention policies will catch some of
--   this in the meantime.

ALTER TABLE "files"
  ADD COLUMN IF NOT EXISTS "ai_blocked_by_user" boolean NOT NULL DEFAULT false;
--> statement-breakpoint

ALTER TABLE "files"
  ADD COLUMN IF NOT EXISTS "ai_excluded_in_matter" boolean NOT NULL DEFAULT false;
--> statement-breakpoint

ALTER TABLE "files"
  ADD COLUMN IF NOT EXISTS "anthropic_last_used_at" timestamp with time zone;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 3. Indexes for the hot path
-- ---------------------------------------------------------------------------
--
-- The hot read path is: "list files for this matter that Claude can see."
-- That's:
--   WHERE matter_id = ?
--     AND deleted_at IS NULL
--     AND ai_readable = true              (from Chunk 6, page-count limit)
--     AND ai_blocked_by_user = false      (new in Chunk 7)
--     AND ai_excluded_in_matter = false   (new in Chunk 7 — only checked
--                                         when ai_access_mode = 'subset',
--                                         but we always filter for safety)
--
-- The existing files_matter_id_deleted_at_idx from Chunk 6 covers most of
-- this, but adding a partial index on the AI-relevant columns helps when
-- a matter has many files. Partial indexes are small (only the rows
-- matching the WHERE clause) so cheap to maintain.

CREATE INDEX IF NOT EXISTS "files_ai_readable_partial_idx"
  ON "files" ("matter_id")
  WHERE "deleted_at" IS NULL
    AND "ai_readable" = true
    AND "ai_blocked_by_user" = false
    AND "ai_excluded_in_matter" = false;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 4. RLS — no policy changes needed
-- ---------------------------------------------------------------------------
--
-- The existing RLS policies on `matters` and `files` (auth.uid() = user_id
-- gates) cover the new columns automatically. New columns are part of the
-- row; the row-level policy is already applied.
--
-- The new gates (ai_blocked_by_user, ai_excluded_in_matter) are CONTENT
-- filters, not OWNERSHIP filters. Ownership stays at the RLS layer. The
-- new gates are enforced application-side in lib/db/queries/ai-access.ts
-- and the files-tool route handler.
