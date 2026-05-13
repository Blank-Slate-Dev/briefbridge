// lib/db/schema.ts
//
// CHUNK 7 ADDITIONS (AI access controls + file reading):
//   - AiAccessMode union: 'off' | 'all' | 'subset'
//   - matters.aiAccessMode + matters.aiAccessCommittedAt
//   - files.aiBlockedByUser
//   - files.aiExcludedInMatter
//   - files.anthropicLastUsedAt
//
// CHUNK 6 ADDITIONS (files foundation) — unchanged from Chunk 6:
//   - files + fileTags tables
//
// CHUNK 3 ADDITIONS (auth + persistence) — unchanged:
//   - profiles, matters, conversations, messages tables
//   - MatterStatus union
//
// CHUNK 2 (judgments / embeddings) — unchanged.
//
// =============================================================================
// FK & RLS patterns — same as Chunks 3, 5, 6
// =============================================================================
//
// New columns added in Chunk 7 don't introduce new FKs. They're scalar
// columns on existing tables. RLS is already enabled on matters and files;
// the new columns are protected by the same row-level policies (auth.uid()
// = user_id). No policy changes needed.

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
// auth.users — TYPE-ONLY REFERENCE (unchanged)
// -----------------------------------------------------------------------------

const authSchema = pgSchema('auth');
export const authUsers = authSchema.table('users', {
  id: uuid('id').primaryKey(),
});

// =============================================================================
// === CHUNK 2 — JUDGMENTS + EMBEDDINGS (unchanged) ============================
// =============================================================================

export const judgments = pgTable(
  'judgments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    source: text('source').notNull(),
    sourceUrl: text('source_url').notNull(),
    sourceId: text('source_id'),
    citation: text('citation'),
    caseName: text('case_name'),
    court: text('court'),
    jurisdiction: text('jurisdiction'),
    decisionDate: date('decision_date'),
    hearingDates: text('hearing_dates'),
    judges: text('judges').array(),
    parties: jsonb('parties'),
    representation: jsonb('representation'),
    fileNumbers: text('file_numbers').array(),
    category: text('category'),
    catchwords: text('catchwords'),
    decisionSummary: text('decision_summary'),
    casesCited: jsonb('cases_cited'),
    legislationCited: jsonb('legislation_cited'),
    paragraphs: jsonb('paragraphs').notNull(),
    fullText: text('full_text').notNull(),
    paragraphCount: integer('paragraph_count').notNull(),
    rawHtml: text('raw_html'),
    publicationRestriction: text('publication_restriction'),
    suppressionFlag: boolean('suppression_flag').notNull().default(false),
    contentHash: text('content_hash').notNull(),
    ingestedAt: timestamp('ingested_at', { withTimezone: true }).notNull().defaultNow(),
    lastCheckedAt: timestamp('last_checked_at', { withTimezone: true }).notNull().defaultNow(),
    decisionLastUpdated: date('decision_last_updated'),
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

export const judgmentEmbeddings = pgTable(
  'judgment_embeddings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    judgmentId: uuid('judgment_id').notNull(),
    paragraphNumber: text('paragraph_number').notNull(),
    paragraphIndex: integer('paragraph_index').notNull(),
    paragraphText: text('paragraph_text').notNull(),
    embedding: vector('embedding', { dimensions: 1024 }).notNull(),
    model: text('model').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    judgmentIdIdx: index('judgment_embeddings_judgment_id_idx').on(t.judgmentId),
    embeddingIdx: index('judgment_embeddings_embedding_idx').using(
      'hnsw',
      sql`${t.embedding} vector_cosine_ops`,
    ),
  }),
);

export type JudgmentEmbedding = typeof judgmentEmbeddings.$inferSelect;
export type NewJudgmentEmbedding = typeof judgmentEmbeddings.$inferInsert;

// =============================================================================
// === CHUNK 3 — AUTH + PERSISTENCE ============================================
// =============================================================================

export type MatterStatus =
  | 'active'
  | 'on-hold'
  | 'awaiting-client'
  | 'in-hearing'
  | 'settled'
  | 'closed';

// =============================================================================
// === CHUNK 7 — AI ACCESS MODE (single source of truth) =======================
// =============================================================================
//
// Same pattern as MatterStatus — defined here, referenced everywhere.
//
//   'off'    Claude has zero file access. System prompt does not list files.
//   'all'    Claude can see every active, ai_readable, non-blocked file.
//   'subset' Same as 'all' but files.ai_excluded_in_matter = true are
//            removed from the listing.
//
// The DB CHECK constraint enforces the three values at the data layer.
// The $type<AiAccessMode>() on matters.aiAccessMode narrows it at the
// TS layer. These two together mean an invalid value is unrepresentable
// in either compile or runtime.
//
// If you ever add a fourth mode, update:
//   1. This union
//   2. The CHECK constraint in 0006_chunk7.sql (or follow-on migration)
//   3. AI_ACCESS_MODES in lib/files/ai-access-types.ts
//   4. Any switch statements on this type (TS will surface them)

export type AiAccessMode = 'off' | 'all' | 'subset';

