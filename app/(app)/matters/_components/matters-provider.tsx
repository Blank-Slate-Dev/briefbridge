// app/(app)/matters/_components/matters-provider.tsx
//
// Client-side state for the matters list, used so the matter cards, the
// matter detail page, AND the sidebar can all read from the same source
// and reflect changes (status, archive, new matter, inline edits) live
// without a full-page refresh.
//
// What changed in Chunk 4:
//   - New `updateDetails(id, fields)` method that mirrors the optimistic
//     update + rollback pattern of `updateStatus`. Used by the inline-edit
//     fields on the matter detail page header. Changes propagate live to
//     the sidebar (case row title + client subtitle update immediately).
//
// What was in Chunk 3:
//   - The provider no longer seeds itself from MOCK_MATTERS.
//   - It accepts `initialMatters: Matter[]` as a prop, populated by the
//     server-side (app) layout via lib/db/queries/matters.ts.
//   - `updateStatus` optimistically updates client state AND calls a
//     server action that writes to the DB. Rolls back on failure.
//   - `addMatter` and `archive` helpers for the "+ New case" and
//     archive flows.
//
// Why still a Context (not server-only):
//   The status pill, sidebar, and detail page all need to reflect changes
//   immediately. Without a client store, every change would trigger a
//   full page refetch. Optimistic updates feel instant.

'use client';

