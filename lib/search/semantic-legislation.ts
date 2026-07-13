// lib/search/semantic-legislation.ts
//
// Semantic search across the legislation_section_embeddings table.
//
// Sibling to lib/search/semantic.ts. The two functions follow the same
// shape (embed the query as input_type='query', then pgvector cosine
// search via the HNSW index) but return different result shapes because
// the underlying data models differ:
//
//   - semanticSearch (judgments): paragraph-level hits with case metadata
//   - semanticSearchLegislation: section-level hits with pre-computed
//                                AGLC4 citation, breadcrumb, heading, body
//
// Both indices are voyage-law-2 / 1024 dim / HNSW + cosine, so the
// retrieval pipeline is identical at the SQL level.
//
// =============================================================================
// COVERAGE — what's searchable
// =============================================================================
//
// Only leaf-level content rows have embeddings:
//   - level IN ('section', 'schedule_clause')
//   - text != ''
//
// Structural rows (chapter, part, division, subdivision) have no
// body text and were deliberately skipped at embed time; queries
// that would semantically match a Part heading (e.g. "the scope of
// Part III") will instead match the most relevant section under
// that Part. That's by design — sections are what the lawyer
// actually wants to cite.
//
// =============================================================================
// SIMILARITY THRESHOLD
// =============================================================================
//
// Legislation embeddings tend to score lower than caselaw on the same
// query — section text is denser, more abstract, and uses fewer
// rhetorical markers than a judgment paragraph. We use a slightly
// lower default threshold (0.45 vs caselaw's 0.55) to surface
// statutory hits that would otherwise fall below the cut-off.
// Tune based on observed retrieval quality with real lawyer queries.

import { sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { embed, type VoyageModel } from '@/lib/embeddings/voyage';

// MUST match the model used in scripts/embed-legislation.ts.
const QUERY_EMBEDDING_MODEL: VoyageModel = 'voyage-law-2';

export interface LegislationSearchHit {
  /** Cosine similarity in [0, 1]. Higher = better. */
  similarity: number;

  /** The pre-computed AGLC4 citation, e.g. 'Privacy Act 1988 (Cth) s 16A'. */
  citation: string;

  /** Human-readable breadcrumb, e.g. 'Part III > Division 1 > s 16A'. */
  breadcrumb: string;

  /** The section's heading text. Can be null for some subsection-level rows. */
  heading: string | null;

  /** The section's body text — what was embedded (modulo breadcrumb prefix). */
  text: string;

  /** Identifiers for downstream linking / deep dives. */
  section: {
    id: string;
    legislationId: string;
    level: string;
    number: string;
  };

  /** The parent Act metadata, JOINed at query time. */
  act: {
    shortTitle: string;
    citation: string;
    jurisdiction: string;
  };
}

export interface LegislationSearchOptions {
  /** Max results to return. Defaults to 10. Cap at 50 for safety. */
  limit?: number;

  /**
   * Minimum similarity threshold. Hits below this are dropped.
   * Cosine similarity from voyage-law-2 on legislation typically:
   *   - 0.75+ : clearly on-topic statute
   *   - 0.60-0.75 : related statute
   *   - 0.45-0.60 : tangentially related
   *   - <0.45 : likely noise
   * Defaults to 0.45 — lets Claude judge final relevance.
   */
  minSimilarity?: number;

  /**
   * Optional jurisdiction filter. e.g. 'commonwealth' to limit to Cth
   * Acts. Defaults to no filter — searches across the whole corpus.
   */
  jurisdiction?: string;
}

/**
 * Run a semantic search across the legislation corpus and return ranked
 * section hits with Act-level metadata.
 *
 * Returns at most `options.limit` (default 10) hits, each above
 * `options.minSimilarity` (default 0.45).
 */
export async function semanticSearchLegislation(
  query: string,
  options: LegislationSearchOptions = {},
): Promise<LegislationSearchHit[]> {
  const trimmed = query.trim();
  if (trimmed.length === 0) {
    return [];
  }

  const limit = Math.min(50, Math.max(1, options.limit ?? 10));
  const minSimilarity = options.minSimilarity ?? 0.45;
  const jurisdiction = options.jurisdiction ?? null;

  // 1. Embed the query with input_type='query'. Same as caselaw search:
  //    Voyage trains the model to map queries and documents into the
  //    same space when each is tagged correctly.
  const { embeddings } = await embed({
    texts: [trimmed],
    model: QUERY_EMBEDDING_MODEL,
    inputType: 'query',
  });

  if (embeddings.length === 0) {
    throw new Error('Voyage returned no embedding for the query.');
  }

  const queryVector = embeddings[0];
  const queryVectorLiteral = `[${queryVector.join(',')}]`;

  // 2. Search pgvector + JOIN to legislation_sections + JOIN to legislation.
  // We use raw SQL for the same reason as caselaw search: Drizzle doesn't
  // have first-class operators for pgvector's `<=>`.
  //
  // We filter by similarity AFTER the index lookup so the HNSW index is
  // still used for ordering — putting the filter first would force a
  // sequential scan over the whole embeddings table.
  //
  // The optional jurisdiction filter is applied in the WHERE clause. If
  // present, the query planner uses the legislation_jurisdiction_kind_idx
  // partial index for cheap pre-filtering before the vector scan.
  // HNSW RECALL FIX: pgvector's default hnsw.ef_search = 40 caused severe
  // recall failures — the true #1 hit (CLA s 5O at 60% for a query about it)
  // was ABSENT from the top-20 while 46% noise came back. Raising ef_search
  // restored it to #1 (verified via scripts/diag-legislation-ranking.ts,
  // 13 Jul 2026). SET LOCAL requires a transaction; on the transaction
  // pooler each statement otherwise lands on a fresh backend, so the
  // setting must share the txn with the query.
  const rows = await db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL hnsw.ef_search = 200`);
    return tx.execute<{
    section_id: string;
    legislation_id: string;
    level: string;
    number: string;
    citation: string;
    breadcrumb: string;
    heading: string | null;
    text: string;
    similarity: number;
    act_short_title: string;
    act_citation: string;
    act_jurisdiction: string;
  }>(sql`
    SELECT
      s.id            AS section_id,
      s.legislation_id,
      s.level,
      s.number,
      s.citation,
      s.breadcrumb,
      s.heading,
      s.text,
      1 - (e.embedding <=> ${queryVectorLiteral}::vector) AS similarity,
      l.short_title   AS act_short_title,
      l.citation      AS act_citation,
      l.jurisdiction  AS act_jurisdiction
    FROM legislation_section_embeddings e
    INNER JOIN legislation_sections s ON s.id = e.section_id
    INNER JOIN legislation         l ON l.id = s.legislation_id
    WHERE e.model = ${QUERY_EMBEDDING_MODEL}
      ${jurisdiction ? sql`AND l.jurisdiction = ${jurisdiction}` : sql``}
      AND l.in_force = true
    ORDER BY e.embedding <=> ${queryVectorLiteral}::vector
    LIMIT ${limit}
  `);
  });

  // 3. Map to typed hits and apply similarity threshold.
  // Results are ordered by similarity desc, so we break as soon as we
  // see a hit below threshold.
  const hits: LegislationSearchHit[] = [];
  for (const row of rows) {
    if (row.similarity < minSimilarity) {
      break;
    }

    hits.push({
      similarity: row.similarity,
      citation: row.citation,
      breadcrumb: row.breadcrumb,
      heading: row.heading,
      text: row.text,
      section: {
        id: row.section_id,
        legislationId: row.legislation_id,
        level: row.level,
        number: row.number,
      },
      act: {
        shortTitle: row.act_short_title,
        citation: row.act_citation,
        jurisdiction: row.act_jurisdiction,
      },
    });
  }

  return hits;
}