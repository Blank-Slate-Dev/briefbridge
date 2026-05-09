// app/api/chat/route.ts
//
// Streaming chat endpoint backing /chat.
//
// Request shape:
//   POST /api/chat
//   { messages: [{ role: 'user' | 'assistant', content: string }, ...] }
//
// Response: text/event-stream (Server-Sent Events) with three event types:
//   data: { "type": "citations", "hits": [...] }   ← sent once, before text
//   data: { "type": "delta", "text": "..." }       ← streamed many times
//   data: { "type": "done" }                       ← sent once, at the end
//   data: { "type": "error", "message": "..." }    ← if anything blows up
//
// Why SSE over WebSockets:
//   - One-way (server→client) is all we need
//   - Works through any proxy, including Vercel's
//   - Native browser support via EventSource
//   - Simpler error handling

import Anthropic from '@anthropic-ai/sdk';
import { semanticSearch, type SemanticSearchHit } from '@/lib/search/semantic';

// Edge runtime would be slightly faster but pgvector queries need the
// node-postgres pool, which uses TCP and isn't supported on edge.
export const runtime = 'nodejs';

// Don't cache responses — every conversation is unique.
export const dynamic = 'force-dynamic';

// Cap maximum body size + processing time.
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

  // Conversation must end with a user message — otherwise Claude has nothing
  // new to respond to.
  if (cleaned[cleaned.length - 1].role !== 'user') {
    return { error: 'Last message must be from user.' };
  }

  return { messages: cleaned };
}

// =============================================================================
// Prompt construction
// =============================================================================

/**
 * Build the system prompt that grounds Claude in the retrieved cases.
 *
 * Design notes:
 *   - We're explicit about "ONLY cite cases I provide" because hallucinated
 *     citations are the #1 reason lawyers don't trust AI legal tools.
 *   - We give Claude a structured citation format `[CASE_INDEX]` so we can
 *     parse them later if needed for rendering. Citations are referenced by
 *     index into the hits array.
 *   - We let Claude use general legal reasoning to interpret the cases —
 *     e.g. "this principle applies because..." — but anchored to the cases.
 *   - We tell Claude to be honest about gaps. "I don't have a case on that"
 *     is a valid answer that builds trust.
 */
function buildSystemPrompt(hits: SemanticSearchHit[]): string {
  const sourcesBlock = hits.length === 0
    ? 'No relevant cases were found in the database for this query.'
    : hits
        .map((hit, i) => {
          const caseLabel = [
            hit.judgment.caseName,
            hit.judgment.citation,
          ].filter(Boolean).join(' ');
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
  const { messages } = validation;

  // Verify env config.
  if (!process.env.ANTHROPIC_API_KEY) {
    return jsonError('Server misconfigured: ANTHROPIC_API_KEY missing.', 500);
  }
  if (!process.env.VOYAGE_API_KEY) {
    return jsonError('Server misconfigured: VOYAGE_API_KEY missing.', 500);
  }

  // Run semantic search using the LATEST user message.
  // Future improvement: compose a search query from the whole conversation
  // (e.g. "given the user previously asked X, the new question Y likely means
  // Z"). For now, single-turn retrieval keeps it simple and predictable.
  const latestUserMessage = messages[messages.length - 1].content;

  let hits: SemanticSearchHit[];
  try {
    hits = await semanticSearch(latestUserMessage, { limit: 15 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Search failed.';
    return jsonError(`Semantic search error: ${message}`, 500);
  }

  // Stream Claude's response back as SSE.
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      // Helper to send an SSE event.
      const send = (data: object) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };

      try {
        // 1. Send citations first so the UI can render placeholder cards
        //    before the answer text starts streaming.
        send({
          type: 'citations',
          hits: hits.map((hit, i) => ({
            index: i + 1,
            judgmentId: hit.judgment.id,
            caseName: hit.judgment.caseName,
            citation: hit.judgment.citation,
            paragraphNumber: hit.paragraphNumber,
            paragraphText: hit.paragraphText,
            similarity: hit.similarity,
          })),
        });

        // 2. Build prompt and stream Claude response.
        const systemPrompt = buildSystemPrompt(hits);

        const claudeStream = await anthropic.messages.stream({
          // Sonnet 4.6 — best balance of quality + cost for grounded RAG.
          model: 'claude-sonnet-4-6',
          max_tokens: 2048,
          system: systemPrompt,
          messages: messages.map((m) => ({
            role: m.role,
            content: m.content,
          })),
        });

        // 3. Forward each text delta to the client.
        for await (const event of claudeStream) {
          if (
            event.type === 'content_block_delta' &&
            event.delta.type === 'text_delta'
          ) {
            send({ type: 'delta', text: event.delta.text });
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
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no', // disable proxy buffering for streaming
    },
  });
}

function jsonError(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
