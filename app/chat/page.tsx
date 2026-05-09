// app/chat/page.tsx
'use client';

import { useState, useRef, useEffect, type FormEvent, type KeyboardEvent } from 'react';
import Link from 'next/link';

// =============================================================================
// Types
// =============================================================================

interface Citation {
  index: number;
  judgmentId: string;
  caseName: string | null;
  citation: string | null;
  paragraphNumber: string;
  paragraphText: string;
  similarity: number;
}

interface ChatMessage {
  /** Stable client-side id for React keys; not sent to server. */
  id: string;
  role: 'user' | 'assistant';
  content: string;
  /** Citations are attached to assistant messages once retrieval completes. */
  citations?: Citation[];
  /** True while this assistant message is still streaming. */
  streaming?: boolean;
  /** If something failed mid-stream. */
  error?: string;
}

// =============================================================================
// Component
// =============================================================================

export default function ChatPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Auto-scroll to bottom whenever messages change.
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages]);

  // Auto-resize the textarea as the user types.
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 200) + 'px';
  }, [input]);

  // Cancel any in-flight request when component unmounts.
  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
    };
  }, []);

  async function handleSubmit(e?: FormEvent) {
    e?.preventDefault();

    const trimmed = input.trim();
    if (!trimmed || isStreaming) return;

    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: trimmed,
    };
    const assistantMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'assistant',
      content: '',
      streaming: true,
    };

    // Snapshot the conversation including the new user message — this is what
    // we send to the API. We want to capture this BEFORE setting state because
    // setState is async and we'd otherwise risk a race.
    const conversationForAPI = [...messages, userMessage].map((m) => ({
      role: m.role,
      content: m.content,
    }));

    setMessages((prev) => [...prev, userMessage, assistantMessage]);
    setInput('');
    setIsStreaming(true);

    // Set up abortable fetch.
    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: conversationForAPI }),
        signal: controller.signal,
      });

      if (!response.ok) {
        let errorText = `HTTP ${response.status}`;
        try {
          const errBody = await response.json();
          if (errBody?.error) errorText = errBody.error;
        } catch {
          // ignore
        }
        throw new Error(errorText);
      }

      if (!response.body) {
        throw new Error('No response body received.');
      }

      // Parse SSE stream manually. EventSource doesn't support POST so we
      // can't use the browser's built-in parser; this is the standard pattern.
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // SSE messages are separated by \n\n. Process complete messages and
        // keep the trailing partial in the buffer.
        const parts = buffer.split('\n\n');
        buffer = parts.pop() ?? '';

        for (const part of parts) {
          const line = part.trim();
          if (!line.startsWith('data:')) continue;
          const json = line.slice(5).trim();
          if (!json) continue;

          let event: { type: string; [k: string]: unknown };
          try {
            event = JSON.parse(json);
          } catch {
            continue;
          }

          if (event.type === 'citations') {
            const hits = event.hits as Citation[];
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantMessage.id ? { ...m, citations: hits } : m,
              ),
            );
          } else if (event.type === 'delta') {
            const delta = event.text as string;
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantMessage.id
                  ? { ...m, content: m.content + delta }
                  : m,
              ),
            );
          } else if (event.type === 'error') {
            const message = event.message as string;
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantMessage.id
                  ? { ...m, error: message, streaming: false }
                  : m,
              ),
            );
          } else if (event.type === 'done') {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantMessage.id ? { ...m, streaming: false } : m,
              ),
            );
          }
        }
      }
    } catch (err) {
      const wasAborted = err instanceof DOMException && err.name === 'AbortError';
      const message = wasAborted
        ? 'Cancelled.'
        : err instanceof Error
          ? err.message
          : 'Unknown error.';
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantMessage.id
            ? { ...m, error: message, streaming: false }
            : m,
        ),
      );
    } finally {
      setIsStreaming(false);
      abortControllerRef.current = null;
    }
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    // Enter to send, Shift+Enter for newline (standard chat UX).
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  }

  function handleNewConversation() {
    abortControllerRef.current?.abort();
    setMessages([]);
    setInput('');
  }

  const showWelcome = messages.length === 0;

  return (
    <div className="flex h-screen flex-col bg-slate-50">
      {/* Header */}
      <header className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-3">
        <Link href="/" className="font-semibold tracking-tight text-slate-900">
          BriefBridge
        </Link>
        <div className="flex items-center gap-4 text-sm">
          <Link href="/cases" className="text-slate-600 hover:text-slate-900">
            Cases
          </Link>
          {messages.length > 0 && (
            <button
              onClick={handleNewConversation}
              className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-50"
            >
              New conversation
            </button>
          )}
        </div>
      </header>

      {/* Messages area */}
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl px-6 py-10">
          {showWelcome ? (
            <Welcome onExampleClick={(text) => setInput(text)} />
          ) : (
            <ul className="space-y-8">
              {messages.map((m) => (
                <li key={m.id}>
                  {m.role === 'user' ? (
                    <UserMessage content={m.content} />
                  ) : (
                    <AssistantMessage message={m} />
                  )}
                </li>
              ))}
            </ul>
          )}

          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Input bar */}
      <div className="border-t border-slate-200 bg-white">
        <form
          onSubmit={handleSubmit}
          className="mx-auto max-w-3xl px-6 py-4"
        >
          <div className="flex items-end gap-3 rounded-xl border border-slate-200 bg-white p-2 shadow-sm focus-within:border-slate-400">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask a question about Australian case law..."
              rows={1}
              disabled={isStreaming}
              className="flex-1 resize-none border-0 bg-transparent px-2 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none disabled:opacity-60"
              aria-label="Your question"
            />
            <button
              type="submit"
              disabled={!input.trim() || isStreaming}
              className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              {isStreaming ? '…' : 'Send'}
            </button>
          </div>
          <p className="mt-2 text-center text-xs text-slate-400">
            BriefBridge can make mistakes. Verify citations against the official source. Not legal advice.
          </p>
        </form>
      </div>
    </div>
  );
}

