// app/(app)/admin/analytics/page.tsx
//
// Founder analytics dashboard. Server Component.
// Gated in code to ADMIN_EMAILS; everyone else redirects to /matters.
//
// =============================================================================
// THREE SOURCES, THREE DIFFERENT QUESTIONS
// =============================================================================
//
//   Google Search Console — who found us THROUGH GOOGLE. Clicks, impressions,
//   which queries and which pages. Blind to every other route in: direct,
//   referral, anything shared in a message.
//
//   Site traffic (analytics_events, page_view) — which pages actually get
//   reached, by anyone, signed in or not. Founder visits are excluded at
//   write time, so the numbers mean something.
//
//   In-app usage (analytics_events, chat_query) — what people DO once here.
//   The only one of the three that measures the product rather than the
//   marketing.
//
// The gap that matters is between the second and third: plenty of page views
// with no queries means people arrive and bounce, which is a very different
// problem from not being found at all.
//
// Styling note: all colours are set EXPLICITLY (navy text on cream cards)
// because the app shell's inherited text colour is light (for the navy
// sidebar) and disappears on the light content background.

import { redirect } from 'next/navigation';
import { sql } from 'drizzle-orm';
import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import { gscQuery, gscTotals, isGscConfigured } from '@/lib/gsc';
import { ADMIN_EMAILS } from '@/lib/analytics';

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

  // Search Console data (Google search performance). Fetched in the same
  // wave as the in-app analytics; each helper returns [] on failure so a
  // Google outage can't break the dashboard. Data lags ~2 days.
  const gscEnabled = isGscConfigured();
  const [
    totalsRows,
    weeklyRows,
    recentRows,
    emptyRows,
    trafficTotalsRows,
    trafficPagesRows,
    trafficDailyRows,
    gscTotals28,
    gscDaily,
    gscPages,
    gscQueries,
    gscCountries,
  ] = await Promise.all([
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
        AND user_id IS NOT NULL
        AND created_at > now() - interval '8 weeks'
      GROUP BY 1, 2
      ORDER BY 1 DESC, 3 DESC
    `),
    db.execute<{
      created_at: string;
      user_id: string | null;
      event_type: string;
      metadata: Record<string, unknown>;
    }>(sql`
      SELECT created_at::text, user_id, event_type, metadata
      FROM analytics_events
      WHERE event_type <> 'page_view'
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

    // ---- Site traffic -----------------------------------------------------
    // signed_in_7d counts views by people with an account, which is the
    // number that separates "strangers landing on legislation pages" from
    // "someone actually using the app".
    db.execute<{
      views_7d: number;
      views_30d: number;
      signed_in_7d: number;
      distinct_paths_30d: number;
    }>(sql`
      SELECT
        count(*) FILTER (WHERE created_at > now() - interval '7 days')::int AS views_7d,
        count(*) FILTER (WHERE created_at > now() - interval '30 days')::int AS views_30d,
        count(*) FILTER (
          WHERE created_at > now() - interval '7 days' AND user_id IS NOT NULL
        )::int AS signed_in_7d,
        count(DISTINCT metadata->>'path') FILTER (
          WHERE created_at > now() - interval '30 days'
        )::int AS distinct_paths_30d
      FROM analytics_events
      WHERE event_type = 'page_view'
    `),
    db.execute<{ path: string; views: number; signed_in: number }>(sql`
      SELECT
        metadata->>'path' AS path,
        count(*)::int AS views,
        count(*) FILTER (WHERE user_id IS NOT NULL)::int AS signed_in
      FROM analytics_events
      WHERE event_type = 'page_view'
        AND created_at > now() - interval '30 days'
      GROUP BY 1
      ORDER BY 2 DESC
      LIMIT 20
    `),
    db.execute<{ day: string; views: number }>(sql`
      SELECT
        to_char(date_trunc('day', created_at), 'YYYY-MM-DD') AS day,
        count(*)::int AS views
      FROM analytics_events
      WHERE event_type = 'page_view'
        AND created_at > now() - interval '14 days'
      GROUP BY 1
      ORDER BY 1 DESC
    `),

    gscEnabled ? gscTotals(28) : Promise.resolve({ clicks: 0, impressions: 0, ctr: 0, position: 0 }),
    gscEnabled ? gscQuery({ dimensions: ['date'], days: 28, rowLimit: 1000 }) : Promise.resolve([]),
    gscEnabled ? gscQuery({ dimensions: ['page'], days: 28, rowLimit: 15 }) : Promise.resolve([]),
    gscEnabled ? gscQuery({ dimensions: ['query'], days: 28, rowLimit: 15 }) : Promise.resolve([]),
    gscEnabled ? gscQuery({ dimensions: ['country'], days: 28, rowLimit: 8 }) : Promise.resolve([]),
  ]);

  const totals = totalsRows[0];
  const empty = emptyRows[0];
  const traffic = trafficTotalsRows[0];
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

      {/* ===================== SITE TRAFFIC ===================== */}
      <h2 style={{ fontFamily: 'Georgia, serif', fontSize: '1.25rem', margin: '2.5rem 0 .25rem', color: NAVY }}>
        Site traffic
      </h2>
      <p style={{ fontSize: '.8rem', color: MUTED, marginBottom: '1rem' }}>
        All visits, not just Google · your own signed-in visits are excluded ·
        city and referrer breakdowns are in Vercel Analytics
      </p>

      <section style={{ display: 'flex', gap: '1rem', marginBottom: '1.5rem', flexWrap: 'wrap' }}>
        <Stat label="Page views (7d)" value={traffic?.views_7d ?? 0} />
        <Stat label="Page views (30d)" value={traffic?.views_30d ?? 0} />
        <Stat label="Signed-in views (7d)" value={traffic?.signed_in_7d ?? 0} />
        <Stat label="Distinct pages (30d)" value={traffic?.distinct_paths_30d ?? 0} />
      </section>

      <h3 style={{ fontSize: '1rem', margin: '1.25rem 0 .5rem', color: NAVY }}>
        Most-viewed pages (30d)
      </h3>
      <table style={{ borderCollapse: 'collapse', width: '100%', marginBottom: '1.5rem' }}>
        <thead>
          <tr><Th>Path</Th><Th>Views</Th><Th>Signed in</Th></tr>
        </thead>
        <tbody>
          {trafficPagesRows.length === 0 && (
            <tr><Td colSpan={3} muted>No page views yet — deploy, then visit a page on production.</Td></tr>
          )}
          {trafficPagesRows.map((r, i) => (
            <tr key={i}>
              <Td small mono>{r.path ?? '—'}</Td>
              <Td>{r.views}</Td>
              <Td>{r.signed_in}</Td>
            </tr>
          ))}
        </tbody>
      </table>

      <h3 style={{ fontSize: '1rem', margin: '1.25rem 0 .5rem', color: NAVY }}>
        Daily page views (14d)
      </h3>
      <table style={{ borderCollapse: 'collapse', width: '100%', marginBottom: '2.5rem' }}>
        <thead>
          <tr><Th>Date</Th><Th>Views</Th></tr>
        </thead>
        <tbody>
          {trafficDailyRows.length === 0 && (
            <tr><Td colSpan={2} muted>No page views yet.</Td></tr>
          )}
          {trafficDailyRows.map((r, i) => (
            <tr key={i}>
              <Td mono>{r.day}</Td>
              <Td>{r.views}</Td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* ===================== SEARCH CONSOLE ===================== */}
      <h2 style={{ fontFamily: 'Georgia, serif', fontSize: '1.25rem', margin: '2.5rem 0 .25rem', color: NAVY }}>
        Google Search performance
      </h2>
      <p style={{ fontSize: '.8rem', color: MUTED, marginBottom: '1rem' }}>
        Last 28 days · data lags ~2 days · source: Search Console API
      </p>

      {!gscEnabled ? (
        <p style={{ fontSize: '.9rem', color: MUTED }}>
          Not configured — set GSC_CLIENT_EMAIL and GSC_PRIVATE_KEY.
        </p>
      ) : (
        <>
          <section style={{ display: 'flex', gap: '1rem', marginBottom: '1.5rem', flexWrap: 'wrap' }}>
            <Stat label="Clicks" value={gscTotals28.clicks} />
            <Stat label="Impressions" value={gscTotals28.impressions} />
            <Stat label="CTR" value={`${(gscTotals28.ctr * 100).toFixed(2)}%`} />
            <Stat label="Avg position" value={gscTotals28.position.toFixed(1)} />
          </section>

          <h3 style={{ fontSize: '1rem', margin: '1.25rem 0 .5rem', color: NAVY }}>Daily trend</h3>
          <table style={{ borderCollapse: 'collapse', width: '100%', marginBottom: '1.5rem' }}>
            <thead>
              <tr><Th>Date</Th><Th>Clicks</Th><Th>Impressions</Th><Th>CTR</Th><Th>Position</Th></tr>
            </thead>
            <tbody>
              {gscDaily.length === 0 && (
                <tr><Td colSpan={5} muted>No data yet.</Td></tr>
              )}
              {[...gscDaily].reverse().slice(0, 14).map((r) => (
                <tr key={r.keys[0]}>
                  <Td mono>{r.keys[0]}</Td>
                  <Td>{r.clicks}</Td>
                  <Td>{r.impressions}</Td>
                  <Td>{(r.ctr * 100).toFixed(1)}%</Td>
                  <Td>{r.position.toFixed(1)}</Td>
                </tr>
              ))}
            </tbody>
          </table>

          <h3 style={{ fontSize: '1rem', margin: '1.25rem 0 .5rem', color: NAVY }}>Top pages</h3>
          <table style={{ borderCollapse: 'collapse', width: '100%', marginBottom: '1.5rem' }}>
            <thead>
              <tr><Th>Page</Th><Th>Clicks</Th><Th>Impr.</Th><Th>CTR</Th><Th>Pos.</Th></tr>
            </thead>
            <tbody>
              {gscPages.length === 0 && (
                <tr><Td colSpan={5} muted>No data yet.</Td></tr>
              )}
              {gscPages.map((r) => (
                <tr key={r.keys[0]}>
                  <Td small mono>{r.keys[0].replace('https://briefbridge.ai', '')}</Td>
                  <Td>{r.clicks}</Td>
                  <Td>{r.impressions}</Td>
                  <Td>{(r.ctr * 100).toFixed(1)}%</Td>
                  <Td>{r.position.toFixed(1)}</Td>
                </tr>
              ))}
            </tbody>
          </table>

          <h3 style={{ fontSize: '1rem', margin: '1.25rem 0 .5rem', color: NAVY }}>Top search queries</h3>
          <table style={{ borderCollapse: 'collapse', width: '100%', marginBottom: '1.5rem' }}>
            <thead>
              <tr><Th>Query</Th><Th>Clicks</Th><Th>Impr.</Th><Th>CTR</Th><Th>Pos.</Th></tr>
            </thead>
            <tbody>
              {gscQueries.length === 0 && (
                <tr><Td colSpan={5} muted>No query data yet — Google withholds queries with very low volume.</Td></tr>
              )}
              {gscQueries.map((r) => (
                <tr key={r.keys[0]}>
                  <Td small>{r.keys[0]}</Td>
                  <Td>{r.clicks}</Td>
                  <Td>{r.impressions}</Td>
                  <Td>{(r.ctr * 100).toFixed(1)}%</Td>
                  <Td>{r.position.toFixed(1)}</Td>
                </tr>
              ))}
            </tbody>
          </table>

          <h3 style={{ fontSize: '1rem', margin: '1.25rem 0 .5rem', color: NAVY }}>Countries</h3>
          <table style={{ borderCollapse: 'collapse', width: '100%', marginBottom: '2.5rem' }}>
            <thead>
              <tr><Th>Country</Th><Th>Clicks</Th><Th>Impr.</Th><Th>CTR</Th></tr>
            </thead>
            <tbody>
              {gscCountries.length === 0 && (
                <tr><Td colSpan={4} muted>No data yet.</Td></tr>
              )}
              {gscCountries.map((r) => (
                <tr key={r.keys[0]}>
                  <Td mono>{r.keys[0].toUpperCase()}</Td>
                  <Td>{r.clicks}</Td>
                  <Td>{r.impressions}</Td>
                  <Td>{(r.ctr * 100).toFixed(1)}%</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {/* ===================== IN-APP USAGE ===================== */}
      <h2 style={{ fontFamily: 'Georgia, serif', fontSize: '1.25rem', margin: '2.5rem 0 1rem', color: NAVY }}>
        In-app usage
      </h2>

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
              <Td mono>{shortId(r.user_id)}</Td>
              <Td>{r.queries}</Td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2 style={{ fontSize: '1.1rem', margin: '1rem 0 .5rem', color: NAVY }}>
        Recent events
      </h2>
      <p style={{ fontSize: '.8rem', color: MUTED, marginBottom: '.75rem' }}>
        Page views excluded — they would drown everything else. See Site
        traffic above.
      </p>
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
              <Td mono>{shortId(r.user_id)}</Td>
              <Td>{r.event_type}</Td>
              <Td mono small>{JSON.stringify(r.metadata)}</Td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** user_id is nullable since migration 0023 — anonymous page views have none. */
function shortId(id: string | null): string {
  if (!id) return 'anon';
  return `${id.slice(0, 8)}…`;
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