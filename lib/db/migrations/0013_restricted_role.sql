-- 0013_restricted_role.sql
-- ============================================================================
-- STEP 1 of real RLS (Path A): create the restricted application role that
-- Drizzle will eventually connect as. This role does NOT bypass RLS, so
-- policies actually govern it.
--
-- THIS DOES NOT CHANGE HOW THE APP CONNECTS. The role is created and granted
-- here, but DATABASE_URL still points at `postgres` (BYPASSRLS) until the
-- explicit cutover step much later. Creating this role changes no runtime
-- behaviour — it just sits ready.
--
-- The password here will appear in chat/repo history; it is to be ROTATED in
-- the same pass as the exposed `postgres` password (see SECURITY.md). For now
-- it's a working secret to build + prove Path A against.
--
-- Idempotent-ish: guarded role creation; grants are safe to re-run.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- The role. NOBYPASSRLS is the whole point — RLS must apply to it.
-- Guarded create so re-running doesn't error on "role already exists".
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'briefbridge_app') THEN
    CREATE ROLE briefbridge_app LOGIN PASSWORD 'bbApp_7Kq2mNvX9pLrZ4wTjF8sHdY3eUcG6' NOBYPASSRLS;
  END IF;
END
$$;

-- ----------------------------------------------------------------------------
-- Schema usage — without this the role can't see anything in public at all.
-- ----------------------------------------------------------------------------
GRANT USAGE ON SCHEMA public TO briefbridge_app;

-- ----------------------------------------------------------------------------
-- READ access to every table the app reads.
--
-- Public reference data (read-only for the app): judgments, embeddings,
-- legislation, etc. The app never writes these (ingestion uses the service
-- role), so SELECT only.
-- ----------------------------------------------------------------------------
GRANT SELECT ON judgments TO briefbridge_app;
GRANT SELECT ON judgment_embeddings TO briefbridge_app;
GRANT SELECT ON ingestion_attempts TO briefbridge_app;
GRANT SELECT ON legislation TO briefbridge_app;
GRANT SELECT ON legislation_sections TO briefbridge_app;
GRANT SELECT ON legislation_section_embeddings TO briefbridge_app;

-- ----------------------------------------------------------------------------
-- READ + WRITE access to the user-data tables the app mutates.
-- RLS policies (added in later steps) decide WHICH rows; these GRANTs decide
-- the role is allowed to attempt the operation at all. Both are required:
-- a GRANT without a matching policy still yields zero rows (deny), which is
-- the safe failure direction.
-- ----------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON profiles TO briefbridge_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON matters TO briefbridge_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON conversations TO briefbridge_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON messages TO briefbridge_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON files TO briefbridge_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON file_tags TO briefbridge_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON firms TO briefbridge_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON firm_memberships TO briefbridge_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON matter_assignments TO briefbridge_app;

-- ----------------------------------------------------------------------------
-- Sequences — INSERTs that rely on a sequence-backed default need USAGE on
-- the sequence. Most of these tables use uuid defaults (gen_random_uuid),
-- not sequences, but granting USAGE on all sequences is harmless and avoids
-- a surprise if any table (now or later) uses one.
-- ----------------------------------------------------------------------------
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO briefbridge_app;

-- ============================================================================
-- NOTE: still no connection change. After this runs, the role exists and can
-- read public reference data, but every user-data query yields ZERO rows
-- (RLS deny — no session-variable policies yet). That's expected. The next
-- step adds the session-variable policies, then we prove it in isolation,
-- THEN switch the connection. See SECURITY.md.
-- ============================================================================