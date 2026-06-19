import postgres from 'postgres';
const url = process.env.APP_ROLE_URL;
if (!url) { console.error('APP_ROLE_URL not set'); process.exit(1); }
const ME = 'a4bdf8a8-bceb-4ac0-a527-d2c1909afbc8';
const OTHER = '00000000-0000-0000-0000-000000000000';
const sql = postgres(url, { prepare: false, max: 1 });
async function countAs(userId) {
  return await sql.begin(async (tx) => {
    if (userId !== null) await tx`select set_config('app.user_id', ${userId}, true)`;
    const r = await tx`select count(*)::int as n from matters`;
    return r[0].n;
  });
}
try {
  const who = await sql`select current_user as u`;
  console.log('Connected as:', who[0].u, '\n');
  const a = await countAs(ME);
  console.log('TEST 1 correct identity:', a, '(expect 4)');
  const b = await countAs(OTHER);
  console.log('TEST 2 wrong identity:  ', b, '(expect 0) <- ISOLATION PROOF');
  const c = await countAs(null);
  console.log('TEST 3 no identity:     ', c, '(expect 0)\n');
  console.log(a === 4 && b === 0 && c === 0 ? 'PASS' : 'UNEXPECTED - do not cut over');
} catch (e) {
  console.error('FAILED:', e.name, '|', e.message, '|', e.code || '');
} finally { await sql.end(); }