// lib/db/schema.ts
//
// What changed (additions only — existing tables untouched):
//   1. Added `vector` import from drizzle-orm/pg-core
//   2. Added `sql` import for raw SQL inside index expressions
//   3. New `judgmentEmbeddings` table (paragraph-level vectors)
//
// CHUNK 3 ADDITIONS (auth + persistence):
//   4. `pgSchema` import to reference auth.users for type-safety
//   5. Type-only reference to auth.users (NOT a real Drizzle table — see below)
//   6. profiles, matters, conversations, messages tables
//
// CHUNK 3 POST-LANDING FIX (TS narrowing for status):
//   7. MatterStatus union defined here as the single source of truth.
//      mock-matters.ts re-exports it. lib/db/queries/matters.ts imports it
//      from here too.
//   8. matters.status column uses $type<MatterStatus>() to override Drizzle's
//      default `string` inference. Runtime is unchanged (still text + CHECK
//      constraint in the DB); only the TS-level type narrows.
//
// CHUNK 6 ADDITIONS (files foundation):
//   9. `primaryKey` import for the composite PK on file_tags
//  10. files table — per-matter user file storage, soft-delete via deleted_at
//  11. fileTags table — many-to-many tags on files, composite PK (file_id, tag)
//
// The pgvector extension itself is enabled via the migration's
// `CREATE EXTENSION IF NOT EXISTS vector;` statement. Drizzle's
// generator should add this automatically when it detects the
// vector column type, but we'll verify after generation.
//
// =============================================================================
// IMPORTANT — Why the new tables have NO references() in this file
// =============================================================================
//
// The new tables (matters, conversations, messages, files, file_tags) all
// have foreign keys in the database — to auth.users, to matters, to
// conversations, to files. BUT, none of those FKs are declared via
// Drizzle's `references()` helper here. They exist purely as raw SQL in
// the migration (0004_auth_persistence.sql, 0005_files.sql).
//
// Why? Two reasons:
//
//   1. Drizzle 0.45 + drizzle-kit 0.31 don't ergonomically support FKs into
//      a schema that's also being excluded via `schemaFilter` (which we use
//      to keep drizzle-kit away from the Supabase-owned `auth` schema). If
//      we declared `references(authUsers.id, { onDelete: 'cascade' })`,
//      drizzle-kit would either:
//        (a) error during `db:generate` because auth is filtered out, or
//        (b) silently drop the FK from the snapshot, leading to spurious
//            ALTER TABLE statements on future generates.
//
//   2. The migration is hand-written anyway (we needed raw SQL for the
//      trigger and RLS policies). Putting the FKs in the same raw SQL
//      keeps all DB constraints in one source-of-truth file.
//
// The tradeoff: app code can't use Drizzle's auto-join via .with() for these
// relationships. We just write explicit `where(eq(x.user_id, userId))`
// clauses, which we'd do anyway for safety.
//
// =============================================================================

