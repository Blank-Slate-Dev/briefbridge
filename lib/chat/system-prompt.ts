// lib/chat/system-prompt.ts
//
// Builds the system prompt for /api/chat. Composes four pieces:
//
//   1. Base role + tone instructions (BriefBridge's "voice")
//   2. The NSW caselaw research rules (Chunk 3+)
//   3. The legislation research rules (Chunk 8 — NEW)
//   4. The read_files instructions + available_files block (Chunk 7)
//
// Why one file: the system prompt is the contract between us and Claude.
// Splitting it across multiple modules makes it hard to reason about
// what Claude is actually seeing. One file, one read.
//
// Why this exists separately from /api/chat/route.ts: testability. We
// want to be able to assert "given this set of files, the prompt looks
// like X" without booting the full chat pipeline.
//
// NOTE on the parallel implementation in the chat route:
// /api/chat/route.ts has its own inline buildSystemPrompt. Both should
// stay in sync. Any new section added here should be added there too.

import type { FileForAi } from '@/lib/db/queries/ai-access';
import { MAX_READ_TOKENS_PER_TURN } from '@/lib/files/ai-access-types';
import type { SemanticSearchHit } from '@/lib/search/semantic';
import type { LegislationSearchHit } from '@/lib/search/semantic-legislation';

// =============================================================================
// Static sections
// =============================================================================

const BASE_INSTRUCTIONS = `You are BriefBridge, a legal research assistant for Australian lawyers. You help with NSW Supreme Court case research, Commonwealth statute research, and analysis of the lawyer's own case files.

Tone: precise, neutral, professional. Australian English spelling.

Citation conventions:
- NSW caselaw: "Smith v Jones [2024] NSWSC 100 at [42]" with paragraph numbers in square brackets.
- Statutes: full title with year and jurisdiction, e.g. "Privacy Act 1988 (Cth) s 16A" or "Civil Procedure Act 2005 (NSW)".
- Never invent citations. If unsure, say so.

You can decline. You can ask clarifying questions. You are not a lawyer giving legal advice — you are a research and analysis tool that the lawyer uses to inform their own work.`;

const CASELAW_INSTRUCTIONS = `When NSW caselaw search results are provided as context, treat them as the primary source for case-law answers. Refer to results by their citation and paragraph number, using the [N] index of each retrieved passage. Distinguish clearly between text quoted from a case and your own paraphrasing.`;

const LEGISLATION_INSTRUCTIONS = `When legislation search results are provided as context, treat them as the authoritative text of the law. Refer to results by their AGLC4 citation (e.g. "Privacy Act 1988 (Cth) s 16A") and the [N] index of each retrieved section. Quote the actual statutory wording where the precise text matters; paraphrase otherwise. If a section's text appears truncated in the retrieved snippet, note that the full section may contain additional content not shown.

When both caselaw and legislation are relevant to a question, surface the statute first (it's the source of law) followed by how the courts have interpreted it.`;

// =============================================================================
// Tool instructions (Chunk 7) — unchanged
// =============================================================================

const READ_FILES_INSTRUCTIONS = `You have access to a read_files tool for reading user-uploaded case files. Rules:

1. PLAN UP FRONT. Before reading, decide which files you need. Make ONE read_files call with all the files you anticipate needing in this turn. Avoid mid-answer follow-up calls.

2. PROVIDE A REASON. Every read_files call MUST include a clear, specific reason explaining what you're trying to find or compare. The lawyer reviews this.

3. QUOTE VERBATIM with page anchors. When citing file content, use this exact format:

   > "exact text from the file"
   > — filename.pdf, p.3

   The text inside the quote MUST be verbatim from the file. No paraphrasing inside the quote block. If you need to summarize, do that in your own prose OUTSIDE the quote block.

4. DON'T INVENT CONTENT. If a file doesn't address the question, say so. Never make up details "for context."

5. ACKNOWLEDGE LIMITS. If a file failed to load, was excluded from your access, or only partially loaded due to size limits, mention it in your answer.

6. PER-TURN LIMIT. You can read up to roughly ${MAX_READ_TOKENS_PER_TURN.toLocaleString()} tokens of file content per tool call (~300 pages). Larger requests will be truncated and you'll get warnings — narrow your request and try again, or accept the partial result.

7. SINGLE-FILE LOOKUPS. Even when reading just one file, call read_files with an array of one filename. The schema requires an array.`;

// =============================================================================
// Caselaw hits → prompt section
// =============================================================================

function formatCaselawHits(hits: SemanticSearchHit[], startIndex: number): string {
  if (hits.length === 0) {
    return 'No relevant cases were found in the database for this query.';
  }
  return hits
    .map((hit, i) => {
      const label = [hit.judgment.caseName, hit.judgment.citation]
        .filter(Boolean)
        .join(' ');
      return `[${startIndex + i}] ${label} at [${hit.paragraphNumber}]\n${hit.paragraphText}`;
    })
    .join('\n\n---\n\n');
}

// =============================================================================
// Legislation hits → prompt section
// =============================================================================