import {
  createContext,
  startTransition,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from 'react';
import type { Matter } from '@/lib/db/schema';
import type { MatterStatus } from '../_data/mock-matters';
import {
  updateMatterStatusAction,
  updateMatterDetailsAction,
  archiveMatterAction,
} from '../_actions';

// =============================================================================
// Context shape
// =============================================================================

/** Fields editable via the inline-edit header. */
export interface MatterDetailsPatch {
  /** New matter name (must be non-empty after trim, max 200 chars). */
  name?: string;
  /** New client name. null/empty clears it. Max 200 chars. */
  client?: string | null;
  /** New description. null/empty clears it. Max 2000 chars. */
  description?: string | null;
}

interface MattersContextValue {
  /** The user's matters, ordered by most-recently-updated first. */
  matters: Matter[];
  /**
   * Update a matter's status. Optimistically applies client-side, then
   * persists via a server action. If the server call fails, the optimistic
   * update is rolled back.
   */
  updateStatus: (id: string, status: MatterStatus) => Promise<void>;
  /**
   * Update a matter's name / client / description. Same optimistic-update
   * + rollback pattern as updateStatus. Pass only the fields that changed.
   *
   * The server enforces non-empty `name` and the length caps; this client-
   * side method does the same checks for fast feedback. If validation fails
   * locally, the promise resolves without touching the server and the
   * caller receives `{ ok: false, error }` from the result.
   */
  updateDetails: (
    id: string,
    fields: MatterDetailsPatch,
  ) => Promise<{ ok: true } | { ok: false; error: string }>;
  /**
   * Archive a matter (soft delete). Optimistically removes it from the
   * client list, then persists. Rolls back on error.
   */
  archive: (id: string) => Promise<void>;
  /**
   * Add a newly-created matter to the client list. Called by the
   * "+ New case" server action after the matter has been created.
   */
  addMatter: (matter: Matter) => void;
  /** Convenience: find a matter by id from the current state. */
  findMatter: (id: string) => Matter | undefined;
}

const MattersContext = createContext<MattersContextValue | null>(null);

// =============================================================================
// Provider
// =============================================================================

export function MattersProvider({
  children,
  initialMatters,
}: {
  children: ReactNode;
  /**
   * Initial matters fetched server-side. Defaults to [] so that pages
   * which don't need matters (like /chat) can still render without
   * the layout needing to do a query.
   */
  initialMatters?: Matter[];
}) {
  const [matters, setMatters] = useState<Matter[]>(initialMatters ?? []);

  const updateStatus = useCallback(
    async (id: string, status: MatterStatus) => {
      // 1. Snapshot the previous state for rollback.
      let previousStatus: MatterStatus | null = null;
      setMatters((prev) => {
        return prev.map((m) => {
          if (m.id === id) {
            previousStatus = m.status as MatterStatus;
            return { ...m, status, updatedAt: new Date() };
          }
          return m;
        });
      });

      // 2. Persist to DB. If it fails, roll back.
      try {
        const result = await updateMatterStatusAction(id, status);
        if (!result.ok) {
          throw new Error(result.error);
        }
      } catch (err) {
        // Roll back the optimistic update.
        if (previousStatus !== null) {
          const rollbackTo = previousStatus;
          setMatters((prev) =>
            prev.map((m) => (m.id === id ? { ...m, status: rollbackTo } : m)),
          );
        }
        // eslint-disable-next-line no-console
        console.error('Failed to update matter status:', err);
        throw err;
      }
    },
    [],
  );

  const updateDetails = useCallback(
    async (
      id: string,
      fields: MatterDetailsPatch,
    ): Promise<{ ok: true } | { ok: false; error: string }> => {
      // ---- Client-side validation (matches the server) ---------------------
      // The intent is to fail fast WITHOUT touching the network for obvious
      // bad input. The component layer also does its own input-level
      // validation (e.g. silent snap-back on empty name) so this is mostly
      // a backstop.
      if (fields.name !== undefined) {
        const trimmed = fields.name.trim();
        if (trimmed.length === 0) {
          return { ok: false, error: 'Name cannot be empty.' };
        }
        if (trimmed.length > 200) {
          return {
            ok: false,
            error: 'Name is too long (max 200 characters).',
          };
        }
      }
      if (
        typeof fields.client === 'string' &&
        fields.client.trim().length > 200
      ) {
        return {
          ok: false,
          error: 'Client name is too long (max 200 characters).',
        };
      }
      if (
        typeof fields.description === 'string' &&
        fields.description.trim().length > 2000
      ) {
        return {
          ok: false,
          error: 'Description is too long (max 2000 characters).',
        };
      }

      // ---- Snapshot for rollback -------------------------------------------
      // Capture only the fields we're changing so rollback restores them
      // exactly. Other fields are untouched by the optimistic update so they
      // don't need snapshotting.
      let previousValues: Partial<Matter> | null = null;
      setMatters((prev) => {
        return prev.map((m) => {
          if (m.id !== id) return m;

          // Capture the previous values of fields being changed.
          const snapshot: Partial<Matter> = {};
          if (fields.name !== undefined) snapshot.name = m.name;
          if (fields.client !== undefined) snapshot.client = m.client;
          if (fields.description !== undefined)
            snapshot.description = m.description;
          previousValues = snapshot;

          // Apply optimistic update. We trim string inputs to match the
          // server's normalisation.
          const patch: Partial<Matter> = { updatedAt: new Date() };
          if (fields.name !== undefined) {
            patch.name = fields.name.trim();
          }
          if (fields.client !== undefined) {
            patch.client =
              fields.client === null
                ? null
                : fields.client.trim().length === 0
                  ? null
                  : fields.client.trim();
          }
          if (fields.description !== undefined) {
            patch.description =
              fields.description === null
                ? null
                : fields.description.trim().length === 0
                  ? null
                  : fields.description.trim();
          }
          return { ...m, ...patch };
        });
      });

      // ---- Persist + roll back on failure ----------------------------------
      try {
        const result = await updateMatterDetailsAction(id, fields);
        if (!result.ok) {
          throw new Error(result.error);
        }
        return { ok: true };
      } catch (err) {
        // Roll back the optimistic update.
        if (previousValues !== null) {
          const rollback: Partial<Matter> = previousValues;
          setMatters((prev) =>
            prev.map((m) => (m.id === id ? { ...m, ...rollback } : m)),
          );
        }
        const message = err instanceof Error ? err.message : 'Update failed.';
        // eslint-disable-next-line no-console
        console.error('Failed to update matter details:', message);
        return { ok: false, error: message };
      }
    },
    [],
  );

  const archive = useCallback(async (id: string) => {
    // Snapshot for rollback.
    let removed: Matter | null = null;
    setMatters((prev) => {
      const next = prev.filter((m) => {
        if (m.id === id) {
          removed = m;
          return false;
        }
        return true;
      });
      return next;
    });

    try {
      const result = await archiveMatterAction(id);
      if (!result.ok) throw new Error(result.error);
    } catch (err) {
      // Roll back: put the matter back at its original position.
      // For simplicity we just put it at the front; the next page refresh
      // will sort it correctly.
      if (removed) {
        const matter = removed;
        setMatters((prev) => [matter, ...prev]);
      }
      // eslint-disable-next-line no-console
      console.error('Failed to archive matter:', err);
      throw err;
    }
  }, []);

  const addMatter = useCallback((matter: Matter) => {
    // New matters go to the front (they're the most-recently-updated by
    // definition). Wrap in startTransition so the navigation that follows
    // doesn't block on this state update.
    startTransition(() => {
      setMatters((prev) => [matter, ...prev]);
    });
  }, []);

  const findMatter = useCallback(
    (id: string) => matters.find((m) => m.id === id),
    [matters],
  );

  return (
    <MattersContext.Provider
      value={{
        matters,
        updateStatus,
        updateDetails,
        archive,
        addMatter,
        findMatter,
      }}
    >
      {children}
    </MattersContext.Provider>
  );
}

// =============================================================================
// Hook
// =============================================================================

export function useMatters(): MattersContextValue {
  const ctx = useContext(MattersContext);
  if (!ctx) {
    throw new Error('useMatters must be used inside <MattersProvider>.');
  }
  return ctx;
}