import {
  pgTable,
  pgSchema,
  uuid,
  text,
  date,
  timestamp,
  boolean,
  jsonb,
  integer,
  index,
  uniqueIndex,
  vector,
  primaryKey,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

// -----------------------------------------------------------------------------
// auth.users — TYPE-ONLY REFERENCE
// -----------------------------------------------------------------------------
//
// This is NOT a table we create or own — it's owned by Supabase Auth.
// Declaring it here gives us a typed handle for IDE autocomplete in case
// we ever want to read from it via Drizzle (e.g. for an admin tool).
//
// drizzle-kit will IGNORE this declaration because:
//   - schemaFilter: ['public'] in drizzle.config.ts filters out non-public schemas
//   - even if it weren't filtered, the table already exists in Supabase's
//     auth schema and we never want to generate migrations for it
//
// CRITICAL: never remove `schemaFilter: ['public']` from drizzle.config.ts
// without also removing this declaration. The combination is what keeps
// drizzle-kit from trying to manage Supabase's auth schema.
//
const authSchema = pgSchema('auth');
export const authUsers = authSchema.table('users', {
  id: uuid('id').primaryKey(),
  // Other columns exist in auth.users (email, encrypted_password, etc.) but
  // we don't need them for type safety in the app layer. The middleware
  // and server actions read user data via supabase.auth.getUser(), not via
  // Drizzle queries against this table.
});

/**
 * Judgments table — the core data store.
 *
 * Schema design notes (post-real-HTML inspection):
 * - source_url is the unique key — every NSW Caselaw decision has a stable URL of the
 *   form /decision/<24-char-hex-id>.
 * - paragraphs is stored as a JSONB array of { number, text } objects rather than as
 *   plain text. Australian judgments are always cited by paragraph number (e.g. "[11]")
 *   so preserving paragraph numbering is critical for our RAG layer to give lawyers
 *   verifiable citations.
 * - cases_cited and legislation_cited are stored as separate columns because NSW
 *   Caselaw provides them as already-parsed coversheet fields. This gives us a free
 *   citation graph — no NLP needed.
 * - content_hash detects when a judgment is amended (NSW terms require us to stay
 *   consistent with the current official version).
 * - publication_restriction stores the literal value from the page ("Nil", or the
 *   actual restriction text if one applies).
 *
 * Search index (for full-text search):
 * - searchVectorIdx: a GIN index over a tsvector built from case_name, citation,
 *   catchwords, and full_text.
 */
export const judgments = pgTable(
  'judgments',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    // Source attribution (compliance requirement)
    source: text('source').notNull(), // 'nsw_caselaw' | 'fedcourt' | 'hca' | etc.
    sourceUrl: text('source_url').notNull(),
    sourceId: text('source_id'), // the hex id from the URL, useful for re-fetching

    // Citation metadata
    citation: text('citation'), // Medium Neutral Citation, e.g. '[2026] NSWSC 474'
    caseName: text('case_name'),
    court: text('court'), // e.g. 'Supreme Court of NSW'
    jurisdiction: text('jurisdiction'), // e.g. 'Equity - Expedition List'
    decisionDate: date('decision_date'),
    hearingDates: text('hearing_dates'),
    judges: text('judges').array(), // ['Parker J', 'Bell CJ']
    parties: jsonb('parties'), // structured parties block
    representation: jsonb('representation'), // counsel + solicitors
    fileNumbers: text('file_numbers').array(),
    category: text('category'), // e.g. 'Costs'
    catchwords: text('catchwords'), // legal topic summary
    decisionSummary: text('decision_summary'), // the "Decision:" field from coversheet

    // Citation graph (parsed from coversheet — no NLP needed)
    casesCited: jsonb('cases_cited'), // [{ name, citation }]
    legislationCited: jsonb('legislation_cited'), // [{ title, sections }]

    // Content
    paragraphs: jsonb('paragraphs').notNull(), // [{ number, text, heading? }]
    fullText: text('full_text').notNull(), // flattened for FTS / embeddings
    paragraphCount: integer('paragraph_count').notNull(),
    rawHtml: text('raw_html'), // insurance for re-parsing

    // Compliance & integrity
    publicationRestriction: text('publication_restriction'), // 'Nil' or actual restriction text
    suppressionFlag: boolean('suppression_flag').notNull().default(false),
    contentHash: text('content_hash').notNull(), // SHA-256 of fullText

    // Audit trail
    ingestedAt: timestamp('ingested_at', { withTimezone: true }).notNull().defaultNow(),
    lastCheckedAt: timestamp('last_checked_at', { withTimezone: true }).notNull().defaultNow(),
    decisionLastUpdated: date('decision_last_updated'), // from the page's "Decision last updated:" footer
  },
  (t) => ({
    sourceUrlIdx: uniqueIndex('judgments_source_url_idx').on(t.sourceUrl),
    citationIdx: index('judgments_citation_idx').on(t.citation),
    decisionDateIdx: index('judgments_decision_date_idx').on(t.decisionDate),
    sourceIdx: index('judgments_source_idx').on(t.source),
    searchVectorIdx: index('judgments_search_vector_idx')
      .using(
        'gin',
        sql`(
          setweight(to_tsvector('english', coalesce(${t.caseName}, '')), 'A') ||
          setweight(to_tsvector('english', coalesce(${t.citation}, '')), 'A') ||
          setweight(to_tsvector('english', coalesce(${t.catchwords}, '')), 'B') ||
          setweight(to_tsvector('english', coalesce(${t.fullText}, '')), 'C')
        )`,
      ),
  }),
);

