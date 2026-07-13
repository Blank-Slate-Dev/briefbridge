// app/(app)/admin/analytics/page.tsx
//
// Founder analytics dashboard. Server Component.
// Gated in code to ADMIN_EMAILS; everyone else redirects to /matters.
//
// Styling note: all colours are set EXPLICITLY (navy text on cream cards)
// because the app shell's inherited text colour is light (for the navy
// sidebar) and disappears on the light content background.

import { redirect } from 'next/navigation';
import { sql } from 'drizzle-orm';
import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';

const ADMIN_EMAILS = ['osr9915@gmail.com'];

const NAVY = '#1a1f2e';
const NAVY_SOFT = '#3a4256';
const MUTED = '#8a8577';
const BORDER = '#e7e0d2';
const BORDER_SOFT = '#f0ebe0';
const CARD_BG = '#ffffff';

export const dynamic = 'force-dynamic';

export default async function AnalyticsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user || !ADMIN_EMAILS.includes(user.email ?? '')) {
    redirect('/matters');
  }

  const [totalsRows, weeklyRows, recentRows, emptyRows] = await Promise.all([
    db.execute<{
      total_events: number;
      distinct_users: number;
      events_7d: number;
      events_30d: number;
    }>(sql`
      SELECT
        count(*)::int AS total_events,
        count(distinct user_id)::int AS distinct_users,
        count(*) FILTER (WHERE created_at > now() - interval '7 days')::int AS events_7d,
        count(*) FILTER (WHERE created_at > now() - interval '30 days')::int AS events_30d
      FROM analytics_events
      WHERE event_type = 'chat_query'
    `),
    db.execute<{
      week: string;
      user_id: string;
      queries: number;
    }>(sql`
      SELECT
        to_char(date_trunc('week', created_at), 'YYYY-MM-DD') AS week,
        user_id,
        count(*)::int AS queries
      FROM analytics_events
      WHERE event_type = 'chat_query'
        AND created_at > now() - interval '8 weeks'
      GROUP BY 1, 2
      ORDER BY 1 DESC, 3 DESC
    `),
    db.execute<{
      created_at: string;
      user_id: string;
      event_type: string;
      metadata: Record<string, unknown>;
    }>(sql`
      SELECT created_at::text, user_id, event_type, metadata
      FROM analytics_events
      ORDER BY created_at DESC
      LIMIT 50
    `),
    db.execute<{ empty_30d: number; queries_30d: number }>(sql`
      SELECT
        count(*) FILTER (WHERE event_type = 'search_empty')::int AS empty_30d,
        count(*) FILTER (WHERE event_type = 'chat_query')::int AS queries_30d
      FROM analytics_events
      WHERE created_at > now() - interval '30 days'
    `),
  ]);

  const totals = totalsRows[0];
  const empty = emptyRows[0];
  const emptyRate =
    empty && empty.queries_30d > 0
      ? ((empty.empty_30d / empty.queries_30d) * 100).toFixed(1)
      : '0.0';

  return (
    <div style={{ padding: '2rem', maxWidth: 960, color: NAVY }}>
      <h1 style={{ fontSize: '1.4rem', marginBottom: '1.5rem', color: NAVY }}>
        Usage analytics
      </h1>

      <section style={{ display: 'flex', gap: '1rem', marginBottom: '2rem', flexWrap: 'wrap' }}>
        <Stat label="Total queries" value={totals?.total_events ?? 0} />
        <Stat label="Distinct users" value={totals?.distinct_users ?? 0} />
        <Stat label="Queries (7d)" value={totals?.events_7d ?? 0} />
        <Stat label="Queries (30d)" value={totals?.events_30d ?? 0} />
        <Stat label="Empty-retrieval rate (30d)" value={`${emptyRate}%`} />
      </section>

      <h2 style={{ fontSize: '1.1rem', margin: '1rem 0 .5rem', color: NAVY }}>
        Queries per user per week (8 weeks)
      </h2>
      <table style={{ borderCollapse: 'collapse', width: '100%', marginBottom: '2rem' }}>
        <thead>
          <tr>
            <Th>Week starting</Th><Th>User</Th><Th>Queries</Th>
          </tr>
        </thead>
        <tbody>
          {weeklyRows.length === 0 && (
            <tr><Td colSpan={3} muted>No query events yet — send a chat message to generate the first one.</Td></tr>
          )}
          {weeklyRows.map((r, i) => (
            <tr key={i}>
              <Td>{r.week}</Td>
              <Td mono>{r.user_id.slice(0, 8)}…</Td>
              <Td>{r.queries}</Td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2 style={{ fontSize: '1.1rem', margin: '1rem 0 .5rem', color: NAVY }}>
        Recent events
      </h2>
      <table style={{ borderCollapse: 'collapse', width: '100%' }}>
        <thead>
          <tr>
            <Th>Time</Th><Th>User</Th><Th>Event</Th><Th>Metadata</Th>
          </tr>
        </thead>
        <tbody>
          {recentRows.length === 0 && (
            <tr><Td colSpan={4} muted>No events recorded yet.</Td></tr>
          )}
          {recentRows.map((r, i) => (
            <tr key={i}>
              <Td mono>{r.created_at.slice(0, 19)}</Td>
              <Td mono>{r.user_id.slice(0, 8)}…</Td>
              <Td>{r.event_type}</Td>
              <Td mono small>{JSON.stringify(r.metadata)}</Td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div style={{ background: CARD_BG, border: `1px solid ${BORDER}`, borderRadius: 12, padding: '1rem 1.25rem', minWidth: 150 }}>
      <div style={{ fontSize: '1.5rem', fontWeight: 600, color: NAVY }}>{value}</div>
      <div style={{ fontSize: '.8rem', color: MUTED }}>{label}</div>
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th style={{ textAlign: 'left', borderBottom: `1px solid ${BORDER}`, padding: '.4rem .5rem', fontSize: '.8rem', color: MUTED, fontWeight: 600 }}>
      {children}
    </th>
  );
}

function Td({
  children,
  mono,
  small,
  muted,
  colSpan,
}: {
  children: React.ReactNode;
  mono?: boolean;
  small?: boolean;
  muted?: boolean;
  colSpan?: number;
}) {
  return (
    <td
      colSpan={colSpan}
      style={{
        borderBottom: `1px solid ${BORDER_SOFT}`,
        padding: '.4rem .5rem',
        fontFamily: mono ? 'monospace' : undefined,
        fontSize: small ? '.7rem' : '.85rem',
        color: muted ? MUTED : NAVY_SOFT,
        verticalAlign: 'top',
      }}
    >
      {children}
    </td>
  );
}