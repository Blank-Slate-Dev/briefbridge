// app/api/chat/route.ts
//
// Streaming chat endpoint backing /chat and /matters/[id]/chat.
//
// CHUNK 8 ADDITION (Path A — always retrieve):
//
// Every user message now triggers TWO semantic searches in parallel:
//   1. semanticSearch (caselaw) — existing, returns 10 hits (was 15)
//   2. semanticSearchLegislation (statutes) — new, returns 7 hits
//
// Both result sets get rendered into the system prompt with shared
// [N] numbering: caselaw [1]..[10], legislation [11]..[17]. Claude is
// instructed (via system-prompt.ts) on how to use each.
//
// Citations sent to the client in one merged SSE event. The renderer
// (message-citations.tsx) discriminates on `kind` and renders each
// variant distinctly. File citations continue to be parsed out of
// the streamed text after Claude responds and indexed after these.
//
// CHUNK 7 RECONCILIATION + FIX (May 2026) — unchanged:
//   - Files API beta header on the Messages call
//   - tool_result content blocks accept TEXT only; documents go as a
//     separate user message after the tool_result
//
// Otherwise this is the same reconciled route:
//   - Auth, validation, conversation resolution, getMatter (unchanged)
//   - User message persisted BEFORE streaming
//   - Caselaw citations with kind: 'caselaw'
//   - Legislation citations with kind: 'legislation' (NEW)
//   - When matter has AI access on: tool-use loop with read_files
//   - File citations indexed AFTER caselaw + legislation indices
//   - SSE protocol: conversation, citations, delta, done, error,
//     plus tool_use_start, tool_use_complete, partial_read_warning,
//     file_citations

import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@/lib/supabase/server';
import { semanticSearch, type SemanticSearchHit } from '@/lib/search/semantic';
import {
  semanticSearchLegislation,
  type LegislationSearchHit,
} from '@/lib/search/semantic-legislation';
import {
  createConversation,
  getConversation,
  appendMessage,
} from '@/lib/db/queries/conversations';
import { getMatter } from '@/lib/db/queries/matters';
import {
  listFilesForAi,
  listFilesForConversation,
  type FileForAi,
} from '@/lib/db/queries/ai-access';
import { MAX_READ_TOKENS_PER_TURN } from '@/lib/files/ai-access-types';
import { CHAT_TOOLS, isReadFilesToolInput } from '@/lib/chat/tool-definitions';
import {
  extractFileCitations,
  hydrateFileCitations,
} from '@/lib/chat/citations';
import type {
  FilesToolResponse,
  DocumentBlock,
} from '@/app/api/files-tool/route';
import type {
  StoredCitation,
  CaselawCitation,
  FileCitation,
  LegislationCitation,
} from '@/lib/db/schema';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const MODEL = 'claude-sonnet-4-6';
const MAX_TOKENS_PER_RESPONSE = 2048;
const MAX_TURN_ITERATIONS = 4;

// Files API beta header. REQUIRED on the Messages call when using
// `document` content blocks with `source.type: 'file'`.
const FILES_API_BETA = 'files-api-2025-04-14';

// Retrieval limits — see CHUNK 8 design notes above.
const CASELAW_HIT_LIMIT = 10;
const LEGISLATION_HIT_LIMIT = 7;

// =============================================================================
// Request validation — UNCHANGED
// =============================================================================

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface ChatRequest {
  messages: ChatMessage[];
  conversationId?: string;
  matterId?: string;
}