export type Judgment = typeof judgments.$inferSelect;
export type NewJudgment = typeof judgments.$inferInsert;

/**
 * Ingestion attempts — tracks every URL we've tried to ingest, regardless of outcome.
 */
export const ingestionAttempts = pgTable(
  'ingestion_attempts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sourceUrl: text('source_url').notNull(),
    status: text('status', { enum: ['success', 'failed', 'skipped'] }).notNull(),
    attemptedAt: timestamp('attempted_at', { withTimezone: true }).notNull().defaultNow(),
    errorMessage: text('error_message'),
    httpStatus: integer('http_status'),
    durationMs: integer('duration_ms'),
  },
  (t) => ({
    sourceUrlIdx: index('ingestion_attempts_source_url_idx').on(t.sourceUrl),
    attemptedAtIdx: index('ingestion_attempts_attempted_at_idx').on(t.attemptedAt),
  }),
);

export type IngestionAttempt = typeof ingestionAttempts.$inferSelect;
export type NewIngestionAttempt = typeof ingestionAttempts.$inferInsert;

/**
 * Judgment embeddings — paragraph-level vectors used for semantic search.
 *
 * Why paragraph-level, not document-level:
 *   - A 200-paragraph judgment talks about many things. Averaging into one vector
 *     loses precision. Paragraph-level lets us return *the specific paragraph*
 *     that's relevant to a lawyer's query.
 *   - Lawyers cite paragraph numbers ("[11]"). When we serve results, we can
 *     return "Smith v Jones [2024] NSWSC 100 at [42]" — directly citable.
 *
 * Why a separate table (not a column on judgments):
 *   - Embeddings are a different concern with different update cadence. A judgment
 *     may have its embeddings regenerated (e.g. switching to a better model) without
 *     touching the source data.
 *   - One judgment → many embedding rows (one per paragraph). Can't model that
 *     with a column.
 *   - Cleaner CASCADE: if a judgment is deleted, its embeddings go with it.
 *
 * Vector dimension 1024 is voyage-law-2's output size (their legal-domain model).
 * If we ever switch models, we'll regenerate everything.
 *
 * The HNSW index uses cosine distance, which matches how we'll query
 * (Voyage embeddings are normalised, so cosine = dot product, fastest option).
 */
export const judgmentEmbeddings = pgTable(
  'judgment_embeddings',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    // Foreign key to the judgment this paragraph belongs to.
    // ON DELETE CASCADE is added in the migration — drizzle doesn't yet have
    // ergonomic FK declaration with CASCADE in its TS API.
    judgmentId: uuid('judgment_id').notNull(),

    // The paragraph number as stored in the judgment, e.g. "11" or "23(1)".
    // This is text not int because some paragraphs have sub-parts like "23(1)".
    paragraphNumber: text('paragraph_number').notNull(),

    // 0-indexed position of this paragraph within the judgment's paragraphs array.
    // Used to look up the original paragraph data when displaying results.
    paragraphIndex: integer('paragraph_index').notNull(),

    // The actual text that was embedded. We store this for two reasons:
    //   1. We can show snippets in search results without re-fetching the JSONB
    //      array (faster query response).
    //   2. If we change embedding strategies (e.g. add surrounding context), we
    //      can see what was actually embedded.
    paragraphText: text('paragraph_text').notNull(),

    // Voyage AI's voyage-law-2 model produces 1024-dimensional vectors.
    embedding: vector('embedding', { dimensions: 1024 }).notNull(),

    // Which model produced this embedding. If we ever swap models, we filter
    // queries by this field and regenerate. Voyage names like 'voyage-law-2'.
    model: text('model').notNull(),

    // Timestamp for auditing and cache invalidation.
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    judgmentIdIdx: index('judgment_embeddings_judgment_id_idx').on(t.judgmentId),

    // HNSW index for fast approximate nearest neighbour search.
    // vector_cosine_ops because Voyage normalises its outputs.
    embeddingIdx: index('judgment_embeddings_embedding_idx').using(
      'hnsw',
      sql`${t.embedding} vector_cosine_ops`,
    ),
  }),
);

export type JudgmentEmbedding = typeof judgmentEmbeddings.$inferSelect;
export type NewJudgmentEmbedding = typeof judgmentEmbeddings.$inferInsert;

