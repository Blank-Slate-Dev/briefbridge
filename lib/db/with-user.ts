// lib/db/with-user.ts
//
// STEP 4 of RLS (Path A): the per-request identity helper.
//
// WHY THIS EXISTS:
//   RLS policies read current_setting('app.user_id'). For that to be set when
//   a query runs, the SET and the query must share ONE transaction on ONE
//   pooled connection — because Supabase's transaction pooler reclaims the
//   connection (and discards SET LOCAL) the moment a transaction ends.
//
//   So every matter-scoped query must run INSIDE a transaction that first sets
//   app.user_id. This helper wraps that pattern.
//
// USAGE:
//   const rows = await withUser(userId, (tx) =>
//     tx.select().from(matters).where(eq(matters.id, matterId))
//   );
//
//   `tx` is a Drizzle transaction handle with the SAME API as `db`. Inside the
//   callback, app.user_id is set, so RLS policies see the user and grant the
//   right rows. Use `tx` (NOT `db`) for every query inside the callback — a
//   `db` call would run on a DIFFERENT connection without the variable.
//
// SAFETY DURING TRANSITION:
//   While the app still connects as the `postgres` role (BYPASSRLS), this
//   helper is harmless: it sets a variable that no policy needs yet (because
//   bypass ignores policies) and runs the query in a transaction. Behaviour is
//   identical. After the cutover to briefbridge_app, the SAME code starts being
//   enforced by RLS. That's the point: adopt the helper now, flip the
//   connection later, no query rewrite at cutover time.

import { sql } from 'drizzle-orm';
import { db } from '@/lib/db';

// The transaction handle type Drizzle hands the callback. We derive it from
// db.transaction so it always matches your Drizzle version exactly.
type TxParam = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Runs `fn` inside a transaction with app.user_id set to `userId`, so RLS
 * session-variable policies can see who is asking.
 *
 * IMPORTANT: inside `fn`, use the provided `tx` handle for ALL queries. Do not
 * use the module-level `db` inside the callback — it would run on a different
 * connection where app.user_id is NOT set.
 *
 * @param userId  the authenticated user's id (must be a real uuid; callers are
 *                always operating on behalf of a logged-in user)
 * @param fn      callback receiving the transaction handle
 */
export async function withUser<T>(
  userId: string,
  fn: (tx: TxParam) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    // set_config(key, value, is_local=true) === SET LOCAL: scoped to THIS
    // transaction, discarded when it ends. Parameterised, so no injection.
    await tx.execute(sql`select set_config('app.user_id', ${userId}, true)`);
    return fn(tx);
  });
}