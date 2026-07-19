// app/(app)/matters/[id]/page.tsx
//
// Server Component for a single matter's detail page.
//
// What changed in Chunk 6:
//   - Also server-fetches the matter's files via listFiles()
//   - Server-fetches the user's tag history via listUserTagHistory() for
//     the tag editor autocomplete
//   - Passes both through to MatterView, which plumbs to MatterTabs →
//     FilesTab
//
// What's still the same as Chunk 5:
//   - Server-fetches the matter's conversations via listConversations()
//   - If ?conversationId=X is set AND the conversation is owned by the user
//     AND belongs to this matter, also fetches that conversation's messages
//     via getConversationWithMessages()
//
// What's still the same as Chunks 3-4:
//   - Reads `params.id` as `Promise<{id:string}>` (Next 16 idiom)
//   - Authenticates via createClient(), redirects to /login if unauth
//   - Calls notFound() if matter doesn't exist OR isn't owned by user
//   - force-dynamic to ensure server-side fetch happens on each visit

import { notFound, redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getMatterWithAccess } from '@/lib/db/queries/matters';
import { } from '@/lib/db/queries/access';
import {
  listConversations,
  getConversationWithMessages,
} from '@/lib/db/queries/conversations';
import { listFiles, listUserTagHistory } from '@/lib/db/queries/files';
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

  // PERF: one parallel wave. Every fetch below depends only on user.id and
  // ids already present in the URL — not on each other — so they run
  // together. Access verdicts are applied AFTER the wave resolves:
  //   - matter missing            -> notFound()
  //   - visible but not assigned  -> redirect('/matters')   (SLICE 2 gate)
  //   - conversation not owned or wrong matter -> silently ignored
  // Previous shape was 3 serial withUser waves after auth (~1.5s of pure
  // round trips to the DB); this is 1.
  const [access, matterConversations, initialFiles, personalTagHistory, session] =
    await Promise.all([
      getMatterWithAccess(user.id, matterId),
      listConversations(user.id, { matterId, limit: 50 }),
      listFiles(user.id, { matterId }),
      listUserTagHistory(user.id),
      sp.conversationId
        ? getConversationWithMessages(user.id, sp.conversationId)
        : Promise.resolve(null),
    ]);

  if (!access) {
    notFound();
  }
  const { matter, assigned } = access;
  if (!assigned) {
    redirect('/matters');
  }

  let activeConversation: {
    conversation: Conversation;
    messages: InitialMessage[];
  } | null = null;

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

  return (
    <MatterView
      matter={matter}
      matterConversations={matterConversations}
      activeConversation={activeConversation}
      initialFiles={initialFiles}
      personalTagHistory={personalTagHistory}
    />
  );
}
