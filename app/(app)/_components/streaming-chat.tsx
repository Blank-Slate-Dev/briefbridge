// app/(app)/_components/streaming-chat.tsx
//
// Shared chat surface for BOTH the standalone /chat page AND the in-matter
// Research tab. Owns all the streaming/state logic:
//   - Message list rendering
//   - SSE parsing (conversation, citations, delta, done, error events)
//   - URL update via history.replaceState when a conversation id arrives
//   - Citation panel rendering
//   - Smart auto-scroll (sticks to bottom only while the user is at the
//     bottom; a "jump to latest" button appears when they scroll up)
//   - Auto-resize textarea
//   - Cancel-on-unmount of in-flight streams
//
// CHUNK 7 CHANGE: StoredCitation became a discriminated union with two
// variants (caselaw | file).
//
// CHUNK 8 CHANGE (visibility pass): StoredCitation now has THREE variants
// (caselaw | file | legislation). The CitationsPanel below filters into
// THREE buckets and renders a dedicated LegislationCitationRow for the
// new variant. Without this change, legislation citations sent by the
// /api/chat endpoint would be silently dropped by the renderer.
//
// SCROLL PASS: the previous version called scrollIntoView on EVERY message
// change, which fires on every streaming delta — so the view yanked back
// to the bottom the instant a user tried to scroll up and read. Now we
// track whether the user is "stuck" to the bottom (an isAtBottomRef driven
// by a scroll listener) and only auto-scroll when they are. When they've
// scrolled away during a live answer, a "Jump to latest" button appears.
//
// What this file DOESN'T own:
//   - Outer page shell (full-viewport vs inline scroll — wrappers decide)
//   - Welcome screen with example prompts (only standalone wants this)
//   - Page headers / "New research" buttons (wrappers decide what to show)
//   - Empty-state copy (matter wants in-context language; standalone wants
//     generic — wrappers pass their own empty-state node)
//
// Styling: uses the bb-msg-* / bb-chat-* / bb-citations-* CSS classes
// defined in matters.css, plus the legislation-specific extensions in
// matters-legislation.css.

'use client';

import {
  useState,
  useRef,
  useEffect,
  useCallback,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import Link from 'next/link';
import type {
  StoredCitation,
  CaselawCitation,
  FileCitation,
  LegislationCitation,
} from '@/lib/db/schema';

// =============================================================================
// Types
// =============================================================================

type Citation = StoredCitation;

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  citations?: Citation[];
  streaming?: boolean;
  error?: string;
}

/** Initial-state message shape (from server-loaded history). */
export interface InitialMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  citations?: Citation[];
}

export interface StreamingChatProps {
  /** Messages to seed the state with (from server-side hydration). */
  initialMessages: InitialMessage[];
  /** Conversation id from URL or server, if any. */
  initialConversationId: string | null;
  /**
   * Matter scope for new conversations. If set, the /api/chat endpoint will
   * bind newly-created conversations to this matter.
   */
  matterId?: string;
  /**
   * Called when a brand-new conversation gets an id back from the SSE
   * stream. Used by wrappers to update their URL state. Optional —
   * default behaviour is to update window.location's `?conversationId=`
   * via history.replaceState.
   */
  onConversationCreated?: (conversationId: string) => void;
  /**
   * Rendered above the message list when there are NO messages. Lets
   * each wrapper provide its own empty-state UI (standalone shows
   * "How can I help with your research?" + example prompts; matter shows
   * "Ask a question in this case's context").
   */
  emptyState: ReactNode;
  /**
   * Placeholder text for the input textarea. Wrappers can customise:
   * "Ask a question about Australian case law…" for standalone,
   * "Ask anything about this case…" for in-matter.
   */
  inputPlaceholder?: string;
}

// =============================================================================
// Component
// =============================================================================

