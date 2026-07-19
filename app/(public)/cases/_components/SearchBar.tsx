// app/cases/_components/SearchBar.tsx
'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useState, useTransition, type FormEvent } from 'react';

interface SearchBarProps {
  /** All distinct years present in the database, descending (most recent first). */
  availableYears: number[];
}

/**
 * The search + year filter at the top of /cases.
 *
 * Form-based UX: the user types a query, optionally picks a year, then submits
 * (Enter or click "Search"). On submit, we update the URL with ?q=...&year=...
 * and navigate. The server-side page component re-renders with the new params.
 *
 * Why URL-driven (not local state):
 *   - URLs are shareable: a lawyer can paste "/cases?q=defamation&year=2024" to
 *     a colleague.
 *   - Browser back/forward works correctly.
 *   - Server-side render gives instant first-paint with the right results.
 *
 * Why not live-as-you-type:
 *   - Each keystroke would trigger a full Postgres FTS query — wasteful.
 *   - Server-side rendered pages can't update mid-stream like a SPA.
 *   - Lawyers generally type a full query and submit, not search-as-they-think.
 *
 * Pagination is reset to page 1 whenever filters change, since "page 7 of
 * results for 'defamation'" makes no sense after switching to "negligence".
 */
export default function SearchBar({ availableYears }: SearchBarProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  // Local state seeded from current URL params; the form is uncontrolled-ish
  // in that the URL is the source of truth, but the inputs reflect what the
  // user has currently typed/selected before they submit.
  const [query, setQuery] = useState(searchParams.get('q') ?? '');
  const [year, setYear] = useState(searchParams.get('year') ?? '');

  function handleSubmit(e: FormEvent) {
    e.preventDefault();

    const params = new URLSearchParams();
    if (query.trim()) params.set('q', query.trim());
    if (year) params.set('year', year);
    // Always reset to page 1 on a new search.

    const queryString = params.toString();
    const url = queryString ? `/cases?${queryString}` : '/cases';

    startTransition(() => {
      router.push(url);
    });
  }

  function handleClear() {
    setQuery('');
    setYear('');
    startTransition(() => {
      router.push('/cases');
    });
  }

  const hasActiveFilters = query.trim() !== '' || year !== '';

  return (
    <form
      onSubmit={handleSubmit}
      className="mb-8 flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-4 sm:flex-row sm:items-center"
      role="search"
      aria-label="Search judgments"
    >
      <div className="relative flex-1">
        <svg
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          viewBox="0 0 24 24"
          aria-hidden
        >
          <circle cx="11" cy="11" r="8" />
          <path d="m21 21-4.3-4.3" />
        </svg>
        <input
          type="search"
          name="q"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search case names, citations, catchwords, and judgment text..."
          className="w-full rounded-md border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-400"
          aria-label="Search query"
          autoComplete="off"
        />
      </div>

      <div className="flex items-center gap-2">
        <label htmlFor="year-filter" className="sr-only">
          Year
        </label>
        <select
          id="year-filter"
          name="year"
          value={year}
          onChange={(e) => setYear(e.target.value)}
          className="rounded-md border border-slate-200 bg-white py-2 pl-3 pr-8 text-sm text-slate-900 focus:border-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-400"
          aria-label="Filter by year"
        >
          <option value="">All years</option>
          {availableYears.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>

        <button
          type="submit"
          disabled={isPending}
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-700 disabled:cursor-wait disabled:opacity-60"
        >
          {isPending ? 'Searching…' : 'Search'}
        </button>

        {hasActiveFilters && (
          <button
            type="button"
            onClick={handleClear}
            disabled={isPending}
            className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-50 disabled:cursor-wait disabled:opacity-60"
          >
            Clear
          </button>
        )}
      </div>
    </form>
  );
}
