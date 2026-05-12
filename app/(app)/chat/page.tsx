// app/(app)/chat/page.tsx
//
// Streaming chat UI for standalone Q&A (not within a matter).
//
// What changed in Chunk 3:
//   - This page is now a thin Server Component that reads ?conversationId=
//     from the URL, fetches the conversation + messages server-side if
//     present, and hands them to the Client Component.
//   - The Client Component (chat-client.tsx) handles all interactivity:
//     streaming, message rendering, URL updates when a new conversation
//     is created.
//   - The Client Component listens for the 'conversation' SSE event and
//     updates the URL to /chat?conversationId=<id> using history.replaceState
//     so the user can refresh / share / bookmark a conversation.

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getConversationWithMessages } from '@/lib/db/queries/conversations';
import { ChatClient, type InitialMessage } from './_components/chat-client';
import type { StoredCitation } from '@/lib/db/schema';

export const dynamic = 'force-dynamic';

interface ChatPageProps {
  searchParams: Promise<{
    conversationId?: string;
  }>;
}

export default async function ChatPage({ searchParams }: ChatPageProps) {
  const params = await searchParams;
  const conversationId = params.conversationId;

  // Auth.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect('/login?next=/chat');
  }

  // If a conversationId is in the URL, load it server-side. If it doesn't
  // exist OR isn't owned by this user, we silently drop it and let the
  // user start a fresh conversation. (Returning 404 here would block them
  // from chatting at all if they have a stale bookmark.)
  let initialMessages: InitialMessage[] = [];
  let resolvedConversationId: string | null = null;

  if (conversationId) {
    const data = await getConversationWithMessages(user.id, conversationId);
    if (data) {
      resolvedConversationId = data.conversation.id;
      initialMessages = data.messages.map((m) => ({
        id: m.id,
        role: m.role as 'user' | 'assistant',
        content: m.content,
        citations: (m.citations as StoredCitation[] | null) ?? undefined,
      }));
    }
  }

  return (
    <ChatClient
      initialMessages={initialMessages}
      initialConversationId={resolvedConversationId}
    />
  );
}
