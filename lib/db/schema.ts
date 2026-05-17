// lib/db/schema.ts
//
// CHUNK 8 ADDITIONS (legislation corpus):
//   - LegislationJurisdiction union: 'commonwealth' | 'nsw' | 'vic' | ...
//   - LegislationKind union: 'act' | 'regulation' | 'legislative_instrument' | 'constitution'
//   - LegislationSectionLevel union (chapter/part/division/.../subsection/schedule/schedule_part/schedule_clause)
//   - legislation table
//   - legislation_sections table (hierarchical, self-referencing)
//   - legislation_section_embeddings table (voyage-law-2 1024-dim, HNSW + cosine)
//   - NO RLS — legislation is public reference data, every user reads same corpus
//
// CHUNK 8 FOLLOW-UP (migration 0008):
//   - 'schedule_clause' added to LegislationSectionLevel union and to the
//     DB CHECK constraint. Required for AGLC4-correct citation of clauses
//     within a schedule (e.g. APP 11 in the Privacy Act, cited as
//     'sch 1 cl 11', not 's 11'). The parser + citation builders treat
//     schedule descendants distinctly from Act-level Parts/Sections to
//     prevent path collisions (part_1 vs sch_1.pt_1).
//
// CHUNK 8 FOLLOW-UP 2 (chat retrieval):
//   - LegislationCitation variant added to StoredCitation discriminated
//     union. Emitted by the chat route when Claude cites a section
//     retrieved via legislation semantic search. Numbering shares the
//     same [N] sequence as caselaw, allocated AFTER caselaw citations.
//     No schema change required — messages.citations is JSONB so the
//     new variant just lands.
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
// FK & RLS patterns — same as Chunks 3, 5, 6, 7
// =============================================================================
//
// New columns added in Chunk 7 don't introduce new FKs. They're scalar
// columns on existing tables. RLS is already enabled on matters and files;
// the new columns are protected by the same row-level policies (auth.uid()
// = user_id). No policy changes needed.
//
// Chunk 8 tables (legislation, legislation_sections, legislation_section_embeddings)
// have NO user_id and NO RLS — legislation is public reference data shared
// across every user. Reads are uniform; writes are restricted at the
// application layer (only the ingestion script writes, via service role).

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
 * Discriminated union of three kinds:
 *
 *   - 'caselaw'      (Chunk 3 shape): NSW caselaw hit from semantic search
 *                    over judgment_embeddings
 *   - 'file'         (Chunk 7): a quote from a user-uploaded file in the matter
 *   - 'legislation'  (Chunk 8 retrieval): a section hit from semantic search
 *                    over legislation_section_embeddings
 *
 * All three live in the same JSONB column. The renderer (message-citations.tsx)
 * switches on `kind` and renders accordingly.
 *
 * Why one column not three: simpler queries, simpler types, and a single
 * citation has exactly one kind — they're mutually exclusive.
 *
 * The Chunk 3 'caselaw' shape is preserved exactly so old messages stored
 * before Chunk 7 still render. The `kind: 'caselaw'` discriminator is
 * the only new field on that variant; older rows without `kind` are
 * treated as caselaw by default in the renderer.
 *
 * Numbering across kinds (used by /api/chat/route.ts):
 *   The chat route builds the citations array in this fixed order
 *     [caselaw[0..N-1], legislation[0..M-1], file[0..K-1]]
 *   with `index` values 1..N+M+K assigned in that order. So in a system
 *   with 10 caselaw hits + 7 legislation hits, caselaw citations are
 *   emitted by Claude as [1]..[10] and legislation citations as [11]..[17].
 *   File citations don't use the [N] format (see lib/chat/citations.ts);
 *   they're parsed out of quote blocks after streaming and indexed
 *   after the [N] citations.
 */
export type StoredCitation = CaselawCitation | FileCitation | LegislationCitation;

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

/**
 * LegislationCitation — Chunk 8 retrieval addition.
 *
 * Emitted when Claude cites a legislation_sections row that was
 * retrieved via semantic search and supplied in the system prompt.
 *
 * Numbering shares the same [N] sequence as caselaw citations and is
 * assigned by the chat route AFTER caselaw indices. See the
 * StoredCitation docstring above for the full numbering scheme.
 *
 * Stored fields mirror what the legislation semantic search returns:
 *   - legislationId / sectionId  — for future deep-linking back to
 *     the source row in the DB
 *   - citation                   — pre-computed AGLC4 string
 *     (e.g. 'Privacy Act 1988 (Cth) s 16A')
 *   - breadcrumb                 — UI-friendly path
 *     (e.g. 'Part III > Division 1 > s 16A')
 *   - heading                    — section title for display
 *   - text                       — the actual section body content
 *     that Claude reasoned over. Kept verbatim so the lawyer can
 *     verify the citation matches what Claude was shown.
 *   - similarity                 — cosine similarity score for the
 *     hit, useful for downstream relevance display / debugging.
 */
