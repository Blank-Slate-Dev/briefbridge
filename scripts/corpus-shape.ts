import { config } from 'dotenv';
config({ path: '.env.local' });
import postgres from 'postgres';

const sql = postgres(process.env.DATABASE_URL!, { prepare: false });

async function main() {
  const yearly = await sql`
    SELECT 
      EXTRACT(YEAR FROM decision_date)::int AS year,
      COUNT(*)::int AS judgments
    FROM judgments
    WHERE decision_date IS NOT NULL
    GROUP BY year
    ORDER BY year DESC
  `;

  console.log(`NSW Supreme Court judgments by year:`);
  for (const r of yearly) {
    console.log(`  ${r.year}: ${r.judgments.toLocaleString()}`);
  }

  const [{ earliest }] = await sql`
    SELECT MIN(decision_date)::text AS earliest FROM judgments
  `;
  const [{ latest }] = await sql`
    SELECT MAX(decision_date)::text AS latest FROM judgments
  `;
  console.log(`\nDate range: ${earliest} to ${latest}`);

  await sql.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
