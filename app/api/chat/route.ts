// app/api/chat/route.ts
//
// Streaming chat endpoint backing /chat and /matters/[id]/chat.
//
// What changed in Chunk 3:
//   - Authenticates the user via the Supabase server client. Anonymous
//     callers get 401.
//   - Accepts an OPTIONAL `conversationId` in the request body. If absent,
//     a new conversation is created and its id returned to the client via
//     a new SSE event type 'conversation'.
//   - Also accepts an OPTIONAL `matterId` for in-matter conversations.
//     Only used when creating a new conversation (ignored if conversationId
//     is already provided).
//   - Persists the user message BEFORE streaming, and the assistant
//     message AFTER streaming completes (with the citation hits stored
//     in messages.citations).
//
// Request shape:
//   POST /api/chat
//   {
//     messages: [{ role, content }, ...],
//     conversationId?: string,   // optional — provide to continue an existing conversation
//     matterId?: string          // optional — only used when creating a new conversation
//   }
//
// SSE event types emitted (in order):
//   data: { "type": "conversation", "conversationId": "..." }  ← FIRST, always
//   data: { "type": "citations", "hits": [...] }
//   data: { "type": "delta", "text": "..." }                   ← repeated
//   data: { "type": "done" }
//   data: { "type": "error", "message": "..." }                ← on error

import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@/lib/supabase/server';
import { semanticSearch, type SemanticSearchHit } from '@/lib/search/semantic';
import {
  createConversation,
  getConversation,
  appendMessage,
} from '@/lib/db/queries/conversations';
import { getMatter } from '@/lib/db/queries/matters';
import type { StoredCitation } from '@/lib/db/schema';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// =============================================================================
// Request validation
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

  // Optional conversationId — UUID-ish format check (Postgres will reject
  // anything that's not a valid UUID at INSERT time, but we shortcut the
  // round trip).
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
// System prompt construction (unchanged from Chunk 2)
// =============================================================================

function buildSystemPrompt(hits: SemanticSearchHit[]): string {
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

  return `You are BriefBridge, a legal research assistant for Australian lawyers.

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
}

// =============================================================================
// Route handler
// =============================================================================

export async function POST(request: Request) {
  // Auth check. Anonymous users can't use chat — this endpoint is a
  // protected feature.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return jsonError('Not authenticated.', 401);
  }

  // Parse and validate body.
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

  // Verify env config.
  if (!process.env.ANTHROPIC_API_KEY) {
    return jsonError('Server misconfigured: ANTHROPIC_API_KEY missing.', 500);
  }
  if (!process.env.VOYAGE_API_KEY) {
    return jsonError('Server misconfigured: VOYAGE_API_KEY missing.', 500);
  }

  // --------------------------------------------------------------------------
  // Conversation resolution — find existing or create new
  // --------------------------------------------------------------------------
  //
  // Three cases:
  //   1. conversationId provided → verify it's owned by this user
  //   2. no conversationId, matterId provided → verify matter ownership,
  //      create a new conversation under that matter
  //   3. neither → create a new standalone conversation
  //
  // We do this BEFORE we start streaming because we need to emit the
  // conversationId as the very first SSE event.

  let conversationId: string;

  if (providedConversationId) {
    const existing = await getConversation(user.id, providedConversationId);
    if (!existing) {
      return jsonError('Conversation not found.', 404);
    }
    conversationId = existing.id;
  } else {
    // Verify matter ownership if matterId was provided.
    let resolvedMatterId: string | null = null;
    if (matterId) {
      const matter = await getMatter(user.id, matterId);
      if (!matter) {
        return jsonError('Matter not found.', 404);
      }
      resolvedMatterId = matter.id;
    }

    // Create a new conversation. Use the first ~60 chars of the user
    // message as a working title — better than NULL, replaceable later.
    const firstUserMessage = messages[messages.length - 1].content;
    const title = firstUserMessage.slice(0, 60).trim();

    const newConv = await createConversation(user.id, {
      matterId: resolvedMatterId,
      title: title || null,
    });
    conversationId = newConv.id;
  }

  // --------------------------------------------------------------------------
  // Persist the user message BEFORE streaming
  // --------------------------------------------------------------------------
  //
  // We persist the user message synchronously, before streaming starts,
  // so if Claude errors out we still have a record of what the user asked.
  //
  // For an EXISTING conversation, we only persist the LAST message in the
  // request payload — the earlier messages are already in the DB (the
  // client sends them as conversation history for Claude's context, not
  // for us to re-persist). For a NEW conversation, same logic still
  // applies because the messages array has length 1 in that case.

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

  // --------------------------------------------------------------------------
  // Semantic search (unchanged)
  // --------------------------------------------------------------------------

  let hits: SemanticSearchHit[];
  try {
    hits = await semanticSearch(latestUserMessage, { limit: 15 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Search failed.';
    return jsonError(`Semantic search error: ${message}`, 500);
  }

  // Build the StoredCitation shape that matches both what we'll persist
  // AND what we'll emit over SSE. Keeping a single shape avoids drift.
  const storedCitations: StoredCitation[] = hits.map((hit, i) => ({
    index: i + 1,
    judgmentId: hit.judgment.id,
    caseName: hit.judgment.caseName,
    citation: hit.judgment.citation,
    paragraphNumber: hit.paragraphNumber,
    paragraphText: hit.paragraphText,
    similarity: hit.similarity,
  }));

  // --------------------------------------------------------------------------
  // Stream Claude's response + persist assistant message at the end
  // --------------------------------------------------------------------------

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: object) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };

      // Buffer Claude's full response so we can persist it at the end.
      let fullAssistantContent = '';

      try {
        // 1. Conversation event first — let the client capture the id
        //    immediately. This is what makes "new conversation gets a URL"
        //    work — the client receives the id before any text starts
        //    streaming and can update its URL state.
        send({ type: 'conversation', conversationId });

        // 2. Citations.
        send({ type: 'citations', hits: storedCitations });

        // 3. Build prompt + stream Claude.
        const systemPrompt = buildSystemPrompt(hits);

        const claudeStream = await anthropic.messages.stream({
          model: 'claude-sonnet-4-6',
          max_tokens: 2048,
          system: systemPrompt,
          messages: messages.map((m) => ({
            role: m.role,
            content: m.content,
          })),
        });

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

        // 4. Persist the assistant message with citations.
        // We do this AFTER streaming completes — if persistence fails,
        // the user has already seen the streamed answer, so we don't
        // surface an error. We just log it.
        if (fullAssistantContent.length > 0) {
          try {
            await appendMessage(user.id, {
              conversationId,
              role: 'assistant',
              content: fullAssistantContent,
              citations: storedCitations,
            });
          } catch (persistErr) {
            // Non-fatal — the user has the answer in their browser even
            // if it didn't save. Log for monitoring.
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
