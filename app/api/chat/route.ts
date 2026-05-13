// app/api/chat/route.ts
//
// Streaming chat endpoint backing /chat and /matters/[id]/chat.
//
// CHUNK 7 RECONCILIATION + FIX (May 2026):
//
// Two important corrections from the previous version:
//
//   1. Anthropic Files API requires the beta header
//      `files-api-2025-04-14` on the Messages call, not just on the
//      Files.upload call. Without it, `document.source.type: 'file'`
//      is rejected. We pass `betas: ['files-api-2025-04-14']` into
//      messages.stream().
//
//   2. tool_result content blocks accept TEXT only, not document blocks.
//      So we split the tool's return into:
//        - toolResultText: goes inside the tool_result content
//        - documentBlocks: appended as a SEPARATE user message right
//          after the tool_result
//
// Otherwise this is the same reconciled route from before:
//   - Auth, validation, conversation resolution, getMatter (unchanged)
//   - User message persisted BEFORE streaming
//   - Semantic search on every user message
//   - Caselaw citations with kind: 'caselaw'
//   - When matter has AI access on: tool-use loop with read_files
//   - File citations indexed AFTER caselaw indices
//   - SSE protocol: conversation, citations, delta, done, error,
//     plus new tool_use_start, tool_use_complete, partial_read_warning,
//     file_citations

import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@/lib/supabase/server';
import { semanticSearch, type SemanticSearchHit } from '@/lib/search/semantic';
import {
  createConversation,
  getConversation,
  appendMessage,
} from '@/lib/db/queries/conversations';
import { getMatter } from '@/lib/db/queries/matters';
import { listFilesForAi, type FileForAi } from '@/lib/db/queries/ai-access';
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
import type { StoredCitation, FileCitation } from '@/lib/db/schema';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const MODEL = 'claude-sonnet-4-6';
const MAX_TOKENS_PER_RESPONSE = 2048;
const MAX_TURN_ITERATIONS = 4;

// Files API beta header. REQUIRED on the Messages call when using
// `document` content blocks with `source.type: 'file'`.
const FILES_API_BETA = 'files-api-2025-04-14';

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
// System prompt — UNCHANGED from previous reconciled version
// =============================================================================