export function StreamingChat({
  initialMessages,
  initialConversationId,
  matterId,
  onConversationCreated,
  emptyState,
  inputPlaceholder = 'Ask a question…',
}: StreamingChatProps) {
  // Seed with server-provided initial messages. After mount all mutations
  // happen client-side.
  const [messages, setMessages] = useState<ChatMessage[]>(() =>
    initialMessages.map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      citations: m.citations,
    })),
  );

  // Current conversation id. NULL = next send creates a new conversation.
  // Once /api/chat emits 'conversation', we capture the id here.
  const [conversationId, setConversationId] = useState<string | null>(
    initialConversationId,
  );

  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);

  // Shows the floating "Jump to latest" button. True when the user has
  // scrolled away from the bottom of the scroll container.
  const [showJumpButton, setShowJumpButton] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Whether the view is currently pinned to the bottom. Updated by the
  // scroll listener below. We keep it in a ref (not state) because the
  // streaming auto-scroll effect reads it on every delta and we don't want
  // those reads to depend on a re-render. "Near" the bottom (within 80px)
  // counts as pinned, so a slightly-off-bottom position still follows.
  const isAtBottomRef = useRef(true);

  const BOTTOM_THRESHOLD_PX = 80;

  const computeAtBottom = useCallback((el: HTMLDivElement): boolean => {
    const distanceFromBottom =
      el.scrollHeight - el.scrollTop - el.clientHeight;
    return distanceFromBottom <= BOTTOM_THRESHOLD_PX;
  }, []);

  const scrollToBottom = useCallback((smooth = true) => {
    messagesEndRef.current?.scrollIntoView({
      behavior: smooth ? 'smooth' : 'auto',
      block: 'end',
    });
    isAtBottomRef.current = true;
    setShowJumpButton(false);
  }, []);

  // Sync local state when server-provided initialMessages or initialConversationId
  // change (e.g. when a wrapper swaps between conversations via URL change without
  // unmounting the component). Without this, the component would render the wrong
  // messages on conversation switch.
  useEffect(() => {
    setMessages(
      initialMessages.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        citations: m.citations,
      })),
    );
  }, [initialMessages]);

  useEffect(() => {
    setConversationId(initialConversationId);
  }, [initialConversationId]);

  // Watch the scroll container so we know whether the user is pinned to the
  // bottom. This drives BOTH the auto-scroll decision (via the ref) and the
  // jump-button visibility (via state). Passive listener; cheap.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const handleScroll = () => {
      const atBottom = computeAtBottom(el);
      isAtBottomRef.current = atBottom;
      // Only surface the jump button while a stream is in progress — there's
      // nothing "latest" to jump to when the answer is already complete.
      setShowJumpButton(!atBottom && isStreaming);
    };

    el.addEventListener('scroll', handleScroll, { passive: true });
    return () => el.removeEventListener('scroll', handleScroll);
  }, [computeAtBottom, isStreaming]);

  // Auto-scroll on message changes — but ONLY when the user is pinned to the
  // bottom. During streaming this fires on every delta; if the user has
  // scrolled up to read, isAtBottomRef is false and we leave them alone.
  useEffect(() => {
    if (isAtBottomRef.current) {
      messagesEndRef.current?.scrollIntoView({
        behavior: 'smooth',
        block: 'end',
      });
    }
  }, [messages]);

  // When a brand-new send starts, the user is (almost always) intending to
  // watch the new answer — snap to bottom and clear the jump button. This
  // also re-pins after they'd scrolled up reading a previous answer.
  // Triggered by isStreaming flipping true.
  useEffect(() => {
    if (isStreaming) {
      scrollToBottom(false);
    } else {
      // Stream finished: nothing live to chase, so hide the button.
      setShowJumpButton(false);
    }
  }, [isStreaming, scrollToBottom]);

  // Auto-resize textarea up to 200px.
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 200) + 'px';
  }, [input]);

  // Cancel any in-flight stream when the component unmounts.
  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
    };
  }, []);

  const handleSubmit = useCallback(
    async (e?: FormEvent) => {
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

      // Build the message history we send to the API. We include client-side
      // history so Claude has context. The API only persists the LAST user
      // message — earlier ones are already in the DB (for existing
      // conversations) or absent (for new ones).
      const conversationForAPI = [...messages, userMessage].map((m) => ({
        role: m.role,
        content: m.content,
      }));

      setMessages((prev) => [...prev, userMessage, assistantMessage]);
      setInput('');
      setIsStreaming(true);

      const controller = new AbortController();
      abortControllerRef.current = controller;

      try {
        const response = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            messages: conversationForAPI,
            conversationId: conversationId ?? undefined,
            // matterId is sent on EVERY send when set (defensive — the API
            // ignores it if conversationId is also set, so this can't
            // create stray new conversations).
            matterId: matterId ?? undefined,
          }),
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

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });

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

            if (event.type === 'conversation') {
              const newId = event.conversationId as string;
              if (newId && newId !== conversationId) {
                setConversationId(newId);
                // Wrappers can override URL update behaviour. Default is
                // history.replaceState — silent, no navigation. The
                // alternative (router.push) would unmount React mid-stream.
                if (onConversationCreated) {
                  onConversationCreated(newId);
                } else if (typeof window !== 'undefined') {
                  const url = new URL(window.location.href);
                  url.searchParams.set('conversationId', newId);
                  window.history.replaceState({}, '', url.toString());
                }
              }
            } else if (event.type === 'citations') {
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
        const wasAborted =
          err instanceof DOMException && err.name === 'AbortError';
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
    },
    [input, isStreaming, messages, conversationId, matterId, onConversationCreated],
  );

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  }

  // Exposed via prop so wrappers can set the input from external sources
  // (e.g. example-prompt buttons on the welcome screen).
  // For now, we just hold this internally; wrappers can wire up examples
  // by passing them inside the emptyState node.
  const showWelcome = messages.length === 0;

  return (
    <div className="bb-chat">
      <div className="bb-chat-scroll" ref={scrollRef}>
        {showWelcome ? (
          emptyState
        ) : (
          <ul className="bb-chat-messages">
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

      {showJumpButton && (
        <button
          type="button"
          className="bb-chat-jump"
          onClick={() => scrollToBottom(true)}
          aria-label="Jump to latest"
        >
          <span className="bb-chat-jump-arrow" aria-hidden>
            ↓
          </span>
          Jump to latest
        </button>
      )}

      <form className="bb-chat-input" onSubmit={handleSubmit}>
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={inputPlaceholder}
          rows={1}
          disabled={isStreaming}
          aria-label="Your question"
        />
        <button
          type="submit"
          disabled={!input.trim() || isStreaming}
          className="bb-btn bb-btn-primary"
        >
          {isStreaming ? '…' : 'Send'}
        </button>
      </form>
      <p className="bb-chat-disclaimer">
        BriefBridge can make mistakes. Verify citations against the official
        source. Not legal advice.
      </p>
    </div>
  );
}

// =============================================================================
// Sub-components — all use bb-msg-* / bb-citations-* CSS from matters.css
// =============================================================================

function UserMessage({ content }: { content: string }) {
  return (
    <div className="bb-msg bb-msg-user">
      <div className="bb-msg-bubble">
        <p style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{content}</p>
      </div>
    </div>
  );
}

function AssistantMessage({ message }: { message: ChatMessage }) {
  const showThinking =
    message.streaming && message.content.length === 0 && !message.error;

  return (
    <div className="bb-msg bb-msg-assistant">
      {showThinking && <ThinkingIndicator />}

      {message.error && (
        <div className="bb-chat-error">
          <p className="bb-chat-error-title">Something went wrong</p>
          <p className="bb-chat-error-body">{message.error}</p>
        </div>
      )}

      {message.content.length > 0 && (
        <div className="bb-msg-prose">
          <FormattedAnswer
            content={message.content}
            streaming={message.streaming ?? false}
          />
        </div>
      )}

      {message.citations &&
        message.citations.length > 0 &&
        !message.error && <CitationsPanel citations={message.citations} />}
    </div>
  );
}

function ThinkingIndicator() {
  return (
    <div className="bb-chat-thinking">
      <span className="bb-chat-thinking-dots" aria-hidden>
        <span />
        <span />
        <span />
      </span>
      <span>Researching across cases…</span>
    </div>
  );
}

function FormattedAnswer({
  content,
  streaming,
}: {
  content: string;
  streaming: boolean;
}) {
  const paragraphs = content.split(/\n\n+/);
  return (
    <>
      {paragraphs.map((para, i) => (
        <p key={i}>{renderInline(para)}</p>
      ))}
      {streaming && <span className="bb-chat-cursor" aria-hidden />}
    </>
  );
}

function renderInline(text: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  const regex = /\*\*([^*]+)\*\*|((?:\[\d+\])+)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let key = 0;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      out.push(text.slice(lastIndex, match.index));
    }

    if (match[1] !== undefined) {
      out.push(<strong key={`b-${key++}`}>{match[1]}</strong>);
    } else if (match[2] !== undefined) {
      out.push(
        <span key={`c-${key++}`} className="bb-cite-ref">
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

// =============================================================================
// CITATION PANEL — Chunk 8: handles caselaw, legislation, AND file citations
// =============================================================================
//
// StoredCitation is a three-variant discriminated union:
//   - kind: 'caselaw' (or undefined for pre-Chunk-7 rows) — judgmentId,
//     caseName, paragraphNumber, paragraphText, similarity, citation
//   - kind: 'legislation' — legislationId, sectionId, citation,
//     breadcrumb, heading, text, similarity
//   - kind: 'file' — fileId, filename, page, quote
//
// We narrow on `kind` for each citation before accessing kind-specific
// fields. Caselaw citations render inside the existing <Link> shape (link
// to /cases/...). Legislation citations render as a non-link card (no
// deep-link target yet — flagged for a future pass, possibly to a
// /legislation/[id]/section/[sectionId] route or to the official source
// at legislation.gov.au). File citations render as a smaller item without
// a link (no per-file-page route yet).
//
// Helper: isCaselawCitation. We treat missing `kind` as caselaw for
// backwards compatibility — pre-Chunk-7 rows in the DB don't have a
// kind field but ARE caselaw shape.

function isCaselawCitation(c: Citation): c is CaselawCitation {
  return c.kind === undefined || c.kind === 'caselaw';
}

function isLegislationCitation(c: Citation): c is LegislationCitation {
  return c.kind === 'legislation';
}

function isFileCitation(c: Citation): c is FileCitation {
  return c.kind === 'file';
}

function CitationsPanel({ citations }: { citations: Citation[] }) {
  // Split into the three kinds so we can present them in distinct sections.
  // Caselaw is the established pattern. Legislation is new in Chunk 8.
  // File citations were new in Chunk 7.
  const caselawCitations = citations.filter(isCaselawCitation);
  const legislationCitations = citations.filter(isLegislationCitation);
  const fileCitations = citations.filter(isFileCitation);

  const total =
    caselawCitations.length +
    legislationCitations.length +
    fileCitations.length;
  if (total === 0) return null;

  // Build the summary breakdown text. Only show breakdown if there's a
  // mix of kinds — single-kind sets don't need the parenthetical.
  const kindsPresent = [
    caselawCitations.length > 0,
    legislationCitations.length > 0,
    fileCitations.length > 0,
  ].filter(Boolean).length;
  const showBreakdown = kindsPresent > 1;

  return (
    <details className="bb-citations">
      <summary>
        <span className="bb-citations-arrow" aria-hidden>
          ›
        </span>
        {total} source{total === 1 ? '' : 's'} found
        {showBreakdown && (
          <span className="bb-citations-breakdown">
            {' ('}
            {[
              caselawCitations.length > 0 &&
                `${caselawCitations.length} case${caselawCitations.length === 1 ? '' : 's'}`,
              legislationCitations.length > 0 &&
                `${legislationCitations.length} statute${legislationCitations.length === 1 ? '' : 's'}`,
              fileCitations.length > 0 &&
                `${fileCitations.length} file${fileCitations.length === 1 ? '' : 's'}`,
            ]
              .filter(Boolean)
              .join(', ')}
            {')'}
          </span>
        )}
      </summary>
      <ul className="bb-citations-list">
        {caselawCitations.map((c) => (
          <CaselawCitationRow key={`cl-${c.index}`} c={c} />
        ))}
        {legislationCitations.map((c) => (
          <LegislationCitationRow key={`lg-${c.index}`} c={c} />
        ))}
        {fileCitations.map((c) => (
          <FileCitationRow key={`fc-${c.index}-${c.fileId}`} c={c} />
        ))}
      </ul>
    </details>
  );
}

function CaselawCitationRow({ c }: { c: CaselawCitation }) {
  return (
    <li>
      <Link
        href={`/cases/${c.judgmentId}#para-${c.paragraphNumber}`}
        className="bb-citations-link"
      >
        <div className="bb-citations-head">
          <span className="bb-citations-num">[{c.index}]</span>
          <span className="bb-citations-name">
            {c.caseName ?? 'Untitled'}
          </span>
          <span className="bb-citations-cite">{c.citation}</span>
          <span className="bb-citations-para">at [{c.paragraphNumber}]</span>
          <span className="bb-citations-sim">
            {(c.similarity * 100).toFixed(0)}%
          </span>
        </div>
        <p className="bb-citations-snippet">{c.paragraphText}</p>
      </Link>
    </li>
  );
}

function LegislationCitationRow({ c }: { c: LegislationCitation }) {
  // No deep-link target yet — render as a div, not a Link. Future passes
  // could route to /legislation/[id]/section/[sectionId] or to the
  // official version on legislation.gov.au. The sectionId is
  // captured in the citation so future-us can wire the link in.
  return (
    <li>
      <div className="bb-citations-link bb-citations-link--legislation">
        <div className="bb-citations-head">
          <span className="bb-citations-num">[{c.index}]</span>
          <span className="bb-citations-kind">Statute</span>
          <span className="bb-citations-cite">{c.citation}</span>
          <span className="bb-citations-sim">
            {(c.similarity * 100).toFixed(0)}%
          </span>
        </div>
        {c.heading && (
          <p className="bb-citations-heading">{c.heading}</p>
        )}
        <p className="bb-citations-breadcrumb">{c.breadcrumb}</p>
        {c.text.length > 0 && (
          <p className="bb-citations-snippet">{c.text}</p>
        )}
      </div>
    </li>
  );
}

function FileCitationRow({ c }: { c: FileCitation }) {
  // No per-file-page route yet — render as a plain div, not a Link.
  // Future: a /files/[id]?page=N route would make these clickable.
  return (
    <li>
      <div className="bb-citations-link bb-citations-link--file">
        <div className="bb-citations-head">
          <span className="bb-citations-num">[{c.index}]</span>
          <span className="bb-citations-name">{c.filename}</span>
          <span className="bb-citations-para">p. {c.page}</span>
        </div>
        <p className="bb-citations-snippet">&ldquo;{c.quote}&rdquo;</p>
      </div>
    </li>
  );
}
