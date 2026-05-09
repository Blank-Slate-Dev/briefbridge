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

interface PartyBlock {
  // The shape varies; we render whatever's there as JSON-friendly text.
  // Common shapes seen:
  //   { plaintiffs: ["..."], defendants: ["..."] }
  //   { applicants: ["..."], respondents: ["..."] }
  [role: string]: string[] | string | undefined;
}

interface Representation {
  counsel?: string[] | string;
  solicitors?: string[] | string;
  [key: string]: string[] | string | undefined;
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
  const parties = judgment.parties as PartyBlock | null;
  const representation = judgment.representation as Representation | null;

  // Group paragraphs into sections by their heading.
  const sections: { heading?: string; paragraphs: Paragraph[] }[] = [];
  for (const p of paragraphs) {
    const last = sections[sections.length - 1];
    if (last && last.heading === p.heading) {
      last.paragraphs.push(p);
    } else {
      sections.push({ heading: p.heading, paragraphs: [p] });
    }
  }

  // Build a flat list of section headings for the sidebar nav.
  const navSections = sections
    .filter((s) => s.heading && s.paragraphs.length > 0)
    .map((s) => ({
      heading: s.heading!,
      // Anchor to the first paragraph in this section.
      firstParaNumber: s.paragraphs[0].number,
    }));

  return (
    <main className="mx-auto max-w-7xl px-6 py-8">
      <Link
        href="/cases"
        className="mb-6 inline-block text-sm text-slate-500 hover:text-slate-900"
      >
        ← All cases
      </Link>

      <div className="grid gap-12 lg:grid-cols-[1fr_280px]">
        {/* Main content column */}
        <article className="min-w-0">
          <header className="mb-10 border-b border-slate-200 pb-8">
            <p className="font-mono text-sm text-slate-500">{judgment.citation}</p>

            <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-900">
              {judgment.caseName}
            </h1>

            {judgment.decisionSummary && (
              <p className="mt-4 text-base text-slate-700">
                {judgment.decisionSummary}
              </p>
            )}
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
                    <h3
                      id={`section-${i}`}
                      className="mb-3 text-base font-semibold text-slate-900"
                    >
                      {section.heading}
                    </h3>
                  )}

                  <ol className="space-y-6">
                    {section.paragraphs.map((p) => (
                      <li
                        key={p.number}
                        id={`para-${p.number}`}
                        className="text-sm leading-relaxed text-slate-800 scroll-mt-20"
                      >
                        <div className="flex gap-4">
                          <a
                            href={`#para-${p.number}`}
                            className="shrink-0 font-mono text-xs text-slate-400 hover:text-slate-700"
                            aria-label={`Link to paragraph ${p.number}`}
                          >
                            [{p.number}]
                          </a>
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
        </article>

        {/* Sidebar — sticky on desktop, inline on mobile (after main content) */}
        <aside className="lg:sticky lg:top-8 lg:self-start lg:max-h-[calc(100vh-4rem)] lg:overflow-y-auto">
          <div className="space-y-6 rounded-lg border border-slate-200 bg-white p-5">
            <a
              href={judgment.sourceUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="block w-full rounded-md bg-slate-900 px-3 py-2 text-center text-sm font-medium text-white transition hover:bg-slate-700"
            >
              View on NSW Caselaw ↗
            </a>

            <dl className="space-y-3 text-sm">
              <Field label="Court" value={judgment.court} />
              <Field label="Jurisdiction" value={judgment.jurisdiction} />
              {judgment.judges && judgment.judges.length > 0 && (
                <Field label="Before" value={judgment.judges.join(', ')} />
              )}
              <Field label="Decision date" value={judgment.decisionDate} />
              {judgment.hearingDates && (
                <Field label="Hearing dates" value={judgment.hearingDates} />
              )}
              <Field label="Category" value={judgment.category} />
              {judgment.fileNumbers && judgment.fileNumbers.length > 0 && (
                <Field
                  label="File number"
                  value={judgment.fileNumbers.join(', ')}
                />
              )}
              {judgment.publicationRestriction &&
                judgment.publicationRestriction !== 'Nil' && (
                  <Field
                    label="Publication restriction"
                    value={judgment.publicationRestriction}
                  />
                )}
            </dl>

            {parties && Object.keys(parties).length > 0 && (
              <PartiesBlock parties={parties} />
            )}

            {representation && Object.keys(representation).length > 0 && (
              <RepresentationBlock representation={representation} />
            )}

            {navSections.length > 0 && (
              <nav>
                <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">
                  Sections
                </h3>
                <ul className="space-y-1.5 text-sm">
                  {navSections.map((s, i) => (
                    <li key={i}>
                      <a
                        href={`#para-${s.firstParaNumber}`}
                        className="block truncate text-slate-700 hover:text-slate-900"
                        title={s.heading}
                      >
                        {s.heading}
                      </a>
                    </li>
                  ))}
                </ul>
              </nav>
            )}
          </div>
        </aside>
      </div>
    </main>
  );
}

// =============================================================================
// Sidebar building blocks
// =============================================================================

function Field({
  label,
  value,
}: {
  label: string;
  value: string | null | undefined;
}) {
  if (!value) return null;
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="mt-0.5 text-slate-900">{value}</dd>
    </div>
  );
}

function PartiesBlock({ parties }: { parties: PartyBlock }) {
  const entries = Object.entries(parties).filter(([, v]) => v && (
    Array.isArray(v) ? v.length > 0 : v.trim() !== ''
  ));
  if (entries.length === 0) return null;

  return (
    <div>
      <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">
        Parties
      </h3>
      <dl className="space-y-2 text-xs">
        {entries.map(([role, value]) => (
          <div key={role}>
            <dt className="capitalize text-slate-500">{role}</dt>
            <dd className="text-slate-900">
              {Array.isArray(value) ? value.join('; ') : value}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function RepresentationBlock({ representation }: { representation: Representation }) {
  const entries = Object.entries(representation).filter(([, v]) => v && (
    Array.isArray(v) ? v.length > 0 : (typeof v === 'string' ? v.trim() !== '' : false)
  ));
  if (entries.length === 0) return null;

  return (
    <div>
      <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">
        Representation
      </h3>
      <dl className="space-y-2 text-xs">
        {entries.map(([role, value]) => (
          <div key={role}>
            <dt className="capitalize text-slate-500">{role}</dt>
            <dd className="text-slate-900">
              {Array.isArray(value) ? value.join('; ') : value}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
