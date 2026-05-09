// REPLACE lib/db/schema.ts WITH THIS COMPLETE FILE
//
// What changed (additions only — existing tables untouched):
//   1. Added `vector` import from drizzle-orm/pg-core
//   2. Added `sql` import for raw SQL inside index expressions
//   3. New `judgmentEmbeddings` table (paragraph-level vectors)
//
// The pgvector extension itself is enabled via the migration's
// `CREATE EXTENSION IF NOT EXISTS vector;` statement. Drizzle's
// generator should add this automatically when it detects the
// vector column type, but we'll verify after generation.

import {
  pgTable,
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
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

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
