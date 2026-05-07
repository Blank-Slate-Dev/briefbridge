// lib/queries.ts
import { db, schema } from './db';
import { desc, eq } from 'drizzle-orm';

/**
 * Get a list of all judgments, most recent first.
 * For now we just return all of them. When we have thousands we'll add pagination.
 */
export async function listJudgments() {
  return db
    .select({
      id: schema.judgments.id,
      citation: schema.judgments.citation,
      caseName: schema.judgments.caseName,
      court: schema.judgments.court,
      decisionDate: schema.judgments.decisionDate,
      catchwords: schema.judgments.catchwords,
    })
    .from(schema.judgments)
    .orderBy(desc(schema.judgments.decisionDate))
    .limit(100);
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