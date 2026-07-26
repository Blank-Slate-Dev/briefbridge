// app/(public)/demo/_components/demo-client.tsx
//
// Client half of the public demo: question picker, then the full pre-generated
// answer, its sources, and the signup CTA.
//
// No typewriter reveal. An earlier version revealed the answer character by
// character and auto-scrolled to follow it; it fought the reader, and someone
// evaluating a research tool wants to skim the whole answer, not watch it
// arrive. Selecting a question scrolls to the answer once, and that's all.
//
// Styling is inline for the same reason as the practitioner picker: this page
// renders in the (public) shell and must not depend on which stylesheet
// happens to be in scope.

'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import type { DemoAnswer } from '@/lib/demo/demo-data';

const NAVY = '#1a1f2e';
const SOFT = '#3a4256';
const MUTED = '#8a8577';
const GOLD = '#c9a24b';
const BORDER = '#e7e0d2';


// -----------------------------------------------------------------------------
// Minimal renderer matching the product's answer styling.
//
// The saved answers use the same light markup the chat produces: ## / ### and
// bare headings, **bold**, - bullets, and [N] citation markers. This renders
// them the way the app does so the demo looks like the product rather than a
// text dump.
// -----------------------------------------------------------------------------

function renderInline(text: string, key: string) {
  // Split on **bold** and [N] citation markers, keeping the delimiters.
  const parts = text.split(/(\*\*[^*]+\*\*|\[\d+\])/g);
  return parts.map((p, i) => {
    if (/^\*\*[^*]+\*\*$/.test(p)) {
      return (
        <strong key={`${key}-${i}`} style={{ color: NAVY, fontWeight: 600 }}>
          {p.slice(2, -2)}
        </strong>
      );
    }
    if (/^\[\d+\]$/.test(p)) {
      return (
        <span
          key={`${key}-${i}`}
          style={{
            display: 'inline-block',
            minWidth: 18,
            padding: '0 5px',
            margin: '0 1px',
            borderRadius: 5,
            background: 'rgba(201,162,75,0.18)',
            color: NAVY,
            fontSize: 11.5,
            fontWeight: 600,
            textAlign: 'center',
            verticalAlign: 'baseline',
          }}
        >
          {p.slice(1, -1)}
        </span>
      );
    }
    return <span key={`${key}-${i}`}>{p}</span>;
  });
}