// =============================================================================
// === CHUNK 3 ADDITIONS — AUTH + PERSISTENCE ==================================
// =============================================================================
//
// Everything below this line was added in Chunk 3. The tables above are
// unchanged from Chunk 2.
//
// All four tables use raw-SQL FK constraints (see the migration file).
// drizzle-kit will see them as standalone tables with no foreign keys.
// The DB still enforces the FKs at the constraint level — Drizzle just
// doesn't know about them at the TS-type level.

// -----------------------------------------------------------------------------
// MatterStatus — single source of truth
// -----------------------------------------------------------------------------
//
// The 6 allowed values for matters.status. This union is the canonical
// type definition used in three places:
//
//   1. Here — narrows the inferred type of matters.status (via $type<>).
//   2. mock-matters.ts re-exports this type so all UI imports keep working.
//   3. lib/db/queries/matters.ts imports it for the public API.
//
// If you change this list, you MUST also update:
//   a) MATTER_STATUSES / STATUS_LABELS / STATUS_DESCRIPTIONS in mock-matters.ts
//   b) The CHECK constraint in 0004_auth_persistence.sql (or a follow-on migration)
//   c) The VALID_STATUSES array in app/(app)/matters/_actions.ts
//
// Three sources, all must agree. Lint would catch the queries/actions; only
// runtime DB writes catch the CHECK; only humans catch the mock-matters
// constants. Hence the long comment.

export type MatterStatus =
  | 'active'
  | 'on-hold'
  | 'awaiting-client'
  | 'in-hearing'
  | 'settled'
  | 'closed';

/**
 * profiles — application-level user profile.
 *
 * One row per auth.users row. Auto-created via the on_auth_user_created
 * trigger in the migration; we never INSERT directly from the app.
 *
 * The id is BOTH the primary key AND a foreign key to auth.users(id).
 * The FK has ON DELETE CASCADE so deleting an auth user cascades through
 * everything they own.
 */
export const profiles = pgTable('profiles', {
  // id is both PK and FK to auth.users.id (FK declared in raw SQL).
  // No defaultRandom() — the id comes from auth.users.
  id: uuid('id').primaryKey(),
  fullName: text('full_name'),
  firmName: text('firm_name'),
  role: text('role'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type Profile = typeof profiles.$inferSelect;
export type NewProfile = typeof profiles.$inferInsert;

/**
 * matters — a user's case workspace.
 *
 * Soft-deleted via archived_at (NULL = active, non-NULL = archived).
 * The app's listMattersForUser() defaults to excluding archived matters
 * via `where(isNull(archived_at))`.
 *
 * status uses $type<MatterStatus>() to narrow Drizzle's inferred string
 * type to our 6-value union. The DB column is still text; the CHECK
 * constraint enforces validity at the DB level. This $type override is
 * purely a TS-side improvement — no runtime effect.
 */
export const matters = pgTable(
  'matters',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // FK to auth.users(id) with ON DELETE CASCADE — declared in raw SQL.
    userId: uuid('user_id').notNull(),
    name: text('name').notNull(),
    client: text('client'),
    description: text('description'),
    // $type<MatterStatus>() tells TS this is the narrow union; CHECK
    // constraint in the migration enforces validity at the DB level.
    status: text('status').$type<MatterStatus>().notNull().default('active'),
    notes: text('notes'),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userIdIdx: index('matters_user_id_idx').on(t.userId),
    userIdStatusIdx: index('matters_user_id_status_idx').on(t.userId, t.status),
    userIdArchivedAtIdx: index('matters_user_id_archived_at_idx').on(
      t.userId,
      t.archivedAt,
    ),
  }),
);

export type Matter = typeof matters.$inferSelect;
export type NewMatter = typeof matters.$inferInsert;

/**
 * conversations — chat threads.
 *
 * matter_id is NULLABLE:
 *   - NULL → standalone conversation (lives at /chat?conversationId=...)
 *   - non-NULL → conversation belongs to a matter, lives inside that matter's workspace
 *
 * user_id is duplicated here (rather than computed via matter.user_id) for:
 *   1. Standalone conversations have no matter, so we need user_id directly
 *   2. Simpler/faster RLS policies (no join needed)
 *   3. Direct "list all my conversations" queries
 */
export const conversations = pgTable(
  'conversations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // FK to auth.users(id) with ON DELETE CASCADE — declared in raw SQL.
    userId: uuid('user_id').notNull(),
    // FK to matters(id) with ON DELETE CASCADE — declared in raw SQL.
    // Nullable: NULL for standalone conversations.
    matterId: uuid('matter_id'),
    title: text('title'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userIdIdx: index('conversations_user_id_idx').on(t.userId),
    matterIdIdx: index('conversations_matter_id_idx').on(t.matterId),
  }),
);