export const profiles = pgTable('profiles', {
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
 * matters — added in Chunk 3, extended in Chunk 7.
 *
 * Chunk 7 additions:
 *   - aiAccessMode: AI access policy for this matter. Default 'off'.
 *   - aiAccessCommittedAt: when the lawyer last hit Confirm in the panel.
 *     NULL = never confirmed. NULL'd out when a new file is uploaded to
 *     force re-confirm.
 *
 * Both columns use the existing matters RLS policies — no new policies
 * needed since the row-level gating is the same.
 */
export const matters = pgTable(
  'matters',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull(),
    name: text('name').notNull(),
    client: text('client'),
    description: text('description'),
    status: text('status').$type<MatterStatus>().notNull().default('active'),
    notes: text('notes'),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    // --- Chunk 7 ---
    aiAccessMode: text('ai_access_mode').$type<AiAccessMode>().notNull().default('off'),
    aiAccessCommittedAt: timestamp('ai_access_committed_at', { withTimezone: true }),
    // ----------------
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

export const conversations = pgTable(
  'conversations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull(),
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

export const messages = pgTable(
  'messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    conversationId: uuid('conversation_id').notNull(),
    role: text('role').$type<'user' | 'assistant'>().notNull(),
    content: text('content').notNull(),
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
 * Citation — what gets stored in messages.citations[].
 *
 * CHUNK 7 CHANGE: this is now a discriminated union of two kinds:
 *
 *   - 'caselaw' (Chunk 3 shape): NSW caselaw hit from semantic search
 *   - 'file' (Chunk 7 new): a quote from a user-uploaded file in the matter
 *
 * Both kinds live in the same column. The renderer (message-citations.tsx)
 * switches on `kind` and renders accordingly.
 *
 * Why one column not two: simpler queries, simpler types, and a single
 * citation can't be "both" — the kind is mutually exclusive.
 *
 * The Chunk 3 'caselaw' shape is preserved exactly so old messages
 * stored before Chunk 7 still render. The `kind: 'caselaw'` discriminator
 * is the only new field on that variant; older rows without `kind` are
 * treated as caselaw by default in the renderer.
 */
export type StoredCitation = CaselawCitation | FileCitation;

export interface CaselawCitation {
  // 'kind' is optional for back-compat with pre-Chunk-7 rows that don't
  // have it. The renderer defaults missing kind to 'caselaw'.
  kind?: 'caselaw';
  index: number;
  judgmentId: string;
  caseName: string | null;
  citation: string | null;
  paragraphNumber: string;
  paragraphText: string;
  similarity: number;
}

export interface FileCitation {
  kind: 'file';
  index: number;
  // The file the quote came from. file_id is preserved at quote time;
  // if the file is later deleted, we still know what was quoted.
  fileId: string;
  // Snapshot of the filename at the time of quote (for back-compat in
  // case the file is renamed in some future feature).
  filename: string;
  // Page number Claude reported. Stored as a string because some
  // judgments use compound page references like "3-4" or "3.2". We
  // don't try to be clever; we display what Claude said.
  page: string;
  // The verbatim quoted text. Up to ~1000 chars; we don't render
  // anything longer than that inline.
  quote: string;
}

// =============================================================================
// === CHUNK 6 — FILES FOUNDATION (extended in Chunk 7) ========================
// =============================================================================

/**
 * files — added in Chunk 6, extended in Chunk 7.
 *
 * Chunk 7 additions:
 *   - aiBlockedByUser: lawyer-driven hard block. Always exclude from Claude.
 *   - aiExcludedInMatter: matter-level exclusion (only checked when matter
 *                        has aiAccessMode = 'subset').
 *   - anthropicLastUsedAt: when this file was last successfully read via
 *                          Anthropic Files API. Used for 30-day TTL design.
 *                          (Cleanup cron is deferred to later chunk.)
 *
 * anthropic_file_id existed in Chunk 6 but was never populated. We start
 * populating it in Chunk 7 from /api/files-tool.
 */
export const files = pgTable(
  'files',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull(),
    matterId: uuid('matter_id').notNull(),
    filename: text('filename').notNull(),
    storagePath: text('storage_path').notNull(),
    mimeType: text('mime_type').notNull(),
    fileSize: integer('file_size').notNull(),
    pageCount: integer('page_count'),
    aiReadable: boolean('ai_readable').notNull().default(true),
    aiReadableReason: text('ai_readable_reason'),
    // --- Chunk 7 additions ---
    aiBlockedByUser: boolean('ai_blocked_by_user').notNull().default(false),
    aiExcludedInMatter: boolean('ai_excluded_in_matter').notNull().default(false),
    // --------------------------
    anthropicFileId: text('anthropic_file_id'),
    // --- Chunk 7 addition ---
    anthropicLastUsedAt: timestamp('anthropic_last_used_at', { withTimezone: true }),
    // --------------------------
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    matterIdDeletedAtIdx: index('files_matter_id_deleted_at_idx').on(
      t.matterId,
      t.deletedAt,
    ),
    userIdDeletedAtIdx: index('files_user_id_deleted_at_idx').on(
      t.userId,
      t.deletedAt,
    ),
    userIdMatterIdIdx: index('files_user_id_matter_id_idx').on(
      t.userId,
      t.matterId,
    ),
    // Chunk 7: partial index for the AI-readable hot path.
    // Documented in 0006_chunk7.sql.
    // We declare it here so drizzle introspect doesn't try to drop it.
    aiReadablePartialIdx: index('files_ai_readable_partial_idx')
      .on(t.matterId)
      .where(sql`
        ${t.deletedAt} IS NULL
        AND ${t.aiReadable} = true
        AND ${t.aiBlockedByUser} = false
        AND ${t.aiExcludedInMatter} = false
      `),
  }),
);

export type File = typeof files.$inferSelect;
export type NewFile = typeof files.$inferInsert;

export const fileTags = pgTable(
  'file_tags',
  {
    fileId: uuid('file_id').notNull(),
    tag: text('tag').notNull(),
    tagLabel: text('tag_label').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.fileId, t.tag] }),
    tagIdx: index('file_tags_tag_idx').on(t.tag),
  }),
);

export type FileTag = typeof fileTags.$inferSelect;
export type NewFileTag = typeof fileTags.$inferInsert;
