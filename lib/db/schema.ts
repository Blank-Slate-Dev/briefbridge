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
} from 'drizzle-orm/pg-core';

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
  }),
);

export type Judgment = typeof judgments.$inferSelect;
export type NewJudgment = typeof judgments.$inferInsert;