export interface LegislationCitation {
  kind: 'legislation';
  index: number;
  legislationId: string;
  sectionId: string;
  citation: string;
  breadcrumb: string;
  heading: string | null;
  text: string;
  similarity: number;
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

// =============================================================================
// === CHUNK 8 — LEGISLATION CORPUS  ===========================================
// =============================================================================
//
// Three new tables. NO RLS — legislation is public reference data,
// every user reads the same corpus. No user_id columns.
//
// Discriminator pattern:
//   - jurisdiction: 'commonwealth' | 'nsw' | 'vic' | ...   (Cth first)
//   - kind: 'act' | 'regulation' | 'legislative_instrument' | 'constitution'
//   - section.level: 'chapter' | 'part' | 'division' | 'subdivision'
//                  | 'section' | 'subsection'
//                  | 'schedule' | 'schedule_part' | 'schedule_clause'
//
// Migrations:
//   - lib/db/migrations/0007_legislation.sql (initial schema)
//   - lib/db/migrations/0008_schedule_clause_level.sql (adds schedule_clause
//     to the level CHECK; required for AGLC4-correct citation of APPs etc.)

// -----------------------------------------------------------------------------
// Discriminator unions
// -----------------------------------------------------------------------------
//
// $type<...>() casts on columns below pin the TS layer; DB stores TEXT
// with CHECK constraints for runtime safety. Same pattern as
// MatterStatus and AiAccessMode.

export type LegislationJurisdiction =
  | 'commonwealth'
  | 'nsw'
  | 'vic'
  | 'qld'
  | 'wa'
  | 'sa'
  | 'tas'
  | 'act'
  | 'nt';

export type LegislationKind =
  | 'act'
  | 'regulation'
  | 'legislative_instrument'
  | 'constitution';

// Section level discriminator.
//
// Act-level hierarchy:
//   chapter > part > division > subdivision > section > subsection
//
// Schedule-level hierarchy (used for content within a Schedule, distinct
// from Act-level rows so paths don't collide):
//   schedule > schedule_part > schedule_clause
//
// AGLC4 citation forms produced by lib/legislation/citations.ts:
//   section          → 'Privacy Act 1988 (Cth) s 6'
//   part             → 'Privacy Act 1988 (Cth) pt II'
//   schedule         → 'Privacy Act 1988 (Cth) sch 1'
//   schedule_part    → 'Privacy Act 1988 (Cth) sch 1 pt 4'
//   schedule_clause  → 'Privacy Act 1988 (Cth) sch 1 cl 11'   ← e.g. APP 11
//
// 'schedule_clause' was added in migration 0008 because the initial
// schema lacked a distinct level for clauses inside a schedule. Without
// it, the Privacy Act's APPs were stored as level='section', producing
// the harmful citation 'Privacy Act 1988 (Cth) s 11' (which is actually
// "File number recipients", not APP 11).
export type LegislationSectionLevel =
  | 'chapter'
  | 'part'
  | 'division'
  | 'subdivision'
  | 'section'
  | 'subsection'
  | 'schedule'
  | 'schedule_part'
  | 'schedule_clause';

// -----------------------------------------------------------------------------
// legislation — one row per Act / Regulation / Constitution
// -----------------------------------------------------------------------------

export const legislation = pgTable(
  'legislation',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    // Natural key from the Federal Register (e.g. 'C2004A03712').
    registrationId: text('registration_id').notNull(),

    jurisdiction: text('jurisdiction').$type<LegislationJurisdiction>().notNull(),
    kind: text('kind').$type<LegislationKind>().notNull(),

    shortTitle: text('short_title').notNull(),
    longTitle: text('long_title'),
    year: integer('year'),
    number: integer('number'),

    // Pre-computed AGLC4 citation, e.g. 'Privacy Act 1988 (Cth)'.
    citation: text('citation').notNull(),

    // Current compilation we have. For v1, no point-in-time —
    // this is "the version we're serving".
    compilationDate: date('compilation_date').notNull(),
    compilationNumber: integer('compilation_number'),

    // If a future amendment is registered but not yet commenced.
    nextAmendmentDate: date('next_amendment_date'),

    // Where we fetched the content + the licence-required attribution.
    sourceUrl: text('source_url').notNull(),
    attributionText: text('attribution_text').notNull(),

    retrievedAt: timestamp('retrieved_at', { withTimezone: true })
      .notNull()
      .defaultNow(),

    // Currency. Acts can be repealed; we keep the row + sections for
    // citation resolution but flag status.
    inForce: boolean('in_force').notNull().default(true),
    repealedAt: date('repealed_at'),

    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    // Natural key for idempotent re-ingestion.
    jurisdictionRegistrationIdx: uniqueIndex(
      'legislation_jurisdiction_registration_idx',
    ).on(t.jurisdiction, t.registrationId),

    // Hot read: "show me all in-force Acts in this jurisdiction".
    jurisdictionKindIdx: index('legislation_jurisdiction_kind_idx')
      .on(t.jurisdiction, t.kind)
      .where(sql`${t.inForce} = true`),

    // Fuzzy title search ("find Acts with 'privacy' in the name").
    shortTitleTrgmIdx: index('legislation_short_title_trgm_idx')
      .using('gin', sql`${t.shortTitle} gin_trgm_ops`),
  }),
);

