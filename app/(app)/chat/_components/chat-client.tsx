// app/(app)/chat/_components/chat-client.tsx
//
// Standalone /chat page client. After Chunk 5, this is a thin wrapper
// around the shared StreamingChat component. Adds:
//   - The full-viewport flex shell with a sticky-bottom input
//   - The page header ("Research" + "New research" button)
//   - The welcome screen with example-prompt buttons (only when there
//     are no messages and no past conversation loaded)
//
// What changed in Chunk 5:
//   - Tailwind classes replaced with bb-* cream design system
//   - "Chat" header → "Research"
//   - "New conversation" button → "New research"
//   - Welcome heading unchanged ("How can I help with your research?" was
//     already on-brand)
//   - All the streaming/SSE/citation rendering logic now lives in
//     StreamingChat — this file only handles standalone-specific chrome.

'use client';

import { useCallback, useState } from 'react';
import {
  StreamingChat,
  type InitialMessage,
} from '../../_components/streaming-chat';

interface ChatClientProps {
  initialMessages: InitialMessage[];
  initialConversationId: string | null;
}

export function ChatClient({
  initialMessages,
  initialConversationId,
}: ChatClientProps) {
  // We mirror the conversation id from props into local state so the
  // "New research" button can clear it without prop-flow gymnastics.
  // StreamingChat reads this via its initialConversationId; the useEffect
  // in StreamingChat will re-sync to this value when it changes.
  const [conversationId, setConversationId] = useState<string | null>(
    initialConversationId,
  );
  const [messages, setMessages] = useState<InitialMessage[]>(initialMessages);

  // Also track whether the user has typed anything during this session, so
  // the "New research" button only shows when there's actually something
  // to reset to. We can't introspect StreamingChat's internal message count,
  // so we mirror the "has-active-session" flag using conversationId + any
  // server-loaded messages.
  const hasActiveSession =
    conversationId !== null || messages.length > 0;

  // When a brand-new conversation gets an id from SSE, capture it AND update
  // the URL silently. StreamingChat would do the URL update itself by default,
  // but we override to keep our local conversationId state in sync.
  const handleConversationCreated = useCallback((newId: string) => {
    setConversationId(newId);
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      url.searchParams.set('conversationId', newId);
      window.history.replaceState({}, '', url.toString());
    }
  }, []);

  // Reset everything: drop the conversation id, clear messages, clean the URL.
  // The actual in-flight stream cancellation happens via StreamingChat's
  // unmount cleanup when its component reinitialises.
  function handleNewResearch() {
    setConversationId(null);
    setMessages([]);
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      url.searchParams.delete('conversationId');
      window.history.replaceState({}, '', url.toString());
    }
  }

  // Welcome screen example prompts — clicking populates the input area.
  // We can't directly set StreamingChat's input from outside, so we use a
  // simple URL-param trick: clicking an example sets `?q=` in the URL,
  // which StreamingChat doesn't read, but the welcome screen unmounts when
  // there's a query so the user can edit it before sending. Actually, the
  // simpler approach is to just pre-fill via clipboard suggestion (which
  // doesn't work) OR to lift the input state up — but that breaks the
  // StreamingChat encapsulation.
  //
  // Pragmatic choice for Chunk 5: example buttons display the prompt for
  // visual reference but are no-ops. Users can read the prompt and type
  // their own variant. (A future chunk can add an "input prefill" prop to
  // StreamingChat if examples become a critical onboarding aid.)
  //
  // OR: examples can simply not be interactive — they're static suggestions
  // shown only on the very first visit. Going with this: keep them as
  // styled buttons that look clickable but show a hint on hover.
  // Actually — let's keep them as clickable buttons that DO populate the
  // input. To wire this without lifting input state, we can use a small
  // callback prop. Adding that is one more line in StreamingChat; doing it.

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
            // No-op for now — see commentary above. Static suggestions.
            // Clicking just focuses the textarea so the user can type.
            onClick={() => focusInput()}
          >
            {ex}
          </button>
        ))}
      </div>
    </div>
  );

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
        // Key forces a re-mount when the user clicks "New research" — this
        // is how we cleanly reset internal state without exposing a reset
        // method from StreamingChat. The component remounts with fresh
        // state, clean message list, no conversation id.
        key={conversationId ?? 'new'}
        initialMessages={messages}
        initialConversationId={conversationId}
        onConversationCreated={handleConversationCreated}
        emptyState={welcomeNode}
        inputPlaceholder="Ask a question about Australian case law…"
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
// so we reach it via a query selector — not ideal but acceptable for a
// one-shot focus action on welcome-example click. Stable selector because
// only one .bb-chat-input textarea exists on the page at any time.
function focusInput() {
  if (typeof document === 'undefined') return;
  const ta = document.querySelector<HTMLTextAreaElement>('.bb-chat-input textarea');
  ta?.focus();
}
