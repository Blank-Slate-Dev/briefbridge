// app/(app)/matters/[id]/_components/use-ai-access.ts
//
// AI access state for a matter, designed to be COMPOSED into the
// existing FilesProvider rather than replacing it.
//
// Why this shape: I don't have your existing FilesProvider in context.
// The safe move is to expose a hook that:
//
//   1. Holds the aiAccess state (fetched on mount)
//   2. Provides setAiAccess(args) that calls the server action
//   3. Provides invalidateAfterUpload() — called by the upload flow
//      when a new file lands, to force a re-fetch (which will reflect
//      ai_access_committed_at being NULL'd by the server)
//
// The provider can then spread this hook's return value into its
// context value, and components (AiAccessPanel) consume it via useFiles().
//
// Wire-up — see README §4:
//
//   In files-provider.tsx:
//
//     const aiAccessApi = useAiAccess({ matterId, initialState: ... });
//     // ... existing state ...
//     return (
//       <FilesContext.Provider value={{
//         files, addFile, deleteFile, // existing
//         ...aiAccessApi,             // NEW
//       }}>...</FilesContext.Provider>
//     );
//
//   In the completeUpload action (Chunk 6's _actions.ts), after the
//   file row is finalized, also call invalidateAiAccessOnUpload(userId,
//   matterId). The provider's existing onUpload listener can then call
//   the hook's invalidateAfterUpload(). See README §4.

'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  getAiAccessAction,
  updateAiAccessAction,
} from '@/app/(app)/matters/[id]/files/_actions-ai';
import type { AiAccessState } from '@/lib/db/queries/ai-access';
import type { AiAccessMode } from '@/lib/files/ai-access-types';

// =============================================================================
// Hook API — what the provider should expose
// =============================================================================

export interface AiAccessApi {
  /** Current state — null while loading on first mount. */
  aiAccess: AiAccessState | null;
  /** Loading indicator for the panel. */
  isAiAccessLoading: boolean;
  /** Confirm new settings. Returns { ok: true } on success. */
  setAiAccess: (args: {
    mode: AiAccessMode;
    excludedFileIds: string[];
  }) => Promise<{ ok: true } | { ok: false; error: string }>;
  /**
   * Re-fetch from the server. Call this after an upload — the upload
   * server action will have NULL'd ai_access_committed_at if access
   * was active, and the re-fetch will surface the pending state.
   */
  invalidateAfterUpload: () => Promise<void>;
}

// =============================================================================
// Hook
// =============================================================================

export function useAiAccess(args: {
  matterId: string;
  /** Optional initial state if the parent already fetched it server-side. */
  initialState?: AiAccessState | null;
}): AiAccessApi {
  const [state, setState] = useState<AiAccessState | null>(
    args.initialState ?? null,
  );
  const [isLoading, setIsLoading] = useState(args.initialState === undefined);

  // Initial fetch (only if not seeded with initialState).
  useEffect(() => {
    if (args.initialState !== undefined) {
      // Caller seeded us; honor that.
      setState(args.initialState);
      setIsLoading(false);
      return;
    }
    let cancelled = false;
    setIsLoading(true);
    (async () => {
      const result = await getAiAccessAction({ matterId: args.matterId });
      if (cancelled) return;
      if (result.ok) {
        setState(result.data.state);
      } else {
        // eslint-disable-next-line no-console
        console.error('Failed to fetch AI access state:', result.error);
        setState(null);
      }
      setIsLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [args.matterId, args.initialState]);

  const setAiAccess = useCallback<AiAccessApi['setAiAccess']>(
    async ({ mode, excludedFileIds }) => {
      const result = await updateAiAccessAction({
        matterId: args.matterId,
        mode,
        excludedFileIds,
      });
      if (result.ok) {
        setState(result.data.state);
        return { ok: true };
      }
      return { ok: false, error: result.error };
    },
    [args.matterId],
  );

  const invalidateAfterUpload = useCallback(async () => {
    // Re-fetch — the upload server action will have NULL'd
    // ai_access_committed_at if access was active. This call surfaces
    // that change.
    const result = await getAiAccessAction({ matterId: args.matterId });
    if (result.ok) {
      setState(result.data.state);
    }
  }, [args.matterId]);

  return {
    aiAccess: state,
    isAiAccessLoading: isLoading,
    setAiAccess,
    invalidateAfterUpload,
  };
}
