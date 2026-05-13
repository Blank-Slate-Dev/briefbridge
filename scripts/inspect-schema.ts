import { config } from 'dotenv';
config({ path: '.env.local' });
import postgres from 'postgres';

const sql = postgres(process.env.DATABASE_URL!, { prepare: false });

async function main() {
  const cols = await sql`
    SELECT column_name, data_type
    FROM information_schema.columns
    WHERE table_name = 'legislation_sections'
    ORDER BY ordinal_position
  `;
  console.log('--- COLUMNS ---');
  console.table(cols);

  const sample = await sql`
    SELECT *
    FROM legislation_sections
    WHERE legislation_id = '937408c3-11b7-42e1-8bb2-f6ef72c6e108'
      AND level = 'section'
      AND number = '1'
    LIMIT 1
  `;
  console.log('--- SAMPLE ROW (s 1) ---');
  console.log(JSON.stringify(sample[0], null, 2));

  await sql.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
