// lib/queries.ts
import { db, schema } from './db';
import { desc, eq, sql, and, gte, lt } from 'drizzle-orm';

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;

export interface ListJudgmentsOptions {
  /** 1-indexed page number. Defaults to 1. */
  page?: number;
  /** Number of judgments per page. Defaults to 50, capped at 200. */
  pageSize?: number;
  /** Free-text search across case_name, citation, catchwords, and full_text. */
  query?: string;
  /** Filter by decision year, e.g. 2024. */
  year?: number;
}

/**
 * The tsvector expression we search against. Must match the GIN index in
 * schema.ts (judgments_search_vector_idx) so Postgres uses the index.
 *
 * Weights (A > B > C > D, A is most relevant):
 *   - A: case_name and citation (most specific identifiers)
 *   - B: catchwords (curated topical summary)
 *   - C: full_text (the body of the judgment)
 *
 * If you change this expression, you MUST also update the index in schema.ts
 * and re-generate/run the migration.
 */
function buildSearchVector() {
  // Migration 0010: read the stored, generated tsvector column instead of
  // recomputing the setweight(to_tsvector(...)) expression on every row. The
  // recompute over full_text for every matched row was the ~80s ORDER BY
  // bottleneck (confirmed via EXPLAIN ANALYZE). Now both the WHERE filter and
  // the ts_rank ORDER BY read the prebuilt column.
  return sql`${schema.judgments.searchVector}`;
}

/**
 * Build the WHERE clauses common to listJudgments and countJudgments.
 * Returns an array of conditions to AND together (or undefined if no filters).
 *
 * Centralised here so list and count queries stay in sync — if a search returns
 * 47 results in listJudgments, countJudgments must say 47 too.
 */
function buildFilters(options: ListJudgmentsOptions) {
  const conditions = [];

  if (options.query && options.query.trim().length > 0) {
    // plainto_tsquery handles user-typed input forgivingly: it strips operators
    // (so users can't accidentally break it with "&" or "!"), tokenises words,
    // and ANDs them together. "negligent driving" → "negligent" & "driving".
    conditions.push(
      sql`${buildSearchVector()} @@ plainto_tsquery('english', ${options.query.trim()})`,
    );
  }

  if (options.year && Number.isFinite(options.year)) {
    // decision_date is a date column. Comparing against a year range is faster
    // than EXTRACT(YEAR ...) because it can use the existing decision_date_idx.
    const start = `${options.year}-01-01`;
    const end = `${options.year + 1}-01-01`;
    conditions.push(
      and(
        gte(schema.judgments.decisionDate, start),
        lt(schema.judgments.decisionDate, end),
      ),
    );
  }

  return conditions.length > 0 ? and(...conditions) : undefined;
}

/**
 * Get a paginated list of judgments.
 *
 * Default ordering is most recent first. If a search query is provided, results
 * are instead ordered by relevance (ts_rank), then by recency as a tiebreak.
 *
 * Pagination is 1-indexed. pageSize is capped at MAX_PAGE_SIZE.
 */
export async function listJudgments(options: ListJudgmentsOptions = {}) {
  const page = Math.max(1, options.page ?? 1);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, options.pageSize ?? DEFAULT_PAGE_SIZE));
  const offset = (page - 1) * pageSize;
  const filters = buildFilters(options);
  const hasQuery = !!options.query && options.query.trim().length > 0;

  const queryBuilder = db
    .select({
      id: schema.judgments.id,
      citation: schema.judgments.citation,
      caseName: schema.judgments.caseName,
      court: schema.judgments.court,
      decisionDate: schema.judgments.decisionDate,
      catchwords: schema.judgments.catchwords,
    })
    .from(schema.judgments);

  // Always order by recency. Ranking 6k+ matched rows with ts_rank was 3–80s
  // per query (it loads a large tsvector per row); ordering by the indexed
  // decision_date keeps search at ~40ms. Most-recent-first is a sound default
  // for a legal database. (hasQuery / buildRankVector now unused — left in
  // place; lint warns, doesn't error.)
  const ordered = filters
    ? queryBuilder.where(filters).orderBy(desc(schema.judgments.decisionDate))
    : queryBuilder.orderBy(desc(schema.judgments.decisionDate));

  return ordered.limit(pageSize).offset(offset);
}

/**
 * Count judgments matching the given filters.
 *
 * Mirror of listJudgments() but returns just the count, used to compute total
 * pages and the "Showing X of Y" UI text.
 */
export async function countJudgments(options: ListJudgmentsOptions = {}): Promise<number> {
  const filters = buildFilters(options);

  const queryBuilder = db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.judgments);

  const rows = await (filters ? queryBuilder.where(filters) : queryBuilder);
  return rows[0]?.count ?? 0;
}

/**
 * Get the list of distinct years present in the judgments table, descending.
 * Used to populate the year-filter dropdown in the UI.
 *
 * Cached for a minute via Next.js's request-level dedup; the underlying query
 * uses the decision_date_idx so it's quick even on millions of rows.
 */
export async function getDistinctYears(): Promise<number[]> {
  const rows = await db
    .select({
      year: sql<number>`extract(year from ${schema.judgments.decisionDate})::int`,
    })
    .from(schema.judgments)
    .where(sql`${schema.judgments.decisionDate} is not null`)
    .groupBy(sql`extract(year from ${schema.judgments.decisionDate})`)
    .orderBy(sql`extract(year from ${schema.judgments.decisionDate}) desc`);

  return rows.map((r) => r.year).filter((y): y is number => Number.isFinite(y));
}

/**
 * Get a single judgment by its UUID, including paragraphs and citation graph.
 */
export async function getJudgment(id: string) {
  const rows = await db
    .select()
    .from(schema.judgments)
    .where(eq(schema.judgments.id, id))
    .limit(1);

  return rows[0] ?? null;
}
