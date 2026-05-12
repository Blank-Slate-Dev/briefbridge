// app/(app)/matters/[id]/_components/matter-research-tab.tsx
//
// The merged "Research" tab inside a matter. Replaces the old "Chat" + 
// "Conversations" tabs from Chunk 2-3.
//
// Two view modes based on ?conversationId= in the URL:
//
//   LIST VIEW (no ?conversationId)
//   ─────────────────────────────────────
//   - "In context · <matter name>" banner
//   - "+ New research" button (top-right of bar)
//   - Empty state OR "Past research" list
//
//   ACTIVE VIEW (?conversationId=<uuid>)
//   ─────────────────────────────────────
//   - "In context · <matter name>" banner
//   - "← Back to list" button (top-right of bar)
//   - Full StreamingChat with that conversation's messages preloaded
//
// Renaming convention (Chunk 5):
//   - User-facing label: "Research" (was "Chat")
//   - URL: still /matters/[id]?conversationId=X (no rename)
//   - Internal: this file is matter-research-tab.tsx; data shape still
//     uses "conversation" terminology (Conversation, conversationId)
//     because that's what the DB calls them and they ARE conversations
//     (just lawyer↔AI ones for now).

'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import type { Conversation } from '@/lib/db/schema';
import { StreamingChat, type InitialMessage } from '../../../_components/streaming-chat';

interface MatterResearchTabProps {
  matterId: string;
  matterName: string;
  /** Past in-matter conversations, most-recently-updated first. */
  conversations: Conversation[];
  /**
   * The conversation that's currently active (URL has ?conversationId=X
   * and it's owned by this matter). When null, we show the list view
   * (or the compose-new view if ?compose=1 is set).
   */
  activeConversation: {
    conversation: Conversation;
    messages: InitialMessage[];
  } | null;
  /**
   * File and authority counts, for the context banner.
   * Defaulted to 0 since file upload / authorities tracking aren't wired
   * to real data yet (Chunk 6+ territory).
   */
  fileCount?: number;
  authorityCount?: number;
}

export function MatterResearchTab({
  matterId,
  matterName,
  conversations,
  activeConversation,
  fileCount = 0,
  authorityCount = 0,
}: MatterResearchTabProps) {
  // Read ?compose=1 to detect "new research" mode (StreamingChat with no
  // existing conversation, ready to create one on first message).
  const searchParams = useSearchParams();
  const isComposing = searchParams.get('compose') === '1';

  // View mode: 'active' (existing conversation), 'compose' (new one),
  // or 'list' (default — show past sessions).
  const mode: 'active' | 'compose' | 'list' = activeConversation
    ? 'active'
    : isComposing
      ? 'compose'
      : 'list';

  return (
    <div className="bb-matter-research">
      {/* Context banner is always shown — same affordance in all modes */}
      <div className="bb-matter-chat-context">
        <span className="bb-matter-chat-context-label">In context</span>
        <span className="bb-matter-chat-context-name">{matterName}</span>
        <span className="bb-matter-chat-context-meta">
          {fileCount} file{fileCount === 1 ? '' : 's'} ·{' '}
          {authorityCount} authorit{authorityCount === 1 ? 'y' : 'ies'}
        </span>
      </div>

      {/* Action bar — "+ New research" on list, "← Back to list" elsewhere */}
      <div className="bb-matter-research-bar">
        {mode === 'list' ? (
          <>
            <span />
            <Link
              href={`/matters/${matterId}?compose=1`}
              className="bb-matter-research-listbutton"
              prefetch={false}
            >
              + New research
            </Link>
          </>
        ) : (
          <>
            <span />
            <Link
              href={`/matters/${matterId}`}
              className="bb-matter-research-backbutton"
              prefetch={false}
            >
              ← Back to list
            </Link>
          </>
        )}
      </div>

      {/* Mode-specific body */}
      {mode === 'active' && activeConversation && (
        <ActiveSession
          matterId={matterId}
          conversation={activeConversation.conversation}
          messages={activeConversation.messages}
        />
      )}
      {mode === 'compose' && <ComposeSession matterId={matterId} />}
      {mode === 'list' && (
        <ListView matterId={matterId} conversations={conversations} />
      )}
    </div>
  );
}

// =============================================================================
// List view — past sessions, or empty state
// =============================================================================

function ListView({
  matterId,
  conversations,
}: {
  matterId: string;
  conversations: Conversation[];
}) {
  if (conversations.length === 0) {
    return (
      <div className="bb-chat-empty">
        <h3>Ask a question in this case&apos;s context</h3>
        <p>
          BriefBridge will use the case files, authorities, and prior
          research from this case to ground its answer. Click{' '}
          <strong>+ New research</strong> above to start.
        </p>
      </div>
    );
  }

  return (
    <div>
      <h4 className="bb-matter-research-list-heading">Past research</h4>
      <ul className="bb-matter-research-list">
        {conversations.map((c) => (
          <li key={c.id}>
            <Link
              href={`/matters/${matterId}?conversationId=${c.id}`}
              className="bb-matter-research-item"
              prefetch={false}
            >
              <div className="bb-matter-research-item-head">
                <h3 className="bb-matter-research-item-title">
                  {c.title ?? 'Untitled research'}
                </h3>
                <span className="bb-matter-research-item-time">
                  {formatRelative(c.updatedAt)}
                </span>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

// =============================================================================
// Active session — StreamingChat with this conversation's messages preloaded
// =============================================================================

function ActiveSession({
  matterId,
  conversation,
  messages,
}: {
  matterId: string;
  conversation: Conversation;
  messages: InitialMessage[];
}) {
  return (
    <StreamingChat
      // Key on the conversation id so switching between sessions cleanly
      // remounts the StreamingChat with the new initial state.
      key={conversation.id}
      initialMessages={messages}
      initialConversationId={conversation.id}
      matterId={matterId}
      emptyState={
        <div className="bb-chat-empty">
          <h3>Continue this research</h3>
          <p>Ask a follow-up to continue the conversation.</p>
        </div>
      }
      inputPlaceholder="Ask anything about this case…"
    />
  );
}

// =============================================================================
// Compose session — StreamingChat with NO existing conversation, ready to
// create one on first message
// =============================================================================
//
// When the user clicks "+ New research", we navigate to ?compose=1 and
// render this. Empty state shows the in-context prompt. First user message
// creates a new conversation server-side (via /api/chat), and the SSE
// 'conversation' event fires with the new id — StreamingChat updates its
// URL to ?conversationId=<new-id> via history.replaceState, leaving the
// ?compose=1 in the URL (harmless). On next navigation, the URL is clean.

function ComposeSession({ matterId }: { matterId: string }) {
  return (
    <StreamingChat
      // Force fresh state every time the user enters compose mode.
      key="compose"
      initialMessages={[]}
      initialConversationId={null}
      matterId={matterId}
      emptyState={
        <div className="bb-chat-empty">
          <h3>Ask a question in this case&apos;s context</h3>
          <p>
            BriefBridge will use the case files, authorities, and prior
            research from this case to ground its answer.
          </p>
        </div>
      }
      inputPlaceholder="Ask anything about this case…"
    />
  );
}

// =============================================================================
// Utilities
// =============================================================================

function formatRelative(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  const diffMs = Date.now() - d.getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  const diffHr = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHr / 24);

  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHr < 24) return `${diffHr}h ago`;
  if (diffDay < 7) return `${diffDay}d ago`;

  return d.toLocaleDateString('en-AU', {
    day: 'numeric',
    month: 'short',
  });
}
