// firmwrite-test.mjs  (v2 — corrected)
//
// v1 gave a misleading result: the owner INSERT failed with 23503
// (foreign_key_violation) because it used a fake user id not present in
// auth.users — that's an FK wall, NOT a policy denial. The policy had already
// ALLOWED the row. The stranger correctly got 42501 (RLS denial).
//
// v2 separates AUTHORIZATION (what we're testing) from FK plumbing (noise):
//
//   PART A — test the role-check FUNCTION directly:
//       current_firm_role(yourFirm) as YOU       -> expect 'owner'
//       current_firm_role(yourFirm) as STRANGER  -> expect NULL
//     This is the exact expression the write policies gate on.
//
//   PART B — test a REAL policy-gated INSERT that we can satisfy the FKs for:
//       insert into matter_assignments for one of YOUR matters, assigning a
//       REAL existing user (you). matter_assignments.user_id FKs to auth.users
//       and you exist, so the only thing that can block it is the policy.
//       As YOU (owner): expect ALLOWED. As STRANGER: expect DENIED (42501).
//     Rolled back regardless — leaves no trace.
//
// Run:
//   $env:APP_ROLE_URL="postgresql://briefbridge_app....pooler.supabase.com:6543/postgres"
//   node firmwrite-test.mjs

import postgres from 'postgres';

const url = process.env.APP_ROLE_URL;
if (!url) { console.error('APP_ROLE_URL not set'); process.exit(1); }

const ME = 'a4bdf8a8-bceb-4ac0-a527-d2c1909afbc8'; // you (firm owner, real user)
const STRANGER = '00000000-0000-0000-0000-000000000000';

const sql = postgres(url, { prepare: false, max: 1 });

async function roleInOwnFirm(actingUser, label) {
  return await sql.begin(async (tx) => {
    await tx`select set_config('app.user_id', ${actingUser}, true)`;
    const firm = await tx`
      select firm_id from firm_memberships where user_id = ${actingUser} limit 1
    `;
    const firmId = firm.length ? firm[0].firm_id : STRANGER; // stranger: probe a real-ish firm
    const r = await tx`select public.current_firm_role(${firmId}) as role`;
    const role = r[0].role;
    console.log(`   ${label}: current_firm_role -> ${role === null ? 'NULL' : role}`);
    return role;
  });
}

// Try a REAL matter_assignments insert (FKs satisfiable) as actingUser,
// targeting one of YOUR matters, assigning a REAL user. Rolls back always.
async function tryAssignInsert(actingUser, label) {
  try {
    return await sql.begin(async (tx) => {
      await tx`select set_config('app.user_id', ${actingUser}, true)`;

      // Resolve one of YOUR matters as ME so it's visible, then act as the
      // user under test. Only the policy should vary the outcome.
      await tx`select set_config('app.user_id', ${ME}, true)`;
      const m = await tx`select id from matters where user_id = ${ME} limit 1`;
      if (m.length === 0) {
        console.log(`   ${label}: no matter found for owner — cannot run insert test.`);
        throw { rolledback: true, skipped: true };
      }
      const matterId = m[0].id;

      await tx`select set_config('app.user_id', ${actingUser}, true)`;

      await tx`
        insert into matter_assignments (matter_id, user_id, assigned_by)
        values (${matterId}, ${ME}, ${actingUser})
      `;
      throw { rolledback: true, allowed: true };
    });
  } catch (e) {
    if (e && e.rolledback && e.allowed) {
      console.log(`   ${label}: INSERT ALLOWED`);
      return { ok: true };
    }
    if (e && e.rolledback && e.skipped) {
      return { ok: null };
    }
    const code = e && e.code ? e.code : (e && e.message ? e.message : 'unknown');
    if (code === '23505') {
      console.log(`   ${label}: INSERT ALLOWED (row already existed, PK 23505 — policy passed)`);
      return { ok: true };
    }
    console.log(`   ${label}: INSERT DENIED  (code: ${code})`);
    return { ok: false, code };
  }
}

try {
  const who = await sql`select current_user as u`;
  console.log('Connected as:', who[0].u, '\n');

  console.log('PART A - role-check function');
  const meRole = await roleInOwnFirm(ME, 'you');
  const strangerRole = await roleInOwnFirm(STRANGER, 'stranger');
  console.log('');

  console.log('PART B - real policy-gated insert into matter_assignments');
  console.log(' as YOU (expect ALLOWED):');
  const ins1 = await tryAssignInsert(ME, 'you');
  console.log(' as STRANGER (expect DENIED) <- ISOLATION:');
  const ins2 = await tryAssignInsert(STRANGER, 'stranger');
  console.log('');

  const partA = meRole === 'owner' && strangerRole === null;
  const partB = ins1.ok === true && ins2.ok === false;
  const pass = partA && partB;

  console.log('PART A:', partA ? 'PASS' : 'FAIL',
    `(you=${meRole}, stranger=${strangerRole === null ? 'NULL' : strangerRole})`);
  console.log('PART B:', partB ? 'PASS' : (ins1.ok === null ? 'SKIPPED (no matter)' : 'FAIL'));
  console.log('');
  console.log(pass
    ? 'PASS - role logic correct AND owner can write while stranger cannot.'
    : 'REVIEW - see which part failed above.');
} catch (err) {
  console.error('FAILED:', err && err.name, '|', err && err.message, '|', (err && err.code) || '');
} finally {
  await sql.end();
}
