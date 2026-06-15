-- =============================================================================
-- 0009_conversation_files.sql — allow files to attach to a conversation
-- =============================================================================
--
-- Standalone-chat file attachment (the "add a document into /chat" feature).
--
-- Until now, every `files` row required a `matter_id` (NOT NULL). Files
-- only existed inside matters. This migration lets a file instead belong
-- to a *conversation* — so a one-off /chat (which has no matter) can carry
-- attached documents that Claude reads.
--
-- ---------------------------------------------------------------------------
-- What this does (three statements, all additive / reversible)
-- ---------------------------------------------------------------------------
--
--   1. files.matter_id  →  drop NOT NULL.
--      A file now belongs to EITHER a matter (matter_id set, conversation_id
--      null) OR a conversation (conversation_id set, matter_id null).
--      Existing rows are untouched — they all have matter_id set and remain
--      valid. Relaxing NOT NULL never loses or alters data; it only permits
--      nulls going forward.
--
--   2. Add files.conversation_id (uuid, nullable).
--      Where standalone-chat files hang. Nullable, no default, no backfill.
--      Every existing row gets NULL here, which is correct (they're all
--      matter files).
--
--   3. Add an index on (user_id, conversation_id) for the standalone-chat
--      file-listing hot path, mirroring the existing
--      files_user_id_matter_id_idx.
--
-- ---------------------------------------------------------------------------
-- Deliberately NOT done: a CHECK constraint
-- ---------------------------------------------------------------------------
--
-- The "textbook correct" guard would be a CHECK enforcing that EXACTLY ONE
-- of (matter_id, conversation_id) is non-null. We are intentionally NOT
-- adding it here, for two reasons:
--
--   (a) Adding a CHECK constraint validates every existing row at creation
--       time. On a production table that's a small but real risk surface —
--       if any row unexpectedly violated it, the migration would fail
--       partway. Keeping this migration purely additive (no validation
--       pass over existing data) makes it as safe as a migration gets.
--
--   (b) The "exactly one of" invariant is enforced in the application layer
--       instead — the conversation-scoped query/action code only ever sets
--       conversation_id (with matter_id null), and the matter code only ever
--       sets matter_id (with conversation_id null). That's where it's
--       testable and where a violation would actually originate.
--
-- If we later want the DB-level guard, it can be added in its own migration
-- once we're confident all rows comply.
--
-- ---------------------------------------------------------------------------
-- Rollback (if ever needed)
-- ---------------------------------------------------------------------------
--
--   DROP INDEX IF EXISTS "files_user_id_conversation_id_idx";
--   ALTER TABLE "files" DROP COLUMN IF EXISTS "conversation_id";
--   -- Re-adding NOT NULL to matter_id would require every row to have a
--   -- matter_id. Only safe to do BEFORE any conversation-files exist.
--   -- ALTER TABLE "files" ALTER COLUMN "matter_id" SET NOT NULL;
--
-- =============================================================================

ALTER TABLE "files"
  ALTER COLUMN "matter_id" DROP NOT NULL;
--> statement-breakpoint

ALTER TABLE "files"
  ADD COLUMN "conversation_id" uuid;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "files_user_id_conversation_id_idx"
  ON "files" ("user_id", "conversation_id");