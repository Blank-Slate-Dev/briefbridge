import postgres from 'postgres';
const url = process.env.APP_ROLE_URL;
if (!url) { console.error('APP_ROLE_URL not set'); process.exit(1); }
const ME = 'a4bdf8a8-bceb-4ac0-a527-d2c1909afbc8';
const OTHER = '00000000-0000-0000-0000-000000000000';
const sql = postgres(url, { prepare: false, max: 1 });
async function asUser(userId, label) {
  return await sql.begin(async (tx) => {
    await tx`select set_config('app.user_id', ${userId}, true)`;
    const membership = await tx`select firm_id, role from firm_memberships where user_id = ${userId} limit 1`;
    const assignments = await tx`select count(*)::int as n from matter_assignments where user_id = ${userId}`;
    const firmsVisible = await tx`select count(*)::int as n from firms`;
    console.log(label);
    console.log('   firm_memberships (own):   ' + membership.length + (membership[0] ? '  role: ' + membership[0].role : ''));
    console.log('   matter_assignments (own): ' + assignments[0].n);
    console.log('   firms visible:            ' + firmsVisible[0].n);
    return { membership: membership.length, assignments: assignments[0].n, firms: firmsVisible[0].n };
  });
}
try {
  const who = await sql`select current_user as u`;
  console.log('Connected as:', who[0].u, '\n');
  const me = await asUser(ME, 'TEST 1 - you (expect membership 1, assignments 4, firms 1)');
  console.log('');
  const other = await asUser(OTHER, 'TEST 2 - different user (expect all 0) <- ISOLATION');
  console.log('');
  const pass = me.membership === 1 && me.assignments === 4 && me.firms === 1 && other.membership === 0 && other.assignments === 0 && other.firms === 0;
  console.log(pass ? 'PASS - firm-table policies enforce correctly.' : 'UNEXPECTED - review before cutover.');
} catch (err) {
  console.error('FAILED:', err.name, '|', err.message, '|', err.code || '');
} finally { await sql.end(); }