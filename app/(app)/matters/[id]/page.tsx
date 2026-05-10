// app/(app)/matters/[id]/page.tsx
//
// Server-side entry: awaits the params Promise (Next.js 16 convention) and
// hands the resolved id to the Client view. The actual rendering happens
// in MatterView (client) so it can subscribe to the MattersProvider context
// and reflect status changes live.

import { MatterView } from './_components/matter-view';

export default async function MatterPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <MatterView id={id} />;
}