// =============================================================================
// Sub-components
// =============================================================================

function Welcome({ onExampleClick }: { onExampleClick: (text: string) => void }) {
  const examples = [
    'What test do NSW courts apply when assessing security for costs from an ATE policy?',
    'When can a third party enforce an insurance contract they are not a party to?',
    'What are the principles for assessing damages for breach of fiduciary duty?',
    'How do NSW courts approach setting aside a default judgment?',
  ];

  return (
    <div className="py-16 text-center">
      <h1 className="font-serif text-3xl font-semibold tracking-tight text-slate-900">
        How can I help with your research?
      </h1>
      <p className="mt-3 text-sm text-slate-600">
        Ask any question about Australian case law. Currently covering NSW Supreme Court 2015–2026.
      </p>

      <div className="mx-auto mt-12 grid max-w-2xl gap-3 sm:grid-cols-2">
        {examples.map((ex) => (
          <button
            key={ex}
            onClick={() => onExampleClick(ex)}
            className="rounded-lg border border-slate-200 bg-white p-4 text-left text-sm text-slate-700 transition hover:border-slate-400 hover:bg-slate-50"
          >
            {ex}
          </button>
        ))}
      </div>
    </div>
  );
}

function UserMessage({ content }: { content: string }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[85%] rounded-2xl bg-slate-900 px-4 py-3 text-sm text-white">
        <p className="whitespace-pre-wrap">{content}</p>
      </div>
    </div>
  );
}

function AssistantMessage({ message }: { message: ChatMessage }) {
  const showThinking =
    message.streaming && message.content.length === 0 && !message.error;

  return (
    <div className="space-y-4">
      {showThinking && <ThinkingIndicator />}

      {message.error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          <p className="font-medium">Something went wrong</p>
          <p className="mt-1">{message.error}</p>
        </div>
      )}

      {message.content.length > 0 && (
        <div className="prose prose-sm prose-slate max-w-none">
          <FormattedAnswer content={message.content} streaming={message.streaming ?? false} />
        </div>
      )}

      {message.citations && message.citations.length > 0 && !message.error && (
        <CitationsPanel citations={message.citations} />
      )}
    </div>
  );
}