export type Conversation = typeof conversations.$inferSelect;
export type NewConversation = typeof conversations.$inferInsert;

/**
 * messages — one row per chat message.
 *
 * No user_id column — access is mediated through the parent conversation.
 *
 * citations stores the FULL hit shape from semanticSearch():
 *   [{ index, judgmentId, caseName, citation, paragraphNumber, paragraphText, similarity }, ...]
 *
 * Why store the full hit (not just refs):
 *   - Hot path optimisation: loading a past conversation should be ONE query
 *   - Snapshot semantics: a 6-month-old research note should show what was
 *     true at the time it was written, not silently update if the judgment
 *     gets amended. This is a feature for a legal product, not a bug.
 *
 * The Citation interface here matches what /api/chat emits in its SSE
 * 'citations' event AND what app/(app)/chat/page.tsx renders. Keep them
 * in sync if any of those change.
 *
 * role uses $type to narrow Drizzle's string inference to the 2-value union
 * matching the DB CHECK constraint.
 */
export const messages = pgTable(
  'messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // FK to conversations(id) with ON DELETE CASCADE — declared in raw SQL.
    conversationId: uuid('conversation_id').notNull(),
    // CHECK constraint in raw SQL restricts to 'user' | 'assistant'.
    role: text('role').$type<'user' | 'assistant'>().notNull(),
    content: text('content').notNull(),
    // Nullable JSONB. Only assistant messages typically have citations;
    // user messages leave this as NULL.
    // $type narrows the inferred type to StoredCitation[].
    citations: jsonb('citations').$type<StoredCitation[]>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    conversationIdIdx: index('messages_conversation_id_idx').on(t.conversationId),
  }),
);

export type Message = typeof messages.$inferSelect;
export type NewMessage = typeof messages.$inferInsert;

/**
 * Citation — the shape stored in messages.citations[].
 *
 * Exported here so query helpers and API code share one definition.
 * Mirrors the SemanticSearchHit shape used in /api/chat, lifted from
 * lib/search/semantic.ts.
 */
export interface StoredCitation {
  index: number;
  judgmentId: string;
  caseName: string | null;
  citation: string | null;
  paragraphNumber: string;
  paragraphText: string;
  similarity: number;
}

// =============================================================================
// === CHUNK 6 ADDITIONS — FILES FOUNDATION ====================================
// =============================================================================
//
// Everything below this line was added in Chunk 6. The tables above are
// unchanged from Chunk 3.
//
// Same raw-SQL FK pattern as Chunk 3 — see 0005_files.sql for the actual
// FK constraints (files.user_id → auth.users.id, files.matter_id → matters.id,
// file_tags.file_id → files.id, all ON DELETE CASCADE).
//
// Sanitisation of filename and tag normalisation happen in the queries
// layer (lib/db/queries/files.ts), not in column definitions.

/**
 * files — uploaded user files attached to a matter.
 *
 * Soft-deleted via deleted_at (NULL = active, non-NULL = soft-deleted).
 * The active-file list queries filter on `deleted_at IS NULL`.
 *
 * user_id is denormalised onto this table (rather than derived from
 * matter_id) for the same reasons as conversations.user_id: simpler RLS,
 * faster direct queries.
 *
 * storage_path follows the convention {user_id}/{matter_id}/{file_id}{extension}.
 * The user_id prefix is what the storage RLS policy keys on (see
 * 0005_files.sql for storage.foldername(name)[1] = auth.uid()::text).
 *
 * anthropic_file_id is set lazily on first read (Chunk 7), NULL until then,
 * and cleared on soft-delete (with a matching DELETE call to Anthropic's
 * Files API). For Chunk 6 this column exists but stays NULL — the lazy-
 * upload-on-first-read flow is Chunk 7 territory.
 *
 * ai_readable is computed ONCE at upload time (in completeUpload) and
 * stored. Doesn't get recomputed per-read. Reasoning:
 *   - page_count doesn't change after upload
 *   - MIME type doesn't change after upload
 *   - The answer is stable; recomputing would be wasteful
 *
 * Default true for ai_readable: optimistic — if page count extraction
 * fails (corrupted PDF), we set it true anyway and let Chunk 7's actual
 * read attempt fail-and-surface a friendly error rather than blocking
 * upload over a maybe-fake reason.
 */
