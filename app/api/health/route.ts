import { NextResponse } from 'next/server';
import { db, schema } from '@/lib/db';
import { sql } from 'drizzle-orm';

export async function GET() {
  try {
    await db.execute(sql`select 1 as ok`);
    const judgmentCount = await db.$count(schema.judgments);
    return NextResponse.json({
      status: 'ok',
      database: 'connected',
      judgmentCount,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    return NextResponse.json(
      { status: 'error', message: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
