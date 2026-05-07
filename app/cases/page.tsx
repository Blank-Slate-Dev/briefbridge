// app/cases/page.tsx
import Link from 'next/link';
import { listJudgments } from '@/lib/queries';

export const dynamic = 'force-dynamic';

export default async function CasesPage() {
  const judgments = await listJudgments();

  return (
    <main className="mx-auto max-w-5xl px-6 py-12">
      <header className="mb-10">
        <h1 className="text-3xl font-semibold tracking-tight text-slate-900">
          Cases
        </h1>
        <p className="mt-2 text-sm text-slate-600">
          {judgments.length === 0
            ? 'No judgments ingested yet.'
            : `${judgments.length} judgment${judgments.length === 1 ? '' : 's'} in your database`}
        </p>
      </header>

      {judgments.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-300 p-12 text-center">
          <p className="text-sm text-slate-500">
            Run{' '}
            <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs">
              npm run ingest:nsw -- &lt;url&gt;
            </code>{' '}
            to add a judgment.
          </p>
        </div>
      ) : (
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
      )}
    </main>
  );
}