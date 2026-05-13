-- =============================================================================
-- 0007_legislation.sql — Chunk 8: Commonwealth statutes + legislation corpus
-- =============================================================================
--
-- Same hand-written pattern as 0004, 0005, 0006 — drizzle-kit's TS generator
-- doesn't ergonomically support our CHECK constraints + we want full control
-- over the ALTER TABLE order so dev DBs don't end up half-migrated if
-- something fails partway.
--
-- =============================================================================
-- IMPORTANT — Apply this migration carefully
-- =============================================================================
--
-- If `npm run db:migrate` doesn't report `[✓] 0007_legislation done!`, apply
-- this SQL manually via the Supabase SQL editor (statements are idempotent
-- via IF NOT EXISTS / IF EXISTS clauses), then INSERT a row into
-- drizzle.__drizzle_migrations manually. See Chunk 6 README §10 for the
-- recipe.
--
-- =============================================================================
-- DESIGN OVERVIEW
-- =============================================================================
--
-- Three new tables. NO RLS — legislation is public reference data, every
-- user reads the same corpus. No user_id columns, no row-level policies.
-- This is intentional and important.
--
-- 1. legislation
--    One row per Act / Regulation / Constitution. Header record with
--    metadata, source URL, attribution. Natural key is
--    (jurisdiction, registration_id) — using the official permanent ID
--    from the Federal Register makes re-ingestion idempotent.
--
-- 2. legislation_sections
--    The hierarchical content tree. One row per Part / Division /
--    Subdivision / Section / Subsection / Schedule. Self-referencing via
--    parent_section_id. Section text lives here; pre-computed citation
--    and breadcrumb columns avoid downstream drift.
--
-- 3. legislation_section_embeddings
--    Voyage-law-2 1024-dim vectors. Separate table from sections so
--    section scans stay cheap. HNSW index matches the judgment_embeddings
--    pattern from Chunk 2.
--
-- =============================================================================
-- DEFERRED TO LATER CHUNKS (intentionally not in this schema)
-- =============================================================================
--
-- - Point-in-time versioning. Future migration adds legislation_compilations
--   (one row per compilation) and sections.compilation_id FK. For now,
--   legislation.compilation_date is "the current compilation we have".
-- - Cross-references between sections (s 6 -> "see s 5A").
-- - Definitions registry.
-- - Amending history endnotes parsing.
--
-- ---------------------------------------------------------------------------
-- 1. legislation — one row per Act / Regulation / Constitution
-- ---------------------------------------------------------------------------
--
-- jurisdiction:
--   'commonwealth' for Chunk 8. Future expansion: 'nsw', 'vic', 'qld',
--   'wa', 'sa', 'tas', 'act', 'nt'. CHECK constraint allows all up front
--   so adding state Acts later doesn't require a migration.
--
-- kind:
--   Discriminator for what KIND of legislation this is. Lets all four
--   corpus types share the same tables without splitting.
--     'act'                    — principal Act (the standalone law)
--     'regulation'             — delegated/subordinate legislation
--     'legislative_instrument' — Commonwealth-specific subset
--     'constitution'           — 9 documents across Australia
--
-- registration_id:
--   The official permanent ID from the Federal Register
--   (e.g. 'C2004A03712' for Privacy Act 1988). Natural key for
--   idempotent re-ingestion. UNIQUE per jurisdiction.
--
-- citation:
--   Pre-computed AGLC4 citation form (e.g. 'Privacy Act 1988 (Cth)').
--   Stored at ingest time so downstream display reads the same string
--   everywhere. Citation drift = trust loss.
--
-- compilation_date / compilation_number:
--   The version of the law we have. For v1, only current compilations.
--   When point-in-time arrives, this becomes the "currently active
--   compilation" pointer.
--
-- next_amendment_date:
--   If the Federal Register knows an amendment is commencing soon, this
--   date tells future cron jobs when to re-ingest.
--
-- source_url:
--   The actual URL we fetched. Used in attribution and for refresh.
--
-- attribution_text:
--   Pre-formatted attribution per the source's licence (CC BY 4.0 for
--   legislation.gov.au). Required whenever displaying content from this
--   Act. Computed at ingest, stored once.
--
-- in_force / repealed_at:
--   Acts can be repealed between ingestions. We keep the row + sections
--   for citation resolution (lawyers cite repealed Acts in historical
--   research) but flag the status.

CREATE TABLE IF NOT EXISTS "legislation" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "registration_id" text NOT NULL,
  "jurisdiction" text NOT NULL,
  "kind" text NOT NULL,
  "short_title" text NOT NULL,
  "long_title" text,
  "year" smallint,
  "number" smallint,
  "citation" text NOT NULL,
  "compilation_date" date NOT NULL,
  "compilation_number" smallint,
  "next_amendment_date" date,
  "source_url" text NOT NULL,
  "attribution_text" text NOT NULL,
  "retrieved_at" timestamp with time zone NOT NULL DEFAULT now(),
  "in_force" boolean NOT NULL DEFAULT true,
  "repealed_at" date,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint

