// app/(app)/chat/page.tsx
//
// Standalone /chat page. Server Component that:
//   - Authenticates the user (redirects to /login if anon)
//   - Reads ?conversationId=X from the URL
//   - If present, server-fetches the conversation's messages via
//     getConversationWithMessages() — but ONLY if the conversation is
//     STANDALONE (matter_id IS NULL). If the conversation has a matter_id,
//     redirect to the matter detail page instead (URL canonicalisation).
//   - Renders ChatClient with the loaded state
//
// What changed in Chunk 5:
//   - When a conversationId is in the URL but it belongs to a matter,
//     redirect to /matters/<matterId>?conversationId=<id> instead of
//     loading it here. Keeps in-matter research on the matter page.
//   - Otherwise unchanged from Chunk 3.

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getConversationWithMessages } from '@/lib/db/queries/conversations';
import { ChatClient } from './_components/chat-client';
import type { InitialMessage } from '../_components/streaming-chat';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: Promise<{ conversationId?: string }>;
}

export default async function ChatPage({ searchParams }: PageProps) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  const { conversationId } = await searchParams;

  let initialMessages: InitialMessage[] = [];
  let initialConversationId: string | null = null;

  if (conversationId) {
    const session = await getConversationWithMessages(user.id, conversationId);
    if (session) {
      // If this conversation belongs to a matter, send the user to the
      // matter detail page — that's where in-matter research lives.
      if (session.conversation.matterId) {
        redirect(
          `/matters/${session.conversation.matterId}?conversationId=${session.conversation.id}`,
        );
      }
      // Otherwise: it's a standalone conversation — load it here.
      initialConversationId = session.conversation.id;
      initialMessages = session.messages.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        citations: m.citations ?? undefined,
      }));
    }
    // If session is null (not found / not owned), we silently render the
    // fresh state. The user will see the welcome screen. A redirect to
    // /chat (no query param) would also be reasonable; we keep the URL
    // stable so the browser back button works predictably.
  }

  return (
    <ChatClient
      initialMessages={initialMessages}
      initialConversationId={initialConversationId}
    />
  );
}
