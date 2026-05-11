// app/cases/[id]/page.tsx
//
// Single judgment view. Refactored from Tailwind to the bb-* design system
// so it matches /matters and homepage visually. No behavioural changes.
//
// IMPORTANT: every paragraph in the judgment body is rendered with
//   <li id="para-{N}" class="bb-case-para">
// because the chat citation chips (in /chat) link to /cases/{id}#para-{N}.
// The `.bb-case-para` rule sets scroll-margin-top so anchored navigation
// lands the paragraph below any sticky chrome. Don't change the id format
// or you'll break verification deep-links.
//
// The `:target` style highlights the cited paragraph with a soft gold
// background — gives the lawyer immediate visual confirmation that they
// landed on the right paragraph.

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

  // Flat list of section headings for sidebar nav.
  const navSections = sections
    .filter((s) => s.heading && s.paragraphs.length > 0)
    .map((s) => ({
      heading: s.heading!,
      firstParaNumber: s.paragraphs[0].number,
    }));

  return (
    <main className="bb-case-main">
      <Link href="/cases" className="bb-case-back">
        ← All cases
      </Link>

      <div className="bb-case-layout">
        {/* Main column */}
        <article className="bb-case-content">
          <header className="bb-case-head">
            <p className="bb-case-cite">{judgment.citation}</p>
            <h1 className="bb-case-name">{judgment.caseName}</h1>
            {judgment.decisionSummary && (
              <p className="bb-case-summary">{judgment.decisionSummary}</p>
            )}
          </header>

          {judgment.catchwords && (
            <section className="bb-case-section">
              <h2 className="bb-case-section-heading">Catchwords</h2>
              <p className="bb-case-catchwords">{judgment.catchwords}</p>
            </section>
          )}

          {(casesCited.length > 0 || legislationCited.length > 0) && (
            <section className="bb-case-section">
              <div className="bb-case-cited-grid">
                {casesCited.length > 0 && (
                  <div>
                    <h2 className="bb-case-section-heading">Cases cited</h2>
                    <ul className="bb-case-cited-list">
                      {casesCited.map((c, i) => (
                        <li key={i}>
                          <span className="bb-case-cited-name">{c.name}</span>
                          <span className="bb-case-cited-cite">{c.citation}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {legislationCited.length > 0 && (
                  <div>
                    <h2 className="bb-case-section-heading">Legislation cited</h2>
                    <ul className="bb-case-cited-list">
                      {legislationCited.map((l, i) => (
                        <li key={i} className="bb-case-cited-leg">
                          {l.title}
                          {l.sections && (
                            <span className="bb-case-cited-leg-sections">
                              {' '}§ {l.sections}
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </section>
          )}

          <section className="bb-case-section">
            <h2 className="bb-case-section-heading">Judgment</h2>

            <div className="bb-case-judgment">
              {sections.map((section, i) => (
                <div key={i}>
                  {section.heading && (
                    <h3 className="bb-case-judgment-section-heading">
                      {section.heading}
                    </h3>
                  )}

                  <ol className="bb-case-paras">
                    {section.paragraphs.map((p) => (
                      <li
                        key={p.number}
                        id={`para-${p.number}`}
                        className="bb-case-para"
                      >
                        <div className="bb-case-para-row">
                          <a
                            href={`#para-${p.number}`}
                            className="bb-case-para-num"
                            aria-label={`Link to paragraph ${p.number}`}
                          >
                            [{p.number}]
                          </a>
                          <p className="bb-case-para-body">{p.text}</p>
                        </div>

                        {p.subItems && p.subItems.length > 0 && (
                          <ol className="bb-case-subitems">
                            {p.subItems.map((s) => (
                              <li key={s.number} className="bb-case-subitem">
                                <span className="bb-case-subitem-num">
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

          <footer className="bb-case-footer">
            Unofficial copy. Source:{' '}
            <a
              href={judgment.sourceUrl}
              target="_blank"
              rel="noreferrer noopener"
            >
              NSW Caselaw
            </a>
            . Refer to the official version for authoritative text.
          </footer>
        </article>

        {/* Sidebar */}
        <aside className="bb-case-sidebar">
          <div className="bb-case-sidebar-card">
            <a
              href={judgment.sourceUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="bb-case-source-btn"
            >
              View on NSW Caselaw ↗
            </a>

            <dl className="bb-case-fields" style={{ marginTop: 20 }}>
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
          </div>

          {parties && Object.keys(parties).length > 0 && (
            <div className="bb-case-sidebar-card">
              <h3 className="bb-case-sidebar-heading">Parties</h3>
              <PartiesBlock parties={parties} />
            </div>
          )}

          {representation && Object.keys(representation).length > 0 && (
            <div className="bb-case-sidebar-card">
              <h3 className="bb-case-sidebar-heading">Representation</h3>
              <RepresentationBlock representation={representation} />
            </div>
          )}

          {navSections.length > 0 && (
            <div className="bb-case-sidebar-card">
              <h3 className="bb-case-sidebar-heading">Sections</h3>
              <nav className="bb-case-nav">
                <ul className="bb-case-nav-list">
                  {navSections.map((s, i) => (
                    <li key={i}>
                      <a href={`#para-${s.firstParaNumber}`} title={s.heading}>
                        {s.heading}
                      </a>
                    </li>
                  ))}
                </ul>
              </nav>
            </div>
          )}
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
    <div className="bb-case-field">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function PartiesBlock({ parties }: { parties: PartyBlock }) {
  const entries = Object.entries(parties).filter(
    ([, v]) => v && (Array.isArray(v) ? v.length > 0 : v.trim() !== ''),
  );
  if (entries.length === 0) return null;

  return (
    <dl className="bb-case-mini-dl">
      {entries.map(([role, value]) => (
        <div key={role}>
          <dt>{role}</dt>
          <dd>{Array.isArray(value) ? value.join('; ') : value}</dd>
        </div>
      ))}
    </dl>
  );
}

function RepresentationBlock({
  representation,
}: {
  representation: Representation;
}) {
  const entries = Object.entries(representation).filter(
    ([, v]) =>
      v &&
      (Array.isArray(v)
        ? v.length > 0
        : typeof v === 'string'
          ? v.trim() !== ''
          : false),
  );
  if (entries.length === 0) return null;

  return (
    <dl className="bb-case-mini-dl">
      {entries.map(([role, value]) => (
        <div key={role}>
          <dt>{role}</dt>
          <dd>{Array.isArray(value) ? value.join('; ') : value}</dd>
        </div>
      ))}
    </dl>
  );
}