function ThinkingIndicator() {
  return (
    <div className="flex items-center gap-2 text-sm text-slate-500">
      <div className="flex gap-1">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-slate-400 [animation-delay:-0.3s]" />
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-slate-400 [animation-delay:-0.15s]" />
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-slate-400" />
      </div>
      <span>Researching across cases…</span>
    </div>
  );
}

/**
 * Renders the assistant's text content with light formatting:
 *   - Markdown-ish bold (**text**) becomes <strong>
 *   - Citation references like [1] or [1][3] become subtle highlighted spans
 *   - Newlines preserve paragraph breaks
 *
 * We intentionally don't pull in a full markdown renderer. Light touches
 * keep the rendering predictable and fast for streamed output.
 */
function FormattedAnswer({ content, streaming }: { content: string; streaming: boolean }) {
  // Split on double-newlines for paragraphs.
  const paragraphs = content.split(/\n\n+/);

  return (
    <>
      {paragraphs.map((para, i) => (
        <p key={i} className="text-sm leading-relaxed text-slate-800">
          {renderInline(para)}
        </p>
      ))}
      {streaming && (
        <span
          className="ml-0.5 inline-block h-3 w-1.5 animate-pulse bg-slate-400"
          aria-hidden
        />
      )}
    </>
  );
}

/**
 * Inline formatting: handle **bold** and [N] citation refs.
 * Returns an array of strings/JSX elements to be rendered as React children.
 */
function renderInline(text: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  // Combined regex: matches **bold** OR [N] OR [N][M]... citation chains.
  const regex = /\*\*([^*]+)\*\*|((?:\[\d+\])+)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let key = 0;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      out.push(text.slice(lastIndex, match.index));
    }

    if (match[1] !== undefined) {
      // **bold**
      out.push(<strong key={`b-${key++}`}>{match[1]}</strong>);
    } else if (match[2] !== undefined) {
      // citation chain like [1][3]
      out.push(
        <span
          key={`c-${key++}`}
          className="mx-0.5 rounded bg-slate-100 px-1 py-0.5 font-mono text-[0.7em] text-slate-700"
        >
          {match[2]}
        </span>,
      );
    }
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    out.push(text.slice(lastIndex));
  }

  return out;
}

function CitationsPanel({ citations }: { citations: Citation[] }) {
  return (
    <details className="group rounded-lg border border-slate-200 bg-white">
      <summary className="cursor-pointer list-none px-4 py-3 text-xs font-medium uppercase tracking-wide text-slate-500 hover:text-slate-900">
        <span className="inline-flex items-center gap-2">
          <span className="transition-transform group-open:rotate-90" aria-hidden>
            ›
          </span>
          {citations.length} source{citations.length === 1 ? '' : 's'} found
        </span>
      </summary>
      <ul className="divide-y divide-slate-100 border-t border-slate-100">
        {citations.map((c) => (
          <li key={c.index} className="px-4 py-3">
            <Link
              href={`/cases/${c.judgmentId}#para-${c.paragraphNumber}`}
              className="block hover:bg-slate-50 -mx-4 -my-3 px-4 py-3 transition"
            >
              <div className="flex items-baseline justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <span className="mr-2 inline-block rounded bg-slate-100 px-1.5 font-mono text-xs text-slate-700">
                    [{c.index}]
                  </span>
                  <span className="text-sm font-medium text-slate-900">
                    {c.caseName ?? 'Untitled'}
                  </span>
                  <span className="ml-2 font-mono text-xs text-slate-500">
                    {c.citation}
                  </span>
                  <span className="ml-1 font-mono text-xs text-slate-400">
                    at [{c.paragraphNumber}]
                  </span>
                </div>
                <span className="shrink-0 font-mono text-xs text-slate-400">
                  {(c.similarity * 100).toFixed(0)}%
                </span>
              </div>
              <p className="mt-1.5 line-clamp-2 text-xs text-slate-600">
                {c.paragraphText}
              </p>
            </Link>
          </li>
        ))}
      </ul>
    </details>
  );
}
