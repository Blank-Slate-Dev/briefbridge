// lib/db/script-db.ts
//
// Privileged database connection for BACKEND SCRIPTS ONLY (embedding,
// ingestion, backfills, diagnostics).
//
// WHY THIS EXISTS, SEPARATE FROM lib/db/index.ts:
//   The app's connection (lib/db) uses DATABASE_URL → the `briefbridge_app`
//   restricted role, which has RLS enforced and is scoped per-request via
//   withUser(). That's correct for the web app (least privilege).
//
//   But backend scripts need to operate ACROSS ALL ROWS regardless of RLS —
//   e.g. embed every judgment, backfill every matter. Running them as
//   `briefbridge_app` makes them see ZERO rows (RLS matches nothing without an
//   app.user_id session var), which silently makes scripts no-op. (That's the
//   bug we hit: the embed script reported "0 judgments to embed" because it was
//   connecting as briefbridge_app and seeing nothing.)
//
//   So scripts use DIRECT_DATABASE_URL → the `postgres` superuser role, which
//   bypasses RLS and sees everything.
//
// SECURITY: DIRECT_DATABASE_URL is the superuser connection. It must ONLY ever
// be set in local/CI script environments — NEVER in the deployed app (Vercel).
// The web app must stay on the restricted role.
//
// USAGE (in a script):
//   import { db, schema } from '../lib/db/script-db';

import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

const connectionString =
  process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error(
    'Neither DIRECT_DATABASE_URL nor DATABASE_URL is set. ' +
      'Scripts need DIRECT_DATABASE_URL (the postgres superuser connection) ' +
      'to bypass RLS. Check your .env.local file.',
  );
}

if (!process.env.DIRECT_DATABASE_URL) {
  // Loud warning: falling back to the app connection means RLS is in force and
  // the script will likely see zero rows. Better to fail visibly than no-op.
  // eslint-disable-next-line no-console
  console.warn(
    '\n[script-db] WARNING: DIRECT_DATABASE_URL is not set — falling back to ' +
      'DATABASE_URL (the restricted app role). RLS will be enforced and this ' +
      'script may see NO rows. Set DIRECT_DATABASE_URL in .env.local.\n',
  );
}

// `prepare: false` for pooler compatibility (also fine on a direct connection).
const client = postgres(connectionString, { prepare: false });

export const db = drizzle(client, { schema });
export { schema };