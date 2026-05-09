// lib/search/semantic.ts
//
// Semantic search across the judgment_embeddings table.
//
// Flow:
//   1. Caller passes a natural-language query string.
//   2. We embed the query via Voyage with input_type="query" — this produces
//      a different vector than embedding the same text as a "document". Voyage
//      uses two slightly different vector spaces; matching the right one
//      against the right one gives meaningfully better retrieval (~5-10%).
//   3. We use pgvector's `<=>` cosine distance operator to find the nearest
//      paragraph embeddings, then JOIN to judgments to return case context.
//   4. Results come back ranked by similarity (1 = perfect match, 0 = no match).
//
// Performance note:
//   The HNSW index makes this query fast (~50-200ms typically) even at
//   millions of vectors. We don't need to set probe parameters because
//   HNSW's defaults work well for our scale.

import { sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { embed, type VoyageModel } from '@/lib/embeddings/voyage';

// MUST match the model used in scripts/embed-judgments.ts. If we ever
// re-embed with a different model, this constant must change in lockstep.
const QUERY_EMBEDDING_MODEL: VoyageModel = 'voyage-law-2';

export interface SemanticSearchHit {
  /** Cosine similarity in [0, 1]. Higher = better. */
  similarity: number;

  /** The actual paragraph text we embedded — what Claude will reason over. */
  paragraphText: string;

  /** The original paragraph number, e.g. "11" or "23(a)". */
  paragraphNumber: string;

  /** Position of this paragraph in the judgment. Useful for fetching
   *  surrounding paragraphs later if we want to expand context. */
  paragraphIndex: number;

  /** Judgment metadata, joined from the judgments table. */
  judgment: {
    id: string;
    citation: string | null;
    caseName: string | null;
    court: string | null;
    decisionDate: string | null;
  };
}

export interface SemanticSearchOptions {
  /** Max results to return. Defaults to 15. Cap at 100 for safety. */
  limit?: number;

  /**
   * Minimum similarity threshold. Hits below this are dropped.
   * Cosine similarity from voyage-law-2 typically ranges:
   *   - 0.85+ : extremely relevant
   *   - 0.70-0.85 : clearly on-topic
   *   - 0.55-0.70 : tangentially related
   *   - <0.55 : likely noise
   * Defaults to 0.55 — generous, lets Claude judge final relevance.
   */
  minSimilarity?: number;
}

/**
 * Run a semantic search and return ranked paragraph hits with case metadata.
 */
export async function semanticSearch(
  query: string,
  options: SemanticSearchOptions = {},
): Promise<SemanticSearchHit[]> {
  const trimmed = query.trim();
  if (trimmed.length === 0) {
    return [];
  }

  const limit = Math.min(100, Math.max(1, options.limit ?? 15));
  const minSimilarity = options.minSimilarity ?? 0.55;

  // 1. Embed the query.
  // input_type='query' is critical — Voyage trains the model to map queries
  // and documents into the same space when each is tagged correctly.
  const { embeddings } = await embed({
    texts: [trimmed],
    model: QUERY_EMBEDDING_MODEL,
    inputType: 'query',
  });

  if (embeddings.length === 0) {
    throw new Error('Voyage returned no embedding for the query.');
  }

  const queryVector = embeddings[0];

  // 2. Search pgvector + join to judgments.
  // We use raw SQL here because Drizzle doesn't have first-class operators
  // for pgvector's `<=>`. The cast `::vector` ensures the JS array becomes
  // a proper vector literal in Postgres.
  //
  // Distance is `embedding <=> vector` (smaller = closer).
  // Similarity is `1 - distance` (larger = better).
  //
  // We filter by similarity AFTER the index lookup so the HNSW index is
  // still used for the ordering — putting the filter first would force a
  // sequential scan.
  const queryVectorLiteral = `[${queryVector.join(',')}]`;

  const rows = await db.execute<{
    paragraph_text: string;
    paragraph_number: string;
    paragraph_index: number;
    similarity: number;
    judgment_id: string;
    citation: string | null;
    case_name: string | null;
    court: string | null;
    decision_date: string | null;
  }>(sql`
    SELECT
      e.paragraph_text,
      e.paragraph_number,
      e.paragraph_index,
      1 - (e.embedding <=> ${queryVectorLiteral}::vector) AS similarity,
      j.id AS judgment_id,
      j.citation,
      j.case_name,
      j.court,
      j.decision_date::text AS decision_date
    FROM judgment_embeddings e
    INNER JOIN judgments j ON j.id = e.judgment_id
    WHERE e.model = ${QUERY_EMBEDDING_MODEL}
    ORDER BY e.embedding <=> ${queryVectorLiteral}::vector
    LIMIT ${limit}
  `);

  // 3. Map to typed hits and apply similarity threshold.
  const hits: SemanticSearchHit[] = [];
  for (const row of rows) {
    if (row.similarity < minSimilarity) {
      // Results are ordered by similarity desc — once we drop below the
      // threshold, all subsequent results are also below. Break early.
      break;
    }

    hits.push({
      similarity: row.similarity,
      paragraphText: row.paragraph_text,
      paragraphNumber: row.paragraph_number,
      paragraphIndex: row.paragraph_index,
      judgment: {
        id: row.judgment_id,
        citation: row.citation,
        caseName: row.case_name,
        court: row.court,
        decisionDate: row.decision_date,
      },
    });
  }

  return hits;
}