export const files = pgTable(
  'files',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // FK to auth.users(id) with ON DELETE CASCADE — declared in raw SQL.
    userId: uuid('user_id').notNull(),
    // FK to matters(id) with ON DELETE CASCADE — declared in raw SQL.
    matterId: uuid('matter_id').notNull(),
    // The lawyer's original filename, sanitised at the queries layer
    // (control-char strip, 255-char cap). Preserves spaces, unicode,
    // parens, em-dashes. Never used as a storage path.
    filename: text('filename').notNull(),
    // {user_id}/{matter_id}/{file_id}{extension}.
    storagePath: text('storage_path').notNull(),
    mimeType: text('mime_type').notNull(),
    // Bytes. Used for quota math (SUM(file_size) WHERE deleted_at IS NULL).
    fileSize: integer('file_size').notNull(),
    // PDFs only. NULL for non-PDFs (TXT, DOCX). NULL also if extraction
    // failed on a corrupted/encrypted PDF — see completeUpload comments.
    pageCount: integer('page_count'),
    // Whether Claude can read this file (Chunk 7). Computed at upload.
    // Default optimistic: if we couldn't extract page count, assume yes.
    aiReadable: boolean('ai_readable').notNull().default(true),
    // Human-readable reason for ai_readable = false (e.g. "PDF exceeds 100 pages").
    aiReadableReason: text('ai_readable_reason'),
    // Set by Chunk 7's read flow on first read. NULL pre-Chunk-7.
    anthropicFileId: text('anthropic_file_id'),
    // NULL = active, non-NULL = soft-deleted.
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    // Bumped by the touch_files_updated_at trigger on every UPDATE.
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // Hot path — "list non-deleted files in this matter".
    matterIdDeletedAtIdx: index('files_matter_id_deleted_at_idx').on(
      t.matterId,
      t.deletedAt,
    ),
    userIdDeletedAtIdx: index('files_user_id_deleted_at_idx').on(
      t.userId,
      t.deletedAt,
    ),
    // For quota SUM(file_size) WHERE user_id = ? AND matter_id = ?.
    userIdMatterIdIdx: index('files_user_id_matter_id_idx').on(
      t.userId,
      t.matterId,
    ),
  }),
);

export type File = typeof files.$inferSelect;
export type NewFile = typeof files.$inferInsert;

/**
 * file_tags — many-to-many tags on files.
 *
 * Composite PK (file_id, tag) ensures a tag can only be applied once per
 * file. No separate "tags" master table — see the design doc rationale.
 *
 * `tag` is the normalised form (lowercase, trimmed) used for matching/deduping.
 * `tag_label` is the display form preserving how the lawyer typed it.
 *
 * No update policy — tags are delete-and-insert, not in-place editable.
 * The updateFileTags query truncates and re-inserts the file's tag set.
 */
export const fileTags = pgTable(
  'file_tags',
  {
    // FK to files(id) with ON DELETE CASCADE — declared in raw SQL.
    fileId: uuid('file_id').notNull(),
    // Normalised: lowercase, trimmed. The deduplication key.
    tag: text('tag').notNull(),
    // Display form: preserves the lawyer's chosen capitalisation.
    tagLabel: text('tag_label').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // Composite PK enforces tag-per-file uniqueness.
    pk: primaryKey({ columns: [t.fileId, t.tag] }),
    // For filter-by-tag queries and DISTINCT autocomplete lookups.
    tagIdx: index('file_tags_tag_idx').on(t.tag),
  }),
);

export type FileTag = typeof fileTags.$inferSelect;
export type NewFileTag = typeof fileTags.$inferInsert;
