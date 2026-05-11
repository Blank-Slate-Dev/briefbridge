// app/cases/page.tsx
//
// Public judgment-database list view. Refactored from Tailwind to the
// bb-* design system. No behavioural changes — same SSR pagination,
// same search params, same SearchBar component (which keeps its own
// styling for now since the user didn't share it).
//
// If SearchBar later needs to be themed too, replace the import here.

import Link from 'next/link';
import { listJudgments, countJudgments, getDistinctYears } from '@/lib/queries';
import SearchBar from './_components/SearchBar';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 50;

interface CasesPageProps {
  searchParams: Promise<{
    page?: string;
    q?: string;
    year?: string;
  }>;
}

export default async function CasesPage({ searchParams }: CasesPageProps) {
  const params = await searchParams;

  // Parse and validate URL params.
  const requestedPage = parseInt(params.page ?? '1', 10);
  const currentPage =
    Number.isFinite(requestedPage) && requestedPage > 0 ? requestedPage : 1;

  const query = params.q?.trim() ?? '';
  const hasQuery = query.length > 0;

  const requestedYear = params.year ? parseInt(params.year, 10) : undefined;
  const year = Number.isFinite(requestedYear) ? requestedYear : undefined;

  const hasFilters = hasQuery || year !== undefined;

  // Fetch in parallel.
  const [judgments, totalCount, availableYears] = await Promise.all([
    listJudgments({ page: currentPage, pageSize: PAGE_SIZE, query, year }),
    countJudgments({ query, year }),
    getDistinctYears(),
  ]);

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const isOutOfRange = currentPage > totalPages && totalCount > 0;
  const firstItemNumber = (currentPage - 1) * PAGE_SIZE + 1;
  const lastItemNumber = Math.min(currentPage * PAGE_SIZE, totalCount);

  const hasPrevious = currentPage > 1;
  const hasNext = currentPage < totalPages;

  // Builds a URL preserving the current search/filter state but with a different page.
  const pageUrl = (page: number) => {
    const sp = new URLSearchParams();
    if (hasQuery) sp.set('q', query);
    if (year !== undefined) sp.set('year', String(year));
    if (page > 1) sp.set('page', String(page));
    const qs = sp.toString();
    return qs ? `/cases?${qs}` : '/cases';
  };

  return (
    <main className="bb-cases-main">
      <header className="bb-cases-head">
        <div className="bb-cases-eyebrow">NSW judgment database</div>
        <h1 className="bb-cases-title">
          Cases <em>and authorities</em>
        </h1>
        <p className="bb-cases-sub">
          Search and browse the full text of NSW Supreme Court judgments
          ingested into BriefBridge. Click a result to read the judgment, or
          ask a research question in chat.
        </p>
      </header>

      <div className="bb-cases-toolbar">
        <SearchBar availableYears={availableYears} />
      </div>

      <div className="bb-cases-summary">
        {totalCount === 0 && hasFilters ? (
          <>
            No judgments match
            {hasQuery && (
              <>
                {' '}&ldquo;<strong>{query}</strong>&rdquo;
              </>
            )}
            {year !== undefined && (
              <>
                {' '}in <strong>{year}</strong>
              </>
            )}
            .
          </>
        ) : totalCount === 0 ? (
          'No judgments ingested yet.'
        ) : isOutOfRange ? (
          `No results on page ${currentPage}. Found ${totalCount.toLocaleString()} judgments across ${totalPages} pages.`
        ) : hasFilters ? (
          <>
            Found <strong>{totalCount.toLocaleString()}</strong> judgment
            {totalCount === 1 ? '' : 's'}
            {hasQuery && (
              <>
                {' '}matching &ldquo;<strong>{query}</strong>&rdquo;
              </>
            )}
            {year !== undefined && (
              <>
                {' '}in <strong>{year}</strong>
              </>
            )}
            {' '}— showing {firstItemNumber.toLocaleString()}–
            {lastItemNumber.toLocaleString()}
            {hasQuery ? ', ranked by relevance' : ', most recent first'}
          </>
        ) : (
          <>
            Showing{' '}
            <strong>
              {firstItemNumber.toLocaleString()}–{lastItemNumber.toLocaleString()}
            </strong>{' '}
            of <strong>{totalCount.toLocaleString()}</strong> judgments — most
            recent first
          </>
        )}
      </div>

      {totalCount === 0 && !hasFilters ? (
        <div className="bb-cases-empty">
          <p>
            Run <code>npm run ingest:nsw -- &lt;url&gt;</code> to add a judgment.
          </p>
        </div>
      ) : totalCount === 0 ? (
        <div className="bb-cases-empty">
          <p>Try a different search term or remove the year filter.</p>
        </div>
      ) : isOutOfRange ? (
        <div className="bb-cases-empty">
          <p>Page {currentPage} is past the end of the results.</p>
          <Link href={pageUrl(1)} className="bb-cases-empty-action">
            Go to page 1
          </Link>
        </div>
      ) : (
        <>
          <ul className="bb-cases-list">
            {judgments.map((j) => (
              <li key={j.id}>
                <Link href={`/cases/${j.id}`} className="bb-cases-row">
                  <div className="bb-cases-row-head">
                    <h2 className="bb-cases-row-name">
                      {j.caseName ?? 'Untitled judgment'}
                    </h2>
                    <span className="bb-cases-row-cite">{j.citation}</span>
                  </div>
                  <div className="bb-cases-row-meta">
                    <span>{j.court}</span>
                    {j.decisionDate && (
                      <>
                        <span aria-hidden className="bb-cases-row-meta-sep">
                          ·
                        </span>
                        <span>{j.decisionDate}</span>
                      </>
                    )}
                  </div>
                  {j.catchwords && (
                    <p className="bb-cases-row-catchwords">{j.catchwords}</p>
                  )}
                </Link>
              </li>
            ))}
          </ul>

          {totalPages > 1 && (
            <nav className="bb-cases-pagination" aria-label="Pagination">
              {hasPrevious ? (
                <Link
                  href={pageUrl(currentPage - 1)}
                  className="bb-cases-page-btn"
                >
                  <span aria-hidden>←</span> Previous
                </Link>
              ) : (
                <span className="bb-cases-page-btn bb-cases-page-btn-disabled">
                  <span aria-hidden>←</span> Previous
                </span>
              )}

              <div className="bb-cases-page-info">
                Page <strong>{currentPage.toLocaleString()}</strong> of{' '}
                <strong>{totalPages.toLocaleString()}</strong>
              </div>

              {hasNext ? (
                <Link
                  href={pageUrl(currentPage + 1)}
                  className="bb-cases-page-btn"
                >
                  Next <span aria-hidden>→</span>
                </Link>
              ) : (
                <span className="bb-cases-page-btn bb-cases-page-btn-disabled">
                  Next <span aria-hidden>→</span>
                </span>
              )}
            </nav>
          )}
        </>
      )}
    </main>
  );
}
