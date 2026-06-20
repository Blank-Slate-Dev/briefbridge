// lib/db/queries/conversations.ts
//
// Query helpers for the `conversations` and `messages` tables.
//
// Same rules as matters.ts: every query is scoped by userId. The functions
// take userId as the first argument by convention to make scoping impossible
// to forget.
//
// For message-level operations, we go through the conversation: appendMessage
// verifies the conversation belongs to the user before inserting. We do NOT
// expose any "modify message by message id" helpers — messages are immutable
// once written.

import { and, asc, desc, eq, isNull } from 'drizzle-orm';
import { db } from '@/lib/db';
import { withUser } from '@/lib/db/with-user';
import {
  conversations,
  messages,
  type Conversation,
  type NewConversation,
  type Message,
  type StoredCitation,
} from '@/lib/db/schema';

// =============================================================================
// List
// =============================================================================

export interface ListConversationsOptions {
  /**
   * Filter by matter:
   *   - omit (undefined)  → all conversations (standalone + in-matter)
   *   - null              → only standalone conversations (matter_id IS NULL)
   *   - <uuid string>     → only conversations in that specific matter
   */
  matterId?: string | null;
  /** Cap the result size. Defaults to 50. Hard max 200. */
  limit?: number;
}

/**
 * Lists conversations for the given user, most-recently-updated first.
 *
 * The matterId option lets you scope:
 *   - listConversations(uid)                     → everything
 *   - listConversations(uid, { matterId: null }) → standalone /chat conversations
 *   - listConversations(uid, { matterId: '...' }) → one matter's conversations
 */
export async function listConversations(
  userId: string,
  options: ListConversationsOptions = {},
): Promise<Conversation[]> {
  const limit = Math.min(200, Math.max(1, options.limit ?? 50));

  const conditions = [eq(conversations.userId, userId)];
  if (options.matterId === null) {
    conditions.push(isNull(conversations.matterId));
  } else if (typeof options.matterId === 'string') {
    conditions.push(eq(conversations.matterId, options.matterId));
  }

  return withUser(userId, (tx) =>
    tx
      .select()
      .from(conversations)
      .where(and(...conditions))
      .orderBy(desc(conversations.updatedAt))
      .limit(limit),
  );
}

// =============================================================================
// Create
// =============================================================================

export interface CreateConversationInput {
  /** Optional. Null/undefined = standalone /chat conversation. */
  matterId?: string | null;
  /** Optional. The first user message often becomes the title later. */
  title?: string | null;
}

/**
 * Creates a new conversation owned by the user.
 *
 * If matterId is provided, we trust the caller has already verified the
 * matter belongs to the user. (In practice, the only caller is the chat
 * route handler, which constructs conversations from a verified user
 * context.) The RLS policy provides a backstop here: even if a bad caller
 * inserted with a foreign user's matterId, RLS would reject it — provided
 * the query were running as the auth role, which our Drizzle queries do
 * not. So: callers MUST verify matter ownership themselves before passing
 * matterId. For Chunk 3, that responsibility lives in /api/chat/route.ts.
 */
export async function createConversation(
  userId: string,
  input: CreateConversationInput = {},
): Promise<Conversation> {
  const values: NewConversation = {
    userId,
    matterId: input.matterId ?? null,
    title: input.title ?? null,
  };

  const [inserted] = await withUser(userId, (tx) =>
    tx.insert(conversations).values(values).returning(),
  );
  return inserted;
}

// =============================================================================
// Append message (with conversation ownership check)
// =============================================================================

export interface AppendMessageInput {
  conversationId: string;
  role: 'user' | 'assistant';
  content: string;
  /** Only used for assistant messages; user messages should pass null. */
  citations?: StoredCitation[] | null;
}

/**
 * Appends a message to a conversation, IF the conversation belongs to the user.
 *
 * Returns the inserted message, or throws if the conversation isn't owned by
 * the user. We throw instead of returning null because callers (the chat
 * route) should ALREADY have verified ownership earlier in the request —
 * a missing conversation at this point is a programmer error, not a 404.
 *
 * Also bumps the conversation's updatedAt so it sorts to the top of the
 * conversation list.
 */
export async function appendMessage(
  userId: string,
  input: AppendMessageInput,
): Promise<Message> {
  // All three statements (ownership check, insert, updatedAt bump) run in one
  // withUser transaction: they share the identity context AND become atomic.
  return withUser(userId, async (tx) => {
    // Verify conversation ownership first.
    const conversation = await tx
      .select({ id: conversations.id })
      .from(conversations)
      .where(
        and(
          eq(conversations.id, input.conversationId),
          eq(conversations.userId, userId),
        ),
      )
      .limit(1);

    if (conversation.length === 0) {
      throw new Error(
        `appendMessage: conversation ${input.conversationId} not found or not owned by user ${userId}`,
      );
    }

    // Insert the message — ownership has been checked.
    const [inserted] = await tx
      .insert(messages)
      .values({
        conversationId: input.conversationId,
        role: input.role,
        content: input.content,
        citations: input.citations ?? null,
      })
      .returning();

    // Bump the conversation's updatedAt.
    await tx
      .update(conversations)
      .set({ updatedAt: new Date() })
      .where(eq(conversations.id, input.conversationId));

    return inserted;
  });
}

// =============================================================================
// Get conversation with messages
// =============================================================================

export interface ConversationWithMessages {
  conversation: Conversation;
  messages: Message[];
}

/**
 * Loads a conversation along with all its messages, IF owned by the user.
 *
 * Returns null if the conversation doesn't exist or isn't owned by this user.
 *
 * Messages are returned in chronological order (oldest first), which is the
 * order the chat UI renders them.
 *
 * Two queries (one for the conversation, one for messages) instead of a
 * JOIN — JOINs against jsonb columns are awkward to type and the round-trip
 * cost is negligible.
 */
export async function getConversationWithMessages(
  userId: string,
  conversationId: string,
): Promise<ConversationWithMessages | null> {
  return withUser(userId, async (tx) => {
    const conversationRows = await tx
      .select()
      .from(conversations)
      .where(
        and(
          eq(conversations.id, conversationId),
          eq(conversations.userId, userId),
        ),
      )
      .limit(1);

    const conversation = conversationRows[0];
    if (!conversation) return null;

    const messageRows = await tx
      .select()
      .from(messages)
      .where(eq(messages.conversationId, conversationId))
      .orderBy(asc(messages.createdAt));

    return { conversation, messages: messageRows };
  });
}

/**
 * Lighter variant — just fetch a conversation's metadata without its messages.
 * Used for ownership checks where you don't need the message content.
 */
export async function getConversation(
  userId: string,
  conversationId: string,
): Promise<Conversation | null> {
  const rows = await withUser(userId, (tx) =>
    tx
      .select()
      .from(conversations)
      .where(
        and(
          eq(conversations.id, conversationId),
          eq(conversations.userId, userId),
        ),
      )
      .limit(1),
  );

  return rows[0] ?? null;
}