function AnswerBody({ text }: { text: string }) {
  const lines = text.split('\n');
  const out: React.ReactNode[] = [];
  let bullets: string[] = [];

  const flush = (k: string) => {
    if (bullets.length === 0) return;
    out.push(
      <ul key={`ul-${k}`} style={{ margin: '8px 0 14px', paddingLeft: 20 }}>
        {bullets.map((b, i) => (
          <li
            key={i}
            style={{
              fontSize: 14.5,
              lineHeight: 1.7,
              color: SOFT,
              margin: '4px 0',
            }}
          >
            {renderInline(b, `li-${k}-${i}`)}
          </li>
        ))}
      </ul>,
    );
    bullets = [];
  };

  lines.forEach((raw, i) => {
    const line = raw.trimEnd();
    const k = String(i);

    if (line.trim() === '') {
      flush(k);
      return;
    }
    if (/^[-*]\s+/.test(line.trim())) {
      bullets.push(line.trim().replace(/^[-*]\s+/, ''));
      return;
    }
    flush(k);

    // ## / ### headings, or a short line that is entirely bold, or a numbered
    // section heading like "5. Analysis".
    const hashed = line.match(/^(#{2,4})\s+(.*)$/);
    const allBold = line.match(/^\*\*(.+)\*\*:?$/);
    const numbered = line.match(/^(\d+)\.\s+([A-Z][^.]{2,60})$/);
    const bareHeading =
      line.length < 70 &&
      !line.endsWith('.') &&
      !line.includes('[') &&
      /^[A-Z0-9]/.test(line) &&
      !/[a-z]\s[a-z]+\s[a-z]+\s[a-z]+\s[a-z]+\s[a-z]+/.test(line);

    if (hashed || allBold || numbered || bareHeading) {
      const label = hashed
        ? hashed[2]
        : allBold
          ? allBold[1]
          : numbered
            ? `${numbered[1]}. ${numbered[2]}`
            : line;
      out.push(
        <h3
          key={`h-${k}`}
          style={{
            fontFamily: 'var(--font-fraunces), Georgia, serif',
            fontSize: 16.5,
            fontWeight: 500,
            color: NAVY,
            margin: out.length === 0 ? '0 0 10px' : '24px 0 8px',
            lineHeight: 1.35,
          }}
        >
          {label}
        </h3>,
      );
      return;
    }

    out.push(
      <p
        key={`p-${k}`}
        style={{
          fontSize: 14.5,
          lineHeight: 1.7,
          color: SOFT,
          margin: '0 0 12px',
        }}
      >
        {renderInline(line, `p-${k}`)}
      </p>,
    );
  });
  flush('end');
  return <>{out}</>;
}



export function DemoClient({ answers }: { answers: DemoAnswer[] }) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const answerRef = useRef<HTMLDivElement>(null);

  const active = answers.find((a) => a.id === activeId) ?? null;

  function pick(id: string) {
    setActiveId(id);
    // One scroll on selection so the answer is in view — deliberately not a
    // continuous follow. An earlier version revealed the text character by
    // character and scrolled with it; it added nothing but jank for a reader
    // who wants to skim the whole answer.
    //
    // The public shell has a STICKY HEADER, so scrollIntoView({ block: 'start' })
    // puts the top of the answer underneath it. We measure the header at run
    // time and offset by its height rather than hard-coding a magic number
    // that breaks whenever the header changes.
    requestAnimationFrame(() => {
      const el = answerRef.current;
      if (!el) return;

      const header = document.querySelector('.bb-header') as HTMLElement | null;
      const headerHeight = header?.getBoundingClientRect().height ?? 0;
      const breathingRoom = 16;

      const top =
        window.scrollY +
        el.getBoundingClientRect().top -
        headerHeight -
        breathingRoom;

      window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
    });
  }

  return (
    <div>
      {/* ---------- Question picker ---------- */}
      <div style={{ display: 'grid', gap: 10, marginBottom: 28 }}>
        {answers.map((a) => {
          const isActive = a.id === activeId;
          return (
            <button
              key={a.id}
              type="button"
              onClick={() => pick(a.id)}
              style={{
                textAlign: 'left',
                padding: '16px 18px',
                border: `1px solid ${isActive ? GOLD : BORDER}`,
                borderRadius: 14,
                background: isActive ? 'rgba(201,162,75,0.08)' : '#fff',
                font: 'inherit',
                cursor: 'pointer',
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
              }}
            >
              <span
                style={{
                  fontSize: 15.5,
                  fontWeight: 500,
                  color: NAVY,
                  lineHeight: 1.45,
                }}
              >
                {a.question}
              </span>
              <span style={{ fontSize: 12.5, color: MUTED, lineHeight: 1.5 }}>
                <span
                  style={{
                    display: 'inline-block',
                    padding: '2px 8px',
                    borderRadius: 999,
                    background: 'rgba(26,31,46,0.06)',
                    color: SOFT,
                    marginRight: 8,
                    fontSize: 11,
                    fontWeight: 500,
                  }}
                >
                  {a.mode}
                </span>
                {a.showcases}
              </span>
            </button>
          );
        })}
      </div>

      {active && (
        <div ref={answerRef}>
          {/* ---------- Answer ---------- */}
          <section
            style={{
              background: '#fff',
              border: `1px solid ${BORDER}`,
              borderTop: `4px solid ${GOLD}`,
              borderRadius: 16,
              padding: '2rem 2.25rem',
              marginBottom: 18,
            }}
          >
            <div
              style={{
                fontSize: 11,
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                color: MUTED,
                marginBottom: 18,
                paddingBottom: 14,
                borderBottom: `1px solid ${BORDER}`,
              }}
            >
              Answered in {active.mode} mode
            </div>
            <AnswerBody text={active.answer} />
          </section>

          {/* ---------- Sources ---------- */}
          {active.sources.length > 0 && (
            <section
              style={{
                background: '#fff',
                border: `1px solid ${BORDER}`,
                borderRadius: 16,
                padding: '1.5rem 1.75rem',
                marginBottom: 18,
              }}
            >
              <div
                style={{
                  fontSize: 11,
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                  color: MUTED,
                  marginBottom: 14,
                }}
              >
                {active.sources.length} sources — every citation above resolves
                to one of these
              </div>
              <ol style={{ margin: 0, padding: 0, listStyle: 'none' }}>
                {active.sources.map((sce, i) => (
                  <li
                    key={i}
                    style={{
                      display: 'flex',
                      gap: 12,
                      padding: '12px 0',
                      borderTop: i === 0 ? 'none' : `1px solid #f0ebe0`,
                    }}
                  >
                    <span
                      style={{
                        flexShrink: 0,
                        width: 24,
                        height: 24,
                        borderRadius: 6,
                        background: 'rgba(201,162,75,0.15)',
                        color: NAVY,
                        fontSize: 12,
                        fontWeight: 600,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      {i + 1}
                    </span>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span
                        style={{
                          display: 'block',
                          fontSize: 14,
                          color: NAVY,
                          fontWeight: 500,
                          lineHeight: 1.45,
                        }}
                      >
                        {sce.label}
                        {sce.pinpoint ? (
                          <span style={{ color: MUTED, fontWeight: 400 }}>
                            {' '}
                            {sce.pinpoint}
                          </span>
                        ) : null}
                      </span>
                      {sce.context && (
                        <span
                          style={{
                            display: 'block',
                            fontSize: 12,
                            color: MUTED,
                            marginTop: 2,
                          }}
                        >
                          {sce.context}
                        </span>
                      )}
                      {sce.snippet && (
                        <span
                          style={{
                            display: 'block',
                            fontSize: 12.5,
                            lineHeight: 1.55,
                            color: SOFT,
                            marginTop: 6,
                            paddingLeft: 10,
                            borderLeft: `2px solid ${BORDER}`,
                          }}
                        >
                          {sce.snippet}
                        </span>
                      )}
                    </span>
                    <span
                      style={{
                        flexShrink: 0,
                        fontSize: 12,
                        color: MUTED,
                        fontVariantNumeric: 'tabular-nums',
                      }}
                    >
                      {(sce.similarity * 100).toFixed(0)}% match
                    </span>
                  </li>
                ))}
              </ol>
            </section>
          )}

          {/* ---------- CTA ---------- */}
          <section
            style={{
              background: NAVY,
              borderRadius: 16,
              padding: '2rem 2.25rem',
              color: '#f4efe6',
            }}
          >
            <h2
              style={{
                fontFamily: 'var(--font-fraunces), Georgia, serif',
                fontSize: 22,
                fontWeight: 400,
                margin: '0 0 8px',
                color: '#f4efe6',
              }}
            >
              Ask your own question
            </h2>
            <p
              style={{
                fontSize: 14.5,
                lineHeight: 1.6,
                color: '#d8d3c4',
                margin: '0 0 20px',
                maxWidth: 520,
              }}
            >
              Search 57,000 NSW judgments, the High Court, and every in-force
              NSW and Commonwealth Act — by meaning, not keywords.
            </p>
            <Link
              href="/login"
              style={{
                display: 'inline-block',
                background: GOLD,
                color: NAVY,
                padding: '11px 24px',
                borderRadius: 999,
                fontWeight: 600,
                fontSize: 14.5,
                textDecoration: 'none',
              }}
            >
              Start researching →
            </Link>
          </section>
        </div>
      )}
    </div>
  );
}