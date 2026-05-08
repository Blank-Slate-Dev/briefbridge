// app/cases/page.tsx
import Link from 'next/link';
import { listJudgments, countJudgments, getDistinctYears } from '@/lib/queries';
import SearchBar from './_components/SearchBar';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 50;

interface CasesPageProps {
  // Next.js 15 passes searchParams as a Promise; we await it below.
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
  const currentPage = Number.isFinite(requestedPage) && requestedPage > 0 ? requestedPage : 1;

  const query = params.q?.trim() ?? '';
  const hasQuery = query.length > 0;

  const requestedYear = params.year ? parseInt(params.year, 10) : undefined;
  const year = Number.isFinite(requestedYear) ? requestedYear : undefined;

  const hasFilters = hasQuery || year !== undefined;

  // Fetch the page of results, the total count, and the year list — all in parallel.
  // Year list is independent of filters (always show every available year).
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
    <main className="mx-auto max-w-5xl px-6 py-12">
      <header className="mb-8">
        <h1 className="text-3xl font-semibold tracking-tight text-slate-900">
          Cases
        </h1>
      </header>

      <SearchBar availableYears={availableYears} />

      {/* Results summary: changes based on filters */}
      <div className="mb-6">
        <p className="text-sm text-slate-600">
          {totalCount === 0 && hasFilters ? (
            <>
              No judgments match{hasQuery && <> &ldquo;<span className="font-medium text-slate-900">{query}</span>&rdquo;</>}
              {year !== undefined && <> in <span className="font-medium text-slate-900">{year}</span></>}.
            </>
          ) : totalCount === 0 ? (
            'No judgments ingested yet.'
          ) : isOutOfRange ? (
            `No results on page ${currentPage}. Found ${totalCount.toLocaleString()} judgments across ${totalPages} pages.`
          ) : hasFilters ? (
            <>
              Found <span className="font-medium text-slate-900">{totalCount.toLocaleString()}</span> judgment{totalCount === 1 ? '' : 's'}
              {hasQuery && <> matching &ldquo;<span className="font-medium text-slate-900">{query}</span>&rdquo;</>}
              {year !== undefined && <> in <span className="font-medium text-slate-900">{year}</span></>}
              {' '}— showing {firstItemNumber.toLocaleString()}–{lastItemNumber.toLocaleString()}
              {hasQuery ? ', ranked by relevance' : ', most recent first'}
            </>
          ) : (
            <>
              Showing <span className="font-medium text-slate-900">{firstItemNumber.toLocaleString()}–{lastItemNumber.toLocaleString()}</span> of{' '}
              <span className="font-medium text-slate-900">{totalCount.toLocaleString()}</span> judgments — most recent first
            </>
          )}
        </p>
      </div>

      {totalCount === 0 && !hasFilters ? (
        <div className="rounded-lg border border-dashed border-slate-300 p-12 text-center">
          <p className="text-sm text-slate-500">
            Run{' '}
            <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs">
              npm run ingest:nsw -- &lt;url&gt;
            </code>{' '}
            to add a judgment.
          </p>
        </div>
      ) : totalCount === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-300 p-12 text-center">
          <p className="text-sm text-slate-500">
            Try a different search term or removing the year filter.
          </p>
        </div>
      ) : isOutOfRange ? (
        <div className="rounded-lg border border-dashed border-slate-300 p-12 text-center">
          <p className="text-sm text-slate-500">
            Page {currentPage} is past the end of the results.
          </p>
          <Link
            href={pageUrl(1)}
            className="mt-4 inline-block rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-700"
          >
            Go to page 1
          </Link>
        </div>
      ) : (
        <>
          <ul className="divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white">
            {judgments.map((j) => (
              <li key={j.id}>
                <Link
                  href={`/cases/${j.id}`}
                  className="block px-6 py-4 transition hover:bg-slate-50"
                >
                  <div className="flex items-baseline justify-between gap-4">
                    <h2 className="font-medium text-slate-900">
                      {j.caseName ?? 'Untitled judgment'}
                    </h2>
                    <span className="shrink-0 font-mono text-xs text-slate-500">
                      {j.citation}
                    </span>
                  </div>
                  <div className="mt-1 flex items-center gap-3 text-xs text-slate-500">
                    <span>{j.court}</span>
                    {j.decisionDate && (
                      <>
                        <span aria-hidden>·</span>
                        <span>{j.decisionDate}</span>
                      </>
                    )}
                  </div>
                  {j.catchwords && (
                    <p className="mt-2 line-clamp-2 text-sm text-slate-600">
                      {j.catchwords}
                    </p>
                  )}
                </Link>
              </li>
            ))}
          </ul>

          {/* Pagination controls — preserved from your previous implementation,
              now using pageUrl() helper to keep search/filter state across pages. */}
          {totalPages > 1 && (
            <nav
              className="mt-8 flex items-center justify-between"
              aria-label="Pagination"
            >
              <div className="flex-1">
                {hasPrevious ? (
                  <Link
                    href={pageUrl(currentPage - 1)}
                    className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
                  >
                    <span aria-hidden>←</span> Previous
                  </Link>
                ) : (
                  <span className="inline-flex items-center gap-1.5 rounded-md border border-slate-100 bg-slate-50 px-3 py-2 text-sm font-medium text-slate-300">
                    <span aria-hidden>←</span> Previous
                  </span>
                )}
              </div>

              <div className="text-sm text-slate-600">
                Page <span className="font-medium text-slate-900">{currentPage.toLocaleString()}</span>{' '}
                of <span className="font-medium text-slate-900">{totalPages.toLocaleString()}</span>
              </div>

              <div className="flex flex-1 justify-end">
                {hasNext ? (
                  <Link
                    href={pageUrl(currentPage + 1)}
                    className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
                  >
                    Next <span aria-hidden>→</span>
                  </Link>
                ) : (
                  <span className="inline-flex items-center gap-1.5 rounded-md border border-slate-100 bg-slate-50 px-3 py-2 text-sm font-medium text-slate-300">
                    Next <span aria-hidden>→</span>
                  </span>
                )}
              </div>
            </nav>
          )}
        </>
      )}
    </main>
  );
}
