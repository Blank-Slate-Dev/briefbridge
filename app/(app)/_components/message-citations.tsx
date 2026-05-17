// app/(app)/_components/message-citations.tsx
//
// Renders citations inside assistant messages. NEW in Chunk 7,
// extended in Chunk 8 to handle legislation citations.
//
// Three exports:
//
//   1. <MessageCitations citations /> — renders a list of StoredCitation
//      objects, dispatching on `kind`:
//        - 'file'        (Chunk 7): gold-bordered quote block with filename + page
//        - 'legislation' (Chunk 8): legislation citation card with breadcrumb
//                        + citation + body snippet
//        - 'caselaw' / missing kind (Chunk 3+): caselaw pill with citation + paragraph
//
//   2. <ToolStatusIndicator activity /> — inline "Reading X, Y — because Z"
//      pill for an in-flight or completed read_files call.
//
//   3. <MessageWarningDot warnings /> — the amber dot that appears when
//      a message had partial reads. Hover shows the warnings list.
//
// Each component is purely presentational. State lives in streaming-chat.

'use client';

import { useState } from 'react';
import type {
  StoredCitation,
  CaselawCitation,
  FileCitation,
  LegislationCitation,
} from '@/lib/db/schema';
import type { MessageToolActivity } from './streaming-chat-sse-events';

// =============================================================================
// MessageCitations
// =============================================================================

interface MessageCitationsProps {
  citations: StoredCitation[];
}

export function MessageCitations({ citations }: MessageCitationsProps) {
  if (citations.length === 0) return null;

  return (
    <ul className="bb-message-citations">
      {citations.map((c, idx) => {
        // Discriminate on 'kind'. Older 'caselaw' rows may have undefined
        // kind, so we treat anything that isn't explicitly 'file' or
        // 'legislation' as caselaw for back-compat.
        if (c.kind === 'file') {
          return <FileCitationItem key={`f-${c.fileId}-${idx}`} citation={c} />;
        }
        if (c.kind === 'legislation') {
          return (
            <LegislationCitationItem
              key={`l-${c.sectionId}-${idx}`}
              citation={c}
            />
          );
        }
        // 'caselaw' or undefined kind — treat as caselaw.
        // TypeScript narrowing: c is now CaselawCitation by elimination
        // since the only remaining union members are CaselawCitation
        // (kind?: 'caselaw' | undefined).
        return <CaselawCitationItem key={`c-${idx}`} citation={c} />;
      })}
    </ul>
  );
}

// =============================================================================
// FileCitationItem — Chunk 7 inline quote block style
// =============================================================================

function FileCitationItem({ citation }: { citation: FileCitation }) {
  // TODO (integration): if the user has a "open file at page" route, link
  // to it here. For now we render as static. The file_id is captured so
  // future-us can wire the link in.
  return (
    <li className="bb-file-citation">
      <blockquote className="bb-file-citation__quote">
        \u201C{citation.quote}\u201D
      </blockquote>
      <div className="bb-file-citation__source">
        \u2014{' '}
        <span className="bb-file-citation__filename">{citation.filename}</span>
        , p.{citation.page}
      </div>
    </li>
  );
}

// =============================================================================
// CaselawCitationItem — placeholder pending reconciliation
// =============================================================================
//
// The existing caselaw citation rendering lives elsewhere in your
// codebase (probably in the existing streaming-chat or a dedicated
// citation component). This placeholder is intentionally minimal so
// it renders SOMETHING when called, without conflicting with whatever
// you have. See README §6 for reconciliation notes.

function CaselawCitationItem({ citation }: { citation: CaselawCitation }) {
  return (
    <li className="bb-caselaw-citation">
      <div className="bb-caselaw-citation__meta">
        [{citation.index}]{' '}
        {citation.caseName ?? citation.citation ?? 'Unknown case'}
        {' '}at [{citation.paragraphNumber}]
      </div>
    </li>
  );
}

// =============================================================================
// LegislationCitationItem — Chunk 8 retrieval addition
// =============================================================================
//
// Renders a single legislation citation. Same visual register as caselaw
// for now (a structured meta line) but kept as a separate component so
// it can evolve independently — for example, when we add deep-linking
// to legislation.gov.au we'll wire that into this component without
// affecting caselaw rendering.
//
// Display priority:
//   1. The AGLC4 citation is the most important line — that's what
//      survives copy-paste into a brief.
//   2. The breadcrumb is supplementary context (which Part / Division
//      the section sits under).
//   3. A short snippet of the section text. We deliberately don't
//      render the full body — sections can be huge. The lawyer can
//      expand or follow the citation to read the rest.

function LegislationCitationItem({
  citation,
}: {
  citation: LegislationCitation;
}) {
  // Short preview — first ~200 chars of the body, with ellipsis if longer.
  const SNIPPET_CHARS = 200;
  const snippet =
    citation.text.length > SNIPPET_CHARS
      ? citation.text.slice(0, SNIPPET_CHARS).trimEnd() + '\u2026'
      : citation.text;

  return (
    <li className="bb-legislation-citation">
      <div className="bb-legislation-citation__citation">
        [{citation.index}] {citation.citation}
      </div>
      {citation.heading && (
        <div className="bb-legislation-citation__heading">
          {citation.heading}
        </div>
      )}
      <div className="bb-legislation-citation__breadcrumb">
        {citation.breadcrumb}
      </div>
      {snippet.length > 0 && (
        <blockquote className="bb-legislation-citation__snippet">
          {snippet}
        </blockquote>
      )}
    </li>
  );
}

// =============================================================================
// ToolStatusIndicator
// =============================================================================

interface ToolStatusIndicatorProps {
  activity: MessageToolActivity;
}

export function ToolStatusIndicator({ activity }: ToolStatusIndicatorProps) {
  if (activity.toolCalls.length === 0) return null;

  return (
    <div className="bb-tool-status">
      {activity.toolCalls.map((tc) => (
        <div key={tc.toolUseId} className="bb-tool-status__item">
          <span className="bb-tool-status__icon" aria-hidden>
            {tc.status === 'running' ? '\u25CB' : '\u2713'}
          </span>
          <span className="bb-tool-status__text">
            {tc.status === 'running' ? 'Reading' : 'Read'}
            {': '}
            <span className="bb-tool-status__files">
              {tc.filenames.join(', ')}
            </span>
            {tc.reason && (
              <>
                {' '}
                <span className="bb-tool-status__reason">
                  \u2014 {tc.reason}
                </span>
              </>
            )}
          </span>
        </div>
      ))}
    </div>
  );
}

// =============================================================================
// MessageWarningDot
// =============================================================================

interface MessageWarningDotProps {
  warnings: string[];
}

export function MessageWarningDot({ warnings }: MessageWarningDotProps) {
  const [isOpen, setIsOpen] = useState(false);
  if (warnings.length === 0) return null;

  return (
    <div className="bb-message-warning">
      <button
        type="button"
        className="bb-message-warning__dot"
        aria-label={`${warnings.length} read warning${warnings.length === 1 ? '' : 's'} on this message`}
        onClick={() => setIsOpen((v) => !v)}
      >
        <span className="bb-message-warning__dot-glyph" aria-hidden />
      </button>
      {isOpen && (
        <div className="bb-message-warning__popover" role="tooltip">
          <div className="bb-message-warning__title">
            {warnings.length === 1
              ? '1 file couldn\u2019t be read'
              : `${warnings.length} files couldn\u2019t be read`}
          </div>
          <ul className="bb-message-warning__list">
            {warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