export type Legislation = typeof legislation.$inferSelect;
export type NewLegislation = typeof legislation.$inferInsert;

// -----------------------------------------------------------------------------
// legislation_sections — hierarchical content tree
// -----------------------------------------------------------------------------
//
// One row per Part / Division / Subdivision / Section / Subsection /
// Schedule / Schedule Part / Schedule Clause. Self-references via
// parent_section_id. Materialized `path` column for fast subtree
// queries without recursive CTEs.

export const legislationSections = pgTable(
  'legislation_sections',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    legislationId: uuid('legislation_id').notNull(),
    parentSectionId: uuid('parent_section_id'),

    level: text('level').$type<LegislationSectionLevel>().notNull(),

    // The number/letter. TEXT not INT — '6AA', '20ZA', '(1)(a)(ii)' are
    // all real identifiers.
    number: text('number').notNull(),

    // Heading text. NULL for subsection-level rows that have no heading.
    heading: text('heading'),

    // Body text. Empty for structural rows (Parts, Divisions usually have
    // no body). NOT NULL with default '' avoids null-coalescing downstream.
    text: text('text').notNull().default(''),

    // Pre-computed AGLC4 citation for THIS row.
    // e.g. 'Privacy Act 1988 (Cth) s 6'
    // e.g. 'Privacy Act 1988 (Cth) s 6(1)(a)'
    // e.g. 'Privacy Act 1988 (Cth) sch 1 cl 11'
    citation: text('citation').notNull(),

    // Human-readable breadcrumb from root for UI display.
    // e.g. 'Part II > Division 1 > s 6'
    // e.g. 'Sch 1 > Pt 4 > Cl 11'
    breadcrumb: text('breadcrumb').notNull(),

    // Materialized path for fast subtree queries.
    // e.g. 'part_II.division_1.section_6'
    // e.g. 'sch_1.pt_4.cl_11'
    path: text('path').notNull(),

    // Sort within this parent. The parser assigns sequentially while
    // reading top-to-bottom. Display always uses this, never `number`.
    sortOrder: integer('sort_order').notNull(),

    // Mirrors judgment_embeddings pattern from Chunk 2.
    embeddedAt: timestamp('embedded_at', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    // "All sections of this Act, in order."
    legislationSortIdx: index('legislation_sections_legislation_sort_idx').on(
      t.legislationId,
      t.sortOrder,
    ),

    // "Children of this Part / Division."
    parentIdx: index('legislation_sections_parent_idx')
      .on(t.parentSectionId)
      .where(sql`${t.parentSectionId} IS NOT NULL`),

    // Subtree queries via materialized path.
    pathIdx: index('legislation_sections_path_idx').on(
      t.legislationId,
      t.path,
    ),

    // Direct citation lookup: "find 'Privacy Act 1988 (Cth) s 6'".
    citationIdx: index('legislation_sections_citation_idx').on(t.citation),

    // Embedding worker finds unembedded rows.
    unembeddedIdx: index('legislation_sections_unembedded_idx')
      .on(t.id)
      .where(sql`${t.embeddedAt} IS NULL`),
  }),
);

export type LegislationSection = typeof legislationSections.$inferSelect;
export type NewLegislationSection = typeof legislationSections.$inferInsert;

// -----------------------------------------------------------------------------
// legislation_section_embeddings — voyage-law-2 1024-dim vectors
// -----------------------------------------------------------------------------
//
// Mirrors judgment_embeddings from Chunk 2. Same model (voyage-law-2),
// same dimensions (1024), same HNSW + cosine_ops setup. Separate from
// legislation_sections so scans on the sections table stay cheap.

export const legislationSectionEmbeddings = pgTable(
  'legislation_section_embeddings',
  {
    sectionId: uuid('section_id').primaryKey(),

    // The actual text fed to Voyage. Often includes breadcrumb prefix
    // for semantic richness — see migration comments.
    embeddedText: text('embedded_text').notNull(),

    // Lets us migrate to newer Voyage models without confusion.
    // Mirrors judgment_embeddings.model.
    model: text('model').notNull(),

    embedding: vector('embedding', { dimensions: 1024 }).notNull(),

    embeddedAt: timestamp('embedded_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    embeddingIdx: index('legislation_section_embeddings_embedding_idx').using(
      'hnsw',
      sql`${t.embedding} vector_cosine_ops`,
    ),
  }),
);

export type LegislationSectionEmbedding =
  typeof legislationSectionEmbeddings.$inferSelect;
export type NewLegislationSectionEmbedding =
  typeof legislationSectionEmbeddings.$inferInsert;