function formatLegislationHits(
  hits: LegislationSearchHit[],
  startIndex: number,
): string {
  if (hits.length === 0) {
    return 'No relevant legislation sections were found in the database for this query.';
  }
  return hits
    .map((hit, i) => {
      // Format: [11] Privacy Act 1988 (Cth) s 16A — When an APP entity must take steps
      //         (Part III > Division 1 > s 16A)
      //         (section body)
      const idx = startIndex + i;
      const headingLine = hit.heading
        ? `${hit.citation} — ${hit.heading}`
        : hit.citation;
      return `[${idx}] ${headingLine}\n(${hit.breadcrumb})\n${hit.text}`;
    })
    .join('\n\n---\n\n');
}

// =============================================================================
// Available files block
// =============================================================================

function formatAvailableFiles(filesList: FileForAi[]): string {
  if (filesList.length === 0) return '';

  const lines = filesList.map((f) => {
    const sizeLabel = formatBytes(f.fileSize);
    const pagesLabel =
      f.pageCount && f.pageCount > 0 ? `, ${f.pageCount} pages` : '';
    const mimeLabel = formatMime(f.mimeType);
    const tagLabel =
      f.tags.length > 0 ? ` \u2014 tagged: ${f.tags.join(', ')}` : '';
    return `- ${f.filename} \u2014 ${sizeLabel}${pagesLabel} ${mimeLabel}${tagLabel}`;
  });

  return `Available files in this case (call read_files with one or more filenames):\n${lines.join('\n')}`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1_000) return `${bytes} B`;
  if (bytes < 1_000_000) return `${Math.round(bytes / 1_000)} KB`;
  if (bytes < 10_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
  return `${Math.round(bytes / 1_000_000)} MB`;
}

function formatMime(mime: string): string {
  if (mime === 'application/pdf') return 'PDF';
  if (
    mime ===
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  )
    return 'Word doc';
  if (mime === 'text/plain') return 'text';
  return 'file';
}

// =============================================================================
// Public composer
// =============================================================================

export interface BuildSystemPromptArgs {
  /** Matter metadata for grounding. */
  matter: {
    name: string;
    client: string | null;
    description: string | null;
  };
  /** Files Claude can see this turn. May be empty (when AI access is off). */
  filesList: FileForAi[];
  /** Whether the chat route is also injecting NSW caselaw search results. */
  hasCaselaw: boolean;
  /** Caselaw hits to format into the prompt. Numbered starting at index 1. */
  caselawHits?: SemanticSearchHit[];
  /** Legislation hits to format into the prompt. Numbered AFTER caselaw. */
  legislationHits?: LegislationSearchHit[];
  /** If files are limited by the system prompt cap, the total count. */
  truncated: boolean;
  totalAccessibleFiles: number;
  /** If AI access is currently off, the reason — included so Claude can mention it if relevant. */
  aiAccessOffReason: string | null;
}

export function buildSystemPrompt(args: BuildSystemPromptArgs): string {
  const sections: string[] = [BASE_INSTRUCTIONS];

  // Matter context. Short — Claude just needs to know it's in a matter.
  const clientPart = args.matter.client ? ` for client ${args.matter.client}` : '';
  const descPart = args.matter.description
    ? `\nMatter description: ${args.matter.description}`
    : '';
  sections.push(
    `You are currently working within the case: "${args.matter.name}"${clientPart}.${descPart}`,
  );

  // Caselaw rules + hits if any.
  const caselawHits = args.caselawHits ?? [];
  if (args.hasCaselaw || caselawHits.length > 0) {
    sections.push(CASELAW_INSTRUCTIONS);
    if (caselawHits.length > 0) {
      sections.push(
        `# Retrieved caselaw\n\n${formatCaselawHits(caselawHits, 1)}`,
      );
    }
  }

  // Legislation rules + hits if any. Indexed AFTER caselaw.
  const legislationHits = args.legislationHits ?? [];
  if (legislationHits.length > 0) {
    sections.push(LEGISLATION_INSTRUCTIONS);
    sections.push(
      `# Retrieved legislation\n\n${formatLegislationHits(legislationHits, caselawHits.length + 1)}`,
    );
  }

  // File access section.
  if (args.aiAccessOffReason) {
    sections.push(
      `FILE ACCESS: ${args.aiAccessOffReason}\nYou cannot read files in this case right now. If the lawyer asks about file contents, explain that file access is off and where they can enable it.`,
    );
  } else if (args.filesList.length === 0) {
    sections.push(
      `FILE ACCESS: AI access is on for this case, but no files are currently available (the case may be empty or all files may be excluded).`,
    );
  } else {
    sections.push(READ_FILES_INSTRUCTIONS);
    sections.push(formatAvailableFiles(args.filesList));
    if (args.truncated) {
      const hidden = args.totalAccessibleFiles - args.filesList.length;
      sections.push(
        `(Plus ${hidden} more file${hidden === 1 ? '' : 's'} not shown above \u2014 you can still call read_files for them by name if the lawyer mentions them.)`,
      );
    }
  }

  return sections.join('\n\n');
}