-- Drop-if-exists then re-create so re-running this migration is safe.
ALTER TABLE "legislation" DROP CONSTRAINT IF EXISTS "legislation_jurisdiction_check";
--> statement-breakpoint

ALTER TABLE "legislation"
  ADD CONSTRAINT "legislation_jurisdiction_check"
  CHECK ("jurisdiction" IN (
    'commonwealth', 'nsw', 'vic', 'qld', 'wa', 'sa', 'tas', 'act', 'nt'
  ));
--> statement-breakpoint

ALTER TABLE "legislation" DROP CONSTRAINT IF EXISTS "legislation_kind_check";
--> statement-breakpoint

ALTER TABLE "legislation"
  ADD CONSTRAINT "legislation_kind_check"
  CHECK ("kind" IN (
    'act', 'regulation', 'legislative_instrument', 'constitution'
  ));
--> statement-breakpoint

-- Natural key for re-ingestion idempotency. Same registration_id can
-- exist across jurisdictions theoretically (in practice unlikely) so
-- we scope uniqueness by jurisdiction.
CREATE UNIQUE INDEX IF NOT EXISTS "legislation_jurisdiction_registration_idx"
  ON "legislation" ("jurisdiction", "registration_id");
--> statement-breakpoint

-- Hot read path: "show me all in-force Acts in this jurisdiction".
CREATE INDEX IF NOT EXISTS "legislation_jurisdiction_kind_idx"
  ON "legislation" ("jurisdiction", "kind")
  WHERE "in_force" = true;
--> statement-breakpoint

