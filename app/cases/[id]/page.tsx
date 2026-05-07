// app/cases/[id]/page.tsx
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getJudgment } from '@/lib/queries';

export const dynamic = 'force-dynamic';

interface CitedCase {
  name: string;
  citation: string;
  raw: string;
}

interface CitedLegislation {
  title: string;
  sections?: string;
  raw: string;
}

interface SubItem {
  number: number;
  text: string;
  level: number;
}

interface Paragraph {
  number: number;
  text: string;
  heading?: string;
  subItems?: SubItem[];
}

export default async function CasePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const judgment = await getJudgment(id);

  if (!judgment) {
    notFound();
  }

  const paragraphs = (judgment.paragraphs as Paragraph[]) ?? [];
  const casesCited = (judgment.casesCited as CitedCase[] | null) ?? [];
  const legislationCited =
    (judgment.legislationCited as CitedLegislation[] | null) ?? [];

  const sections: { heading?: string; paragraphs: Paragraph[] }[] = [];

  for (const p of paragraphs) {
    const last = sections[sections.length - 1];

    if (last && last.heading === p.heading) {
      last.paragraphs.push(p);
    } else {
      sections.push({ heading: p.heading, paragraphs: [p] });
    }
  }

  return (
    <main className="mx-auto max-w-4xl px-6 py-12">
      <Link
        href="/cases"
        className="mb-8 inline-block text-sm text-slate-500 hover:text-slate-900"
      >
        ← All cases
      </Link>

      <header className="mb-10 border-b border-slate-200 pb-8">
        <p className="font-mono text-sm text-slate-500">{judgment.citation}</p>

        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-900">
          {judgment.caseName}
        </h1>

        <dl className="mt-6 grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
          <div>
            <dt className="text-slate-500">Court</dt>
            <dd className="text-slate-900">{judgment.court}</dd>
          </div>

          {judgment.jurisdiction && (
            <div>
              <dt className="text-slate-500">Jurisdiction</dt>
              <dd className="text-slate-900">{judgment.jurisdiction}</dd>
            </div>
          )}

          {judgment.judges && judgment.judges.length > 0 && (
            <div>
              <dt className="text-slate-500">Before</dt>
              <dd className="text-slate-900">{judgment.judges.join(', ')}</dd>
            </div>
          )}

          {judgment.decisionDate && (
            <div>
              <dt className="text-slate-500">Decision date</dt>
              <dd className="text-slate-900">{judgment.decisionDate}</dd>
            </div>
          )}

          {judgment.category && (
            <div>
              <dt className="text-slate-500">Category</dt>
              <dd className="text-slate-900">{judgment.category}</dd>
            </div>
          )}
        </dl>
      </header>

      {judgment.catchwords && (
        <section className="mb-10">
          <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-slate-500">
            Catchwords
          </h2>

          <p className="whitespace-pre-line text-sm leading-relaxed text-slate-700">
            {judgment.catchwords}
          </p>
        </section>
      )}

      {(casesCited.length > 0 || legislationCited.length > 0) && (
        <section className="mb-10 grid gap-8 md:grid-cols-2">
          {casesCited.length > 0 && (
            <div>
              <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-slate-500">
                Cases cited
              </h2>

              <ul className="space-y-2 text-sm">
                {casesCited.map((c, i) => (
                  <li key={i}>
                    <span className="italic text-slate-900">{c.name}</span>{' '}
                    <span className="font-mono text-xs text-slate-600">
                      {c.citation}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {legislationCited.length > 0 && (
            <div>
              <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-slate-500">
                Legislation cited
              </h2>

              <ul className="space-y-2 text-sm">
                {legislationCited.map((l, i) => (
                  <li key={i} className="text-slate-900">
                    {l.title}
                    {l.sections && (
                      <span className="text-slate-600"> § {l.sections}</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      <section>
        <h2 className="mb-6 text-sm font-medium uppercase tracking-wide text-slate-500">
          Judgment
        </h2>

        <div className="space-y-8">
          {sections.map((section, i) => (
            <div key={i}>
              {section.heading && (
                <h3 className="mb-3 text-base font-semibold text-slate-900">
                  {section.heading}
                </h3>
              )}

              <ol className="space-y-6">
                {section.paragraphs.map((p) => (
                  <li
                    key={p.number}
                    id={`para-${p.number}`}
                    className="text-sm leading-relaxed text-slate-800"
                  >
                    <div className="flex gap-4">
                      <span className="shrink-0 font-mono text-xs text-slate-400">
                        [{p.number}]
                      </span>

                      <p>{p.text}</p>
                    </div>

                    {p.subItems && p.subItems.length > 0 && (
                      <ol className="mt-3 ml-12 space-y-2 border-l-2 border-slate-200 pl-4">
                        {p.subItems.map((s) => (
                          <li
                            key={s.number}
                            className="flex gap-3 text-slate-700"
                          >
                            <span className="shrink-0 font-mono text-xs text-slate-400">
                              ({s.number})
                            </span>

                            <p>{s.text}</p>
                          </li>
                        ))}
                      </ol>
                    )}
                  </li>
                ))}
              </ol>
            </div>
          ))}
        </div>
      </section>

      <footer className="mt-16 border-t border-slate-200 pt-6 text-xs text-slate-500">
        <p>
          Unofficial copy. Source:{' '}
          <a
            href={judgment.sourceUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="underline hover:text-slate-900"
          >
            NSW Caselaw
          </a>
          . Refer to the official version for authoritative text.
        </p>
      </footer>
    </main>
  );
}