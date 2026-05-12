// app/(app)/matters/[id]/page.tsx
//
// Server Component for a single matter's detail page.
//
// What changed in Chunk 5:
//   - Also server-fetches the matter's conversations via listConversations()
//   - If ?conversationId=X is set AND the conversation is owned by the user
//     AND belongs to this matter, also fetches that conversation's messages
//     via getConversationWithMessages()
//   - Passes both through to MatterView, which plumbs to MatterTabs →
//     MatterResearchTab
//
// What's still the same as Chunk 3-4:
//   - Reads `params.id` as `Promise<{id:string}>` (Next 16 idiom)
//   - Authenticates via createClient(), redirects to /login if unauth
//   - Calls notFound() if matter doesn't exist OR isn't owned by user
//   - force-dynamic to ensure server-side fetch happens on each visit

import { notFound, redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getMatter } from '@/lib/db/queries/matters';
import {
  listConversations,
  getConversationWithMessages,
} from '@/lib/db/queries/conversations';
import { MatterView } from './_components/matter-view';
import type { InitialMessage } from '../../_components/streaming-chat';
import type { Conversation } from '@/lib/db/schema';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ conversationId?: string; new?: string; compose?: string }>;
}

export default async function MatterDetailPage({
  params,
  searchParams,
}: PageProps) {
  // Auth.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect('/login');
  }

  // Resolve the matter id (Next 16 awaits params + searchParams).
  const { id: matterId } = await params;
  const sp = await searchParams;

  // Fetch the matter — 404 if not found or not owned.
  const matter = await getMatter(user.id, matterId);
  if (!matter) {
    notFound();
  }

  // Fetch the matter's conversations (most-recently-updated first).
  // Limit: 50 covers the realistic case for now; pagination can come later.
  const matterConversations = await listConversations(user.id, {
    matterId: matter.id,
    limit: 50,
  });

  // If ?conversationId=X is set, fetch that conversation's messages
  // (with ownership + matter-scope check). We pass the resolved data
  // straight to MatterView in the shape it expects.
  let activeConversation: {
    conversation: Conversation;
    messages: InitialMessage[];
  } | null = null;

  if (sp.conversationId) {
    const session = await getConversationWithMessages(user.id, sp.conversationId);
    if (session && session.conversation.matterId === matter.id) {
      activeConversation = {
        conversation: session.conversation,
        messages: session.messages.map((m) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          citations: m.citations ?? undefined,
        })),
      };
    }
    // If the conversation isn't found or doesn't belong to this matter,
    // we silently fall through to the list view. A friendlier UX might
    // redirect to /matters/[id] without the query param, but a silent
    // fall-through keeps the URL stable for the browser's history.
  }

  return (
    <MatterView
      matter={matter}
      matterConversations={matterConversations}
      activeConversation={activeConversation}
    />
  );
}