function validateRequest(body: unknown): ChatRequest | { error: string } {
  if (!body || typeof body !== 'object') {
    return { error: 'Body must be an object.' };
  }
  const b = body as Record<string, unknown>;

  if (!Array.isArray(b.messages)) {
    return { error: 'messages must be an array.' };
  }
  if (b.messages.length === 0) {
    return { error: 'messages must not be empty.' };
  }
  if (b.messages.length > 50) {
    return { error: 'Conversation too long (max 50 messages).' };
  }

  const cleaned: ChatMessage[] = [];
  for (const m of b.messages) {
    if (!m || typeof m !== 'object') {
      return { error: 'Each message must be an object.' };
    }
    const mm = m as Record<string, unknown>;
    if (mm.role !== 'user' && mm.role !== 'assistant') {
      return { error: `Invalid role: ${String(mm.role)}` };
    }
    if (typeof mm.content !== 'string') {
      return { error: 'Each message must have string content.' };
    }
    if (mm.content.length > 8000) {
      return { error: 'Message too long (max 8000 characters).' };
    }
    cleaned.push({ role: mm.role, content: mm.content });
  }

  if (cleaned[cleaned.length - 1].role !== 'user') {
    return { error: 'Last message must be from user.' };
  }

  let conversationId: string | undefined;
  if (typeof b.conversationId === 'string') {
    const trimmed = b.conversationId.trim();
    if (trimmed.length > 0) {
      if (!UUID_RE.test(trimmed)) {
        return { error: 'Invalid conversationId.' };
      }
      conversationId = trimmed;
    }
  }

  let matterId: string | undefined;
  if (typeof b.matterId === 'string') {
    const trimmed = b.matterId.trim();
    if (trimmed.length > 0) {
      if (!UUID_RE.test(trimmed)) {
        return { error: 'Invalid matterId.' };
      }
      matterId = trimmed;
    }
  }

  return { messages: cleaned, conversationId, matterId };
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// =============================================================================
// System prompt — Chunk 8 extended to render legislation hits
// =============================================================================
//
// Mirror of lib/chat/system-prompt.ts (which is kept for testability).
// Both should stay in sync. The route uses this inline version because
// it has additional context (the AI files block, retrieval results)
// that the testable version handles via its more generic interface.

function buildSystemPrompt(
  caselawHits: SemanticSearchHit[],
  legislationHits: LegislationSearchHit[],
  aiFilesContext: {
    filesList: FileForAi[];
    truncated: boolean;
    totalAccessibleFiles: number;
  } | null,
): string {
  const caselawBlock =
    caselawHits.length === 0
      ? 'No relevant cases were found in the database for this query.'
      : caselawHits
          .map((hit, i) => {
            const caseLabel = [hit.judgment.caseName, hit.judgment.citation]
              .filter(Boolean)
              .join(' ');
            return `[${i + 1}] ${caseLabel} at [${hit.paragraphNumber}]\n${hit.paragraphText}`;
          })
          .join('\n\n---\n\n');

  const legislationStartIndex = caselawHits.length + 1;
  const legislationBlock =
    legislationHits.length === 0
      ? 'No relevant legislation sections were found in the database for this query.'
      : legislationHits
          .map((hit, i) => {
            const idx = legislationStartIndex + i;
            const headingLine = hit.heading
              ? `${hit.citation} — ${hit.heading}`
              : hit.citation;
            return `[${idx}] ${headingLine}\n(${hit.breadcrumb})\n${hit.text}`;
          })
          .join('\n\n---\n\n');

  const base = `You are BriefBridge, a legal research assistant for Australian lawyers.

You help lawyers research legal questions by analyzing the most relevant case law passages and legislation sections, providing grounded, accurate answers with verifiable citations.

# Your knowledge sources

You have been provided with relevant content from two sources, retrieved via semantic search against the user's question.

## NSW caselaw — ${caselawHits.length} paragraphs

Indexed [1] through [${caselawHits.length}]:

${caselawBlock}

## Australian legislation (Commonwealth and NSW) — ${legislationHits.length} sections

Indexed [${legislationStartIndex}] through [${legislationStartIndex + legislationHits.length - 1}]:

${legislationBlock}

# How to respond

1. **Cite using the format [N] where N is the source number above.** Every legal proposition you assert must be backed by a citation from these sources. Multiple citations for one point are fine: [1][3]. Citations from BOTH caselaw and legislation use the same [N] numbering scheme.

2. **Surface statute first when both apply.** Legislation is the source of law; caselaw interprets it. If a section directly answers the question, cite it first, then show how courts have interpreted it.

3. **Quote sparingly and accurately.** Use direct quotes for statutory text (where wording is the law) and for key tests articulated by courts. Otherwise paraphrase. If a section's text appears truncated in the retrieved snippet, note that the full section may contain additional content not shown.

4. **Only cite what was retrieved, and never say something "isn't in the database."** Cite and name only the provisions, sections, and cases that appear in the retrieved sources above. Never name a section number, Act, or case from memory if it is not among those sources — even one you feel certain is relevant. The sources above are only what semantic search surfaced for this specific question; they are NOT the full contents of the database, which is far larger and covers extensive Commonwealth and NSW legislation. So if something relevant did not come up, say it "wasn't retrieved for this query" and suggest the lawyer rephrase or search for it directly — do NOT tell them it "isn't in the database" or "isn't available," and do NOT guess at its wording or section numbers. If the retrieved sources genuinely don't address the question, say so plainly: "The retrieved sources don't address this directly, but [related point]." Never invent a citation to fill a gap.

5. **Structure for lawyers.** Use brief headings, numbered points, and clean prose. Match the register of a junior solicitor briefing a senior — accurate, concise, no fluff.

6. **Surface the most relevant authorities up top.** If two cases or sections are leading authorities and others are tangential, focus on the leading ones first.

7. **Respect the court hierarchy when authorities compete.** Where multiple retrieved cases speak to the same point, lead with the highest court: High Court of Australia first, then the NSW Court of Appeal / Court of Criminal Appeal, then first-instance Supreme Court decisions. Note explicitly when a first-instance decision sits in tension with appellate or High Court authority. Do not discard a lower-court case that is more directly on point — cite it, but frame it within the binding authority above it.

8. **End with practical considerations** when appropriate — what the lawyer should think about, what additional research might be needed, what the user's specific facts (if mentioned) might change.

9. **You are not giving legal advice.** End substantive responses with a brief reminder that the lawyer should verify citations against the official version and that this is research assistance, not legal advice.

# Limitations to acknowledge

- Your caselaw database covers NSW Supreme Court judgments (2015 onward), NSW Court of Appeal and Court of Criminal Appeal judgments (mid-1990s onward), and High Court of Australia judgments (1998 onward). Other courts and earlier years may not be retrievable.
- Your legislation database holds a large and growing collection of in-force Commonwealth principal Acts together with in-force NSW public Acts. It does not yet include most Regulations or other subordinate instruments, and does not cover jurisdictions other than the Commonwealth and NSW. Coverage of these is broad, so do not assume a given Commonwealth or NSW Act is absent just because it was not retrieved for a particular question.
- Some judgments have known parsing gaps (block quotes, annexures, subheadings may be missing). Always recommend the lawyer verify against the source.
- You cannot answer based on the user's specific facts unless those facts are described in the question.

# When the user's question is unclear

Ask one clarifying question rather than guessing. Lawyers prefer precision.`;

  if (!aiFilesContext || aiFilesContext.filesList.length === 0) {
    return base;
  }

  const fileLines = aiFilesContext.filesList.map((f) => {
    const sizeLabel = formatBytes(f.fileSize);
    const pagesLabel =
      f.pageCount && f.pageCount > 0 ? `, ${f.pageCount} pages` : '';
    const mimeLabel = formatMime(f.mimeType);
    const tagLabel =
      f.tags.length > 0 ? ` — tagged: ${f.tags.join(', ')}` : '';
    return `- ${f.filename} — ${sizeLabel}${pagesLabel} ${mimeLabel}${tagLabel}`;
  });

  const truncatedFooter = aiFilesContext.truncated
    ? `\n\n(Plus ${aiFilesContext.totalAccessibleFiles - aiFilesContext.filesList.length} more file(s) not shown above — you can still call read_files for them by name if the lawyer mentions them.)`
    : '';

  const filesBlock = `

# This case has uploaded files you can read

In addition to the caselaw and legislation above, the lawyer has uploaded files to this case. Use the read_files tool to read them when relevant to the question. Rules:

1. PLAN UP FRONT. Decide which files you need before calling read_files. Make ONE call with all files you anticipate needing in this turn.

2. PROVIDE A REASON. Every read_files call must include a clear, specific reason explaining what you're trying to find.

3. AFTER YOU CALL read_files, the file contents will appear in the conversation as a separate message. Read them carefully before responding.

4. QUOTE VERBATIM with page anchors when citing file content. Use this exact format:

   > "exact text from the file"
   > — filename.pdf, p.3

   Verbatim quote, page anchor on the source line. No paraphrasing inside the quote block.

5. DON'T INVENT CONTENT. If a file doesn't address the question, say so.

6. PER-TURN LIMIT. Up to roughly ${MAX_READ_TOKENS_PER_TURN.toLocaleString()} tokens of file content per call. Larger requests will be truncated with warnings.

7. CITATION NUMBERING for files is separate from the caselaw + legislation [N] numbering above. When you cite files using the quote-block format above, that's enough — don't try to put them in the [N] scheme.

Available files in this case (call read_files with one or more filenames):
${fileLines.join('\n')}${truncatedFooter}`;

  return base + filesBlock;
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
// Route handler
// =============================================================================

export async function POST(request: Request) {
  // ---------------------------------------------------------------------------
  // Auth + validation
  // ---------------------------------------------------------------------------
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return jsonError('Not authenticated.', 401);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError('Invalid JSON body.', 400);
  }

  const validation = validateRequest(body);
  if ('error' in validation) {
    return jsonError(validation.error, 400);
  }
  const { messages, conversationId: providedConversationId, matterId } = validation;

  if (!process.env.ANTHROPIC_API_KEY) {
    return jsonError('Server misconfigured: ANTHROPIC_API_KEY missing.', 500);
  }
  if (!process.env.VOYAGE_API_KEY) {
    return jsonError('Server misconfigured: VOYAGE_API_KEY missing.', 500);
  }

  // ---------------------------------------------------------------------------
  // Conversation resolution
  // ---------------------------------------------------------------------------
  let conversationId: string;
  let resolvedMatterId: string | null = null;

  if (providedConversationId) {
    const existing = await getConversation(user.id, providedConversationId);
    if (!existing) {
      return jsonError('Conversation not found.', 404);
    }
    conversationId = existing.id;
    resolvedMatterId = existing.matterId ?? null;
  } else {
    if (matterId) {
      const matter = await getMatter(user.id, matterId);
      if (!matter) {
        return jsonError('Matter not found.', 404);
      }
      resolvedMatterId = matter.id;
    }

    const firstUserMessage = messages[messages.length - 1].content;
    const title = firstUserMessage.slice(0, 60).trim();

    const newConv = await createConversation(user.id, {
      matterId: resolvedMatterId,
      title: title || null,
    });
    conversationId = newConv.id;
  }

  // ---------------------------------------------------------------------------
  // Persist user message BEFORE streaming
  // ---------------------------------------------------------------------------
  const latestUserMessage = messages[messages.length - 1].content;
  try {
    await appendMessage(user.id, {
      conversationId,
      role: 'user',
      content: latestUserMessage,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Persist failed.';
    return jsonError(`Failed to persist message: ${msg}`, 500);
  }

  // ---------------------------------------------------------------------------
  // Semantic searches — caselaw + legislation in parallel
  // ---------------------------------------------------------------------------
  //
  // Both searches embed the same query string (once each) and run their
  // pgvector lookups in parallel. Total wall time is the slower of the
  // two (~150-400ms each) rather than the sum.
  //
  // We catch errors per-search rather than failing the whole request if
  // one search fails. A legislation outage shouldn't kill caselaw
  // retrieval. The other search proceeds with an empty result set.

  const [caselawResult, legislationResult] = await Promise.allSettled([
    semanticSearch(latestUserMessage, { limit: CASELAW_HIT_LIMIT }),
    semanticSearchLegislation(latestUserMessage, { limit: LEGISLATION_HIT_LIMIT }),
  ]);

  let caselawHits: SemanticSearchHit[] = [];
  if (caselawResult.status === 'fulfilled') {
    caselawHits = caselawResult.value;
  } else {
    // eslint-disable-next-line no-console
    console.error(
      '[chat] caselaw search failed:',
      caselawResult.reason instanceof Error
        ? caselawResult.reason.message
        : String(caselawResult.reason),
    );
  }

  let legislationHits: LegislationSearchHit[] = [];
  if (legislationResult.status === 'fulfilled') {
    legislationHits = legislationResult.value;
  } else {
    // eslint-disable-next-line no-console
    console.error(
      '[chat] legislation search failed:',
      legislationResult.reason instanceof Error
        ? legislationResult.reason.message
        : String(legislationResult.reason),
    );
  }

  // If BOTH searches failed, that's an unusual condition — surface it as
  // a server error rather than silently giving Claude no context.
  if (
    caselawResult.status === 'rejected' &&
    legislationResult.status === 'rejected'
  ) {
    return jsonError(
      'Semantic search unavailable: both caselaw and legislation indices failed.',
      500,
    );
  }

  // Build the citations array. Caselaw first (indices 1..N), then
  // legislation (N+1..N+M). File citations come later, indexed after both.
  const caselawCitations: CaselawCitation[] = caselawHits.map((hit, i) => ({
    kind: 'caselaw',
    index: i + 1,
    judgmentId: hit.judgment.id,
    caseName: hit.judgment.caseName,
    citation: hit.judgment.citation,
    paragraphNumber: hit.paragraphNumber,
    paragraphText: hit.paragraphText,
    similarity: hit.similarity,
  }));

  const legislationCitations: LegislationCitation[] = legislationHits.map(
    (hit, i) => ({
      kind: 'legislation',
      index: caselawCitations.length + i + 1,
      legislationId: hit.section.legislationId,
      sectionId: hit.section.id,
      citation: hit.citation,
      breadcrumb: hit.breadcrumb,
      heading: hit.heading,
      text: hit.text,
      similarity: hit.similarity,
    }),
  );

  const preStreamCitations: StoredCitation[] = [
    ...caselawCitations,
    ...legislationCitations,
  ];

  // ---------------------------------------------------------------------------
  // AI access check
  // ---------------------------------------------------------------------------
  let aiAccessOn = false;
  let aiFilesContext: {
    filesList: FileForAi[];
    truncated: boolean;
    totalAccessibleFiles: number;
  } | null = null;

  if (resolvedMatterId) {
    const filesAccess = await listFilesForAi(user.id, resolvedMatterId);
    if (!filesAccess.isOff && filesAccess.files.length > 0) {
      aiAccessOn = true;
      aiFilesContext = {
        filesList: filesAccess.files,
        truncated: filesAccess.truncated,
        totalAccessibleFiles: filesAccess.totalAccessible,
      };
    }
  } else if (conversationId) {
    // MIGRATION 0009: standalone-chat file attachment. No matter — load
    // files attached directly to the conversation. These are AUTO-READ
    // (attaching IS the consent), so listFilesForConversation applies no
    // access-mode gate; isOff is always false. Everything downstream (the
    // system-prompt file block, the read_files tool loop) is identical to
    // the matter path — only the source of the file list differs.
    const convFiles = await listFilesForConversation(user.id, conversationId);
    if (convFiles.files.length > 0) {
      aiAccessOn = true;
      aiFilesContext = {
        filesList: convFiles.files,
        truncated: convFiles.truncated,
        totalAccessibleFiles: convFiles.totalAccessible,
      };
    }
  }

  // ---------------------------------------------------------------------------
  // Stream
  // ---------------------------------------------------------------------------

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: object) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };

      let fullAssistantContent = '';
      const filesUsedAcrossTurn: Array<{
        fileId: string;
        filename: string;
      }> = [];

      try {
        // EVENT 1: conversation id.
        send({ type: 'conversation', conversationId });

        // EVENT 2: pre-stream citations (caselaw + legislation merged).
        // File citations come in a later event after they're parsed
        // out of the streamed text.
        send({ type: 'citations', hits: preStreamCitations });

        const systemPrompt = buildSystemPrompt(
          caselawHits,
          legislationHits,
          aiFilesContext,
        );

        type AnthropicMessage = {
          role: 'user' | 'assistant';
          content: string | Array<unknown>;
        };
        const anthropicMessages: AnthropicMessage[] = messages.map((m) => ({
          role: m.role,
          content: m.content,
        }));

        let iteration = 0;

        while (iteration < MAX_TURN_ITERATIONS) {
          iteration += 1;

          const claudeStreamArgs: Anthropic.MessageStreamParams = {
            model: MODEL,
            max_tokens: MAX_TOKENS_PER_RESPONSE,
            system: systemPrompt,
            messages: anthropicMessages as unknown as Anthropic.MessageParam[],
          };
          if (aiAccessOn) {
            claudeStreamArgs.tools = CHAT_TOOLS;
          }

          const streamOptions = aiAccessOn
            ? { headers: { 'anthropic-beta': FILES_API_BETA } }
            : undefined;

          const claudeStream = anthropic.messages.stream(
            claudeStreamArgs,
            streamOptions,
          );

          for await (const event of claudeStream) {
            if (
              event.type === 'content_block_delta' &&
              event.delta.type === 'text_delta'
            ) {
              const text = event.delta.text;
              fullAssistantContent += text;
              send({ type: 'delta', text });
            }
          }

          const finalMessage = await claudeStream.finalMessage();

          anthropicMessages.push({
            role: 'assistant',
            content: finalMessage.content,
          });

          if (finalMessage.stop_reason !== 'tool_use') {
            break;
          }

          if (!aiAccessOn) {
            send({
              type: 'error',
              message: 'Unexpected tool use from AI service.',
            });
            break;
          }

          // ---- Tool use path ----

          const toolUseBlocks = finalMessage.content.filter(
            (block) => block.type === 'tool_use',
          );
          if (toolUseBlocks.length === 0) {
            send({
              type: 'error',
              message: 'Unexpected response from AI service.',
            });
            break;
          }

          const toolResultBlocks: Array<{
            type: 'tool_result';
            tool_use_id: string;
            content: Array<{ type: 'text'; text: string }>;
          }> = [];
          const allDocumentBlocks: DocumentBlock[] = [];

          for (const block of toolUseBlocks) {
            if (block.type !== 'tool_use') continue;

            if (block.name !== 'read_files') {
              toolResultBlocks.push({
                type: 'tool_result',
                tool_use_id: block.id,
                content: [
                  { type: 'text', text: `Unknown tool: ${block.name}` },
                ],
              });
              continue;
            }

            const input = block.input;
            if (!isReadFilesToolInput(input)) {
              toolResultBlocks.push({
                type: 'tool_result',
                tool_use_id: block.id,
                content: [
                  {
                    type: 'text',
                    text: 'Invalid tool input: filenames must be a non-empty array of strings and reason must be a string.',
                  },
                ],
              });
              continue;
            }

            send({
              type: 'tool_use_start',
              toolName: 'read_files',
              toolUseId: block.id,
              input: {
                filenames: input.filenames,
                reason: input.reason,
              },
            });

            const toolReq = new Request(
              new URL(request.url).origin + '/api/files-tool',
              {
                method: 'POST',
                headers: request.headers,
                body: JSON.stringify(
                  // MIGRATION 0009: route the read to the right scope.
                  // Matter chats send matterId; standalone chats send
                  // conversationId. The files-tool route resolves against
                  // whichever is present.
                  resolvedMatterId
                    ? { matterId: resolvedMatterId, filenames: input.filenames }
                    : { conversationId, filenames: input.filenames },
                ),
              },
            );
            const { POST: filesToolHandler } = await import(
              '@/app/api/files-tool/route'
            );
            const toolResp = await filesToolHandler(toolReq);
            const toolData = (await toolResp.json()) as
              | FilesToolResponse
              | { ok: false; error: string };

            if (!toolData.ok) {
              toolResultBlocks.push({
                type: 'tool_result',
                tool_use_id: block.id,
                content: [
                  {
                    type: 'text',
                    text: `Couldn't read files: ${toolData.error}`,
                  },
                ],
              });
              continue;
            }

            for (const w of toolData.warnings) {
              send({ type: 'partial_read_warning', warning: w });
            }

            filesUsedAcrossTurn.push(
              ...toolData.filesUsed.map((f) => ({
                fileId: f.fileId,
                filename: f.filename,
              })),
            );

            send({
              type: 'tool_use_complete',
              toolUseId: block.id,
              filesUsed: toolData.filesUsed.map((f) => ({
                fileId: f.fileId,
                filename: f.filename,
              })),
            });

            toolResultBlocks.push({
              type: 'tool_result',
              tool_use_id: block.id,
              content: [
                { type: 'text', text: toolData.toolResultText },
              ],
            });

            allDocumentBlocks.push(...toolData.documentBlocks);
          }

          anthropicMessages.push({
            role: 'user',
            content: toolResultBlocks,
          });

          if (allDocumentBlocks.length > 0) {
            anthropicMessages.push({
              role: 'user',
              content: allDocumentBlocks,
            });
          }
        }

        if (iteration >= MAX_TURN_ITERATIONS) {
          send({
            type: 'partial_read_warning',
            warning:
              'Reached the maximum number of tool-use iterations for this turn.',
          });
        }

        // Extract file citations from streamed text.
        // File citations get indexed AFTER caselaw + legislation indices.
        let fileCitations: FileCitation[] = [];
        if (filesUsedAcrossTurn.length > 0) {
          const extracted = extractFileCitations(fullAssistantContent);
          if (extracted.length > 0) {
            fileCitations = hydrateFileCitations(
              extracted,
              filesUsedAcrossTurn,
              preStreamCitations.length + 1,
            );
            send({ type: 'file_citations', citations: fileCitations });
          }
        }

        // Persist assistant message with all citations of all kinds.
        if (fullAssistantContent.length > 0) {
          const allCitations: StoredCitation[] = [
            ...preStreamCitations,
            ...fileCitations,
          ];
          try {
            await appendMessage(user.id, {
              conversationId,
              role: 'assistant',
              content: fullAssistantContent,
              citations: allCitations,
            });
          } catch (persistErr) {
            // eslint-disable-next-line no-console
            console.error(
              '[chat] failed to persist assistant message:',
              persistErr instanceof Error
                ? persistErr.message
                : String(persistErr),
            );
          }
        }

        send({ type: 'done' });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        send({ type: 'error', message });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}

function jsonError(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