-- Fuzzy title search: "find Acts whose name contains 'privacy'".
-- Requires the pg_trgm extension (likely already enabled; the
-- CREATE EXTENSION statement below is idempotent).
CREATE EXTENSION IF NOT EXISTS "pg_trgm";
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "legislation_short_title_trgm_idx"
  ON "legislation" USING gin ("short_title" gin_trgm_ops);
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 2. legislation_sections — hierarchical content tree
-- ---------------------------------------------------------------------------
--
-- legislation_id:
--   FK to the parent Act/Reg/Constitution row. CASCADE delete: if an Act
--   is hard-deleted (rare; we usually mark not-in-force instead), all its
--   sections go too.
--
-- parent_section_id:
--   Self-reference for the tree. NULL = top-level child of the Act.
--   Example tree for Privacy Act 1988:
--     Part II (parent_section_id = NULL)
--       Division 1 (parent_section_id = Part II's id)
--         s 6 (parent_section_id = Division 1's id)
--           (1) (parent_section_id = s 6's id)
--             (a) (parent_section_id = (1)'s id)
--
-- level:
--   What KIND of node this is. Determines display + aggregation.
--   CHECK constraint lists all valid levels; allows the parser to
--   handle Acts that don't use every level (some have no Chapters,
--   some have no Subdivisions).
--
-- number:
--   The number/letter portion. TEXT not INTEGER because '6AA', '20ZA',
--   '6BIS' are all real Australian section identifiers. For subsections
--   stored as '(1)', '(2)(a)', '(3)(b)(ii)'.
--
-- heading:
--   The heading text. NULL for subsection-level rows (which don't have
--   headings). Empty string would lie about structure; NULL says "no
--   heading by design".
--
-- text:
--   The actual content. NOT NULL DEFAULT '' because structural nodes
--   (Parts, Divisions) often have no body text — they're navigation,
--   not content. Empty string > NULL for code that concatenates.
--
-- citation:
--   Pre-computed AGLC4-style citation for THIS specific row.
--   Examples:
--     'Privacy Act 1988 (Cth) Pt II'
--     'Privacy Act 1988 (Cth) s 6'
--     'Privacy Act 1988 (Cth) s 6(1)(a)'
--   Stored so Claude's quotes always read the same string. This is what
--   appears in inline citations.
--
-- breadcrumb:
--   Human-readable path from root for UI display. Newline-or-arrow-
--   separated.
--   Example: 'Part II > Division 1 > s 6'
--
-- path:
--   Materialized path for fast subtree queries without recursive CTEs.
--   Each segment is a short slug.
--   Example: 'part_2.division_1.section_6'
--   LTREE would be more powerful but TEXT with btree is portable + fast
--   at this scale (~10k rows total across the corpus).
--
-- sort_order:
--   Sort within THIS parent. Sections aren't lexically sortable
--   ('6AA' belongs between '6A' and '7'), so the parser assigns
--   sort_order sequentially as it reads top-to-bottom. Display always
--   uses sort_order, never number.
--
-- embedded_at:
--   Mirrors the judgment_embeddings pattern. NULL means not yet embedded;
--   the embedding worker uses this to find unembedded rows and resume
--   cleanly after failures.

CREATE TABLE IF NOT EXISTS "legislation_sections" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "legislation_id" uuid NOT NULL,
  "parent_section_id" uuid,
  "level" text NOT NULL,
  "number" text NOT NULL,
  "heading" text,
  "text" text NOT NULL DEFAULT '',
  "citation" text NOT NULL,
  "breadcrumb" text NOT NULL,
  "path" text NOT NULL,
  "sort_order" integer NOT NULL,
  "embedded_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint

-- FK to parent Act. CASCADE so deleting an Act cleans up its sections.
ALTER TABLE "legislation_sections"
  ADD CONSTRAINT "legislation_sections_legislation_id_fk"
  FOREIGN KEY ("legislation_id") REFERENCES "legislation"("id") ON DELETE CASCADE;
--> statement-breakpoint

-- Self-reference for the tree. CASCADE so deleting a Part removes its
-- Divisions, which remove their Sections, etc.
ALTER TABLE "legislation_sections"
  ADD CONSTRAINT "legislation_sections_parent_fk"
  FOREIGN KEY ("parent_section_id") REFERENCES "legislation_sections"("id") ON DELETE CASCADE;
--> statement-breakpoint

-- Level CHECK. Drop-then-add for re-runnability.
ALTER TABLE "legislation_sections" DROP CONSTRAINT IF EXISTS "legislation_sections_level_check";
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
    'schedule_part'
  ));
--> statement-breakpoint

-- Most common query: "give me all sections of this Act in order".
CREATE INDEX IF NOT EXISTS "legislation_sections_legislation_sort_idx"
  ON "legislation_sections" ("legislation_id", "sort_order");
--> statement-breakpoint

-- Tree traversal: "give me children of this Part".
CREATE INDEX IF NOT EXISTS "legislation_sections_parent_idx"
  ON "legislation_sections" ("parent_section_id")
  WHERE "parent_section_id" IS NOT NULL;
--> statement-breakpoint

-- Subtree queries via materialized path: "all sections under Part II".
CREATE INDEX IF NOT EXISTS "legislation_sections_path_idx"
  ON "legislation_sections" ("legislation_id", "path");
--> statement-breakpoint

-- Direct citation lookup: "find me 'Privacy Act 1988 (Cth) s 6'".
-- Common path for cross-reference resolution + explicit lawyer queries.
CREATE INDEX IF NOT EXISTS "legislation_sections_citation_idx"
  ON "legislation_sections" ("citation");
--> statement-breakpoint

-- Embedding worker finds unembedded rows here.
CREATE INDEX IF NOT EXISTS "legislation_sections_unembedded_idx"
  ON "legislation_sections" ("id")
  WHERE "embedded_at" IS NULL;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 3. legislation_section_embeddings — voyage-law-2 vectors
-- ---------------------------------------------------------------------------
--
-- Separate from legislation_sections because the 1024-dim vector at 4
-- bytes per component = 4KB per row. At ~10k sections that's 40MB just
-- on embedding data. Keeping it separate means scans on the sections
-- table stay fast for non-search queries.
--
-- section_id is the primary key (not a separate UUID) — one embedding
-- per section, FK enforces it.
--
-- embedded_text:
--   The text actually fed to Voyage. Often slightly more than just
--   section.text — we prepend the breadcrumb + heading for semantic
--   richness. Example:
--     'Privacy Act 1988 (Cth) > Part II > Division 1 > s 6 Interpretation
--      In this Act: APP entity means an agency or organisation...'
--   Without breadcrumb enrichment, a query like 'tax file number rules'
--   would miss s 17 of the Privacy Act because the section text alone
--   doesn't repeat the Part III "Information privacy" context.
--   Storing the actual embedded text means we can debug retrieval and
--   re-embed deterministically.
--
-- model:
--   Lets us migrate to a newer Voyage model later without confusion.
--   Mirrors judgment_embeddings.model from Chunk 2.

CREATE TABLE IF NOT EXISTS "legislation_section_embeddings" (
  "section_id" uuid PRIMARY KEY,
  "embedded_text" text NOT NULL,
  "model" text NOT NULL,
  "embedding" vector(1024) NOT NULL,
  "embedded_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint

-- FK to sections. CASCADE so deleting a section removes its embedding.
ALTER TABLE "legislation_section_embeddings"
  ADD CONSTRAINT "legislation_section_embeddings_section_id_fk"
  FOREIGN KEY ("section_id") REFERENCES "legislation_sections"("id") ON DELETE CASCADE;
--> statement-breakpoint

-- HNSW index matching judgment_embeddings from Chunk 2. Same operator
-- class (vector_cosine_ops) so search code uses the same cosine-similarity
-- pattern across both corpora. Default HNSW parameters (m=16,
-- ef_construction=64) match Postgres defaults and what judgments uses.
CREATE INDEX IF NOT EXISTS "legislation_section_embeddings_embedding_idx"
  ON "legislation_section_embeddings"
  USING hnsw ("embedding" vector_cosine_ops);
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 4. NO RLS — legislation is public reference data
-- ---------------------------------------------------------------------------
--
-- Unlike user files, legislation is shared across every user. No user_id
-- columns, no row-level policies. Every authenticated user reads from
-- the same rows. This is intentional and important.
--
-- Drizzle's client uses the service role for inserts (ingestion script)
-- and the authenticated role for reads (chat RAG queries). Reads are
-- unauthorized-fail at the Supabase-Auth level via the API key; row-level
-- access is uniform.