function buildSystemPrompt(
  hits: SemanticSearchHit[],
  aiFilesContext: {
    filesList: FileForAi[];
    truncated: boolean;
    totalAccessibleFiles: number;
  } | null,
): string {
  const sourcesBlock =
    hits.length === 0
      ? 'No relevant cases were found in the database for this query.'
      : hits
          .map((hit, i) => {
            const caseLabel = [hit.judgment.caseName, hit.judgment.citation]
              .filter(Boolean)
              .join(' ');
            return `[${i + 1}] ${caseLabel} at [${hit.paragraphNumber}]\n${hit.paragraphText}`;
          })
          .join('\n\n---\n\n');

  const base = `You are BriefBridge, a legal research assistant for Australian lawyers.

You help lawyers research legal questions by analyzing the most relevant case law passages and providing grounded, accurate answers with verifiable citations.

# Your knowledge sources

You have been provided with ${hits.length} relevant paragraphs from NSW Supreme Court judgments (and other Australian courts as the database expands), retrieved via semantic search against the user's question:

${sourcesBlock}

# How to respond

1. **Cite using the format [N] where N is the source number above.** Every legal proposition you assert must be backed by a citation from these sources. Multiple citations for one point are fine: [1][3].

2. **Quote sparingly and accurately.** Use direct quotes only when the exact wording matters (e.g. statutory text, key tests). Otherwise paraphrase.

3. **Be candid about gaps.** If the retrieved sources don't actually support a proposition the user is asking about, say so directly: "The retrieved cases don't address this directly, but [related point]." Don't invent citations to fill gaps. Don't cite cases for propositions they don't actually support.

4. **Structure for lawyers.** Use brief headings, numbered points, and clean prose. Match the register of a junior solicitor briefing a senior — accurate, concise, no fluff.

5. **Surface the most relevant cases up top.** If two of the retrieved cases are leading authorities and others are tangential, focus on the leading ones first.

6. **End with practical considerations** when appropriate — what the lawyer should think about, what additional research might be needed, what the user's specific facts (if mentioned) might change.

7. **You are not giving legal advice.** End substantive responses with a brief reminder that the lawyer should verify citations against the official version and that this is research assistance, not legal advice.

# Limitations to acknowledge

- Your case database currently covers NSW Supreme Court judgments from 2015 onward. Earlier cases or other jurisdictions may not be retrievable.
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

In addition to the NSW caselaw above, the lawyer has uploaded files to this case. Use the read_files tool to read them when relevant to the question. Rules:

1. PLAN UP FRONT. Decide which files you need before calling read_files. Make ONE call with all files you anticipate needing in this turn.

2. PROVIDE A REASON. Every read_files call must include a clear, specific reason explaining what you're trying to find.

3. AFTER YOU CALL read_files, the file contents will appear in the conversation as a separate message. Read them carefully before responding.

4. QUOTE VERBATIM with page anchors when citing file content. Use this exact format:

   > "exact text from the file"
   > — filename.pdf, p.3

   Verbatim quote, page anchor on the source line. No paraphrasing inside the quote block.

5. DON'T INVENT CONTENT. If a file doesn't address the question, say so.

6. PER-TURN LIMIT. Up to roughly ${MAX_READ_TOKENS_PER_TURN.toLocaleString()} tokens of file content per call. Larger requests will be truncated with warnings.

7. CITATION NUMBERING for files is separate from caselaw [N] numbering. When you cite files using the quote-block format above, that's enough — don't try to put them in the [N] scheme.

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
  // Semantic search
  // ---------------------------------------------------------------------------
  let hits: SemanticSearchHit[];
  try {
    hits = await semanticSearch(latestUserMessage, { limit: 15 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Search failed.';
    return jsonError(`Semantic search error: ${message}`, 500);
  }

  const caselawCitations: StoredCitation[] = hits.map((hit, i) => ({
    kind: 'caselaw',
    index: i + 1,
    judgmentId: hit.judgment.id,
    caseName: hit.judgment.caseName,
    citation: hit.judgment.citation,
    paragraphNumber: hit.paragraphNumber,
    paragraphText: hit.paragraphText,
    similarity: hit.similarity,
  }));

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

        // EVENT 2: caselaw citations.
        send({ type: 'citations', hits: caselawCitations });

        const systemPrompt = buildSystemPrompt(hits, aiFilesContext);

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

          // Build stream args. When AI access is on, pass tools AND the
          // Files API beta header. Without the beta header, document
          // blocks with source.type='file' are rejected.
          const claudeStreamArgs: Anthropic.MessageStreamParams = {
            model: MODEL,
            max_tokens: MAX_TOKENS_PER_RESPONSE,
            system: systemPrompt,
            messages: anthropicMessages as unknown as Anthropic.MessageParam[],
          };
          if (aiAccessOn) {
            claudeStreamArgs.tools = CHAT_TOOLS;
          }

          // The SDK takes `betas` as a top-level option on stream() —
          // it's passed through as the anthropic-beta header.
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

          // Per the protocol fix: we build TWO things from each tool call:
          //   - tool_result blocks (text only)
          //   - document blocks (separate user message after)
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
                body: JSON.stringify({
                  matterId: resolvedMatterId,
                  filenames: input.filenames,
                }),
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

            // The tool_result content is just the summary text.
            toolResultBlocks.push({
              type: 'tool_result',
              tool_use_id: block.id,
              content: [
                { type: 'text', text: toolData.toolResultText },
              ],
            });

            // Accumulate document blocks for the follow-up user message.
            allDocumentBlocks.push(...toolData.documentBlocks);
          }

          // Step A: push the tool_result(s) as a user message.
          anthropicMessages.push({
            role: 'user',
            content: toolResultBlocks,
          });

          // Step B: if we have document blocks, push them as a second
          // user message right after. This is the key protocol shape.
          if (allDocumentBlocks.length > 0) {
            anthropicMessages.push({
              role: 'user',
              content: allDocumentBlocks,
            });
          }

          // Loop to next iteration — Claude will read the documents
          // in this follow-up message and continue its answer.
        }

        if (iteration >= MAX_TURN_ITERATIONS) {
          send({
            type: 'partial_read_warning',
            warning:
              'Reached the maximum number of tool-use iterations for this turn.',
          });
        }

        // Extract file citations.
        let fileCitations: FileCitation[] = [];
        if (filesUsedAcrossTurn.length > 0) {
          const extracted = extractFileCitations(fullAssistantContent);
          if (extracted.length > 0) {
            fileCitations = hydrateFileCitations(
              extracted,
              filesUsedAcrossTurn,
              caselawCitations.length + 1,
            );
            send({ type: 'file_citations', citations: fileCitations });
          }
        }

        // Persist assistant message.
        if (fullAssistantContent.length > 0) {
          const allCitations: StoredCitation[] = [
            ...caselawCitations,
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
