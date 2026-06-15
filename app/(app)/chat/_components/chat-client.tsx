// app/(app)/chat/_components/chat-client.tsx
//
// Standalone /chat page client. A thin wrapper around the shared
// StreamingChat component. Adds:
//   - The full-viewport flex shell with a sticky-bottom input
//   - The page header ("Research" + "New research" button)
//   - The welcome screen with example-prompt buttons
//
// NAVIGATION / RESET MODEL (read this before touching the key):
//   This page has THREE state transitions to keep straight, and the
//   StreamingChat `key` plus a prop-sync effect handle all three:
//
//   1. Fresh /chat, first message -> SSE returns a new conversation id.
//      onConversationCreated updates the URL via history.replaceState,
//      which does NOT re-run the server component, so the PROP
//      initialConversationId stays null. The key is built from the PROP
//      (not internal state), so it does NOT change -> no remount -> the
//      streaming answer survives. (The old bug keyed on internal state,
//      which the SSE mutated mid-stream -> remount -> vanish.)
//
//   2. Click a past conversation in the sidebar (-> /chat?conversationId=X).
//      The server re-fetches and the PROP initialConversationId changes
//      from null to X. The key changes -> StreamingChat remounts cleanly
//      with the new conversation. We ALSO re-sync this component's own
//      conversationId/messages state from the new props (ChatClient holds
//      its own copy for the header + New research), because props changing
//      doesn't update useState on its own.
//
//   3. "New research" (header button) -> bump resetNonce -> remount to empty.
//
//   Key = `${resetNonce}-${initialConversationId ?? 'new'}`. resetNonce
//   covers the deliberate reset; the prop id covers conversation switches;
//   neither changes on the mid-stream id arrival.

'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  StreamingChat,
  type InitialMessage,
} from '../../_components/streaming-chat';
import { ChatAttachments, type Attachment } from './chat-attachments';

interface ChatClientProps {
  initialMessages: InitialMessage[];
  initialConversationId: string | null;
}

export function ChatClient({
  initialMessages,
  initialConversationId,
}: ChatClientProps) {
  // Local mirrors of the server props. Used for the header (show/hide the
  // "New research" button) and to feed StreamingChat. These must re-sync
  // when the server hands us new props (conversation switch) - see effect.
  const [conversationId, setConversationId] = useState<string | null>(
    initialConversationId,
  );
  const [messages, setMessages] = useState<InitialMessage[]>(initialMessages);

  // Reset counter - bumped ONLY by "New research" to force a clean remount.
  const [resetNonce, setResetNonce] = useState(0);

  // MIGRATION 0009: attached-file state for standalone chat. Lifted here
  // (rather than inside ChatAttachments) so it survives StreamingChat
  // remounts and is cleared on "New research". Each item tracks one
  // attachment's upload status.
  const [attachments, setAttachments] = useState<Attachment[]>([]);

  // Re-sync local state when the server provides new props. This fires when
  // navigating to a different conversation (?conversationId=X changes), where
  // the page server-component re-runs and passes down fresh props. Without
  // this, ChatClient would keep its stale local state and the page wouldn't
  // update on conversation switch.
  //
  // It does NOT fire on the mid-stream id arrival, because that path updates
  // the URL via history.replaceState (no server re-run, so these props don't
  // change) - exactly what we want, so the live answer isn't disturbed.
  useEffect(() => {
    setConversationId(initialConversationId);
    setMessages(initialMessages);
  }, [initialConversationId, initialMessages]);

  // Show the "New research" button only when there's something to reset to.
  const hasActiveSession = conversationId !== null || messages.length > 0;

  // When a brand-new conversation gets an id from SSE, capture it AND update
  // the URL silently. Does NOT remount - see the key discussion above.
  const handleConversationCreated = useCallback((newId: string) => {
    setConversationId(newId);
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      url.searchParams.set('conversationId', newId);
      window.history.replaceState({}, '', url.toString());
    }
  }, []);

  // MIGRATION 0009: when ChatAttachments mints a conversation (attach before
  // first message), capture the id + update the URL. Same mechanics as
  // handleConversationCreated. Reusing the same logic keeps the id and URL
  // in sync no matter which path (send vs attach) creates the conversation.
  const handleConversationEnsured = useCallback((newId: string) => {
    setConversationId(newId);
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      url.searchParams.set('conversationId', newId);
      window.history.replaceState({}, '', url.toString());
    }
  }, []);

  // Reset everything: drop the conversation id, clear messages, clean the
  // URL, and bump the reset nonce so StreamingChat remounts fresh.
  function handleNewResearch() {
    setConversationId(null);
    setMessages([]);
    setAttachments([]);
    setResetNonce((n) => n + 1);
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      url.searchParams.delete('conversationId');
      window.history.replaceState({}, '', url.toString());
    }
  }

  const welcomeNode = (
    <div className="bb-chat-welcome">
      <h1 className="bb-chat-welcome-title">
        How can I help with your research?
      </h1>
      <p className="bb-chat-welcome-sub">
        Ask any question about Australian case law. Currently covering NSW
        Supreme Court 2015–2026.
      </p>
      <div className="bb-chat-welcome-grid">
        {EXAMPLE_PROMPTS.map((ex) => (
          <button
            key={ex}
            type="button"
            className="bb-chat-welcome-example"
            onClick={() => focusInput()}
          >
            {ex}
          </button>
        ))}
      </div>
    </div>
  );

  // The remount key. Built from the PROP conversation id (not internal
  // state) so conversation switches remount but mid-stream id arrivals
  // don't; resetNonce covers the deliberate "New research" reset.
  const chatKey = `${resetNonce}-${initialConversationId ?? 'new'}`;

  return (
    <div className="bb-standalone-chat">
      <header className="bb-standalone-chat-head">
        <h1 className="bb-standalone-chat-title">Research</h1>
        {hasActiveSession && (
          <button
            type="button"
            className="bb-standalone-chat-newchat"
            onClick={handleNewResearch}
          >
            + New research
          </button>
        )}
      </header>

      <StreamingChat
        key={chatKey}
        initialMessages={messages}
        initialConversationId={conversationId}
        onConversationCreated={handleConversationCreated}
        emptyState={welcomeNode}
        inputPlaceholder="Ask a question about Australian case law…"
        attachSlot={
          <ChatAttachments
            conversationId={conversationId}
            onConversationEnsured={handleConversationEnsured}
            attachments={attachments}
            setAttachments={setAttachments}
          />
        }
      />
    </div>
  );
}

const EXAMPLE_PROMPTS = [
  'What test do NSW courts apply when assessing security for costs from an ATE policy?',
  'When can a third party enforce an insurance contract they are not a party to?',
  'What are the principles for assessing damages for breach of fiduciary duty?',
  'How do NSW courts approach setting aside a default judgment?',
];

// Helper to focus the chat input. The textarea lives inside StreamingChat
// so we reach it via a query selector - acceptable for a one-shot focus
// action on welcome-example click. Stable selector because only one
// .bb-chat-input textarea exists on the page at any time.
function focusInput() {
  if (typeof document === 'undefined') return;
  const ta = document.querySelector<HTMLTextAreaElement>('.bb-chat-input textarea');
  ta?.focus();
}
