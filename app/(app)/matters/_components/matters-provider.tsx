// app/(app)/matters/_components/matters-provider.tsx
//
// Client-side state for the matters list, used so the matter cards, the
// matter detail page, AND the sidebar can all read from the same source
// and reflect status changes live.
//
// Why a Context (not a Zustand store, not a server action):
//   - All consumers are inside the (app) layout, so wrapping there is clean
//   - We don't yet have a database. Once auth + matters table land, this
//     provider stays — it just gets seeded from a server query and
//     updateStatus() becomes a server action call instead of an in-memory
//     update.
//   - For the current session-only persistence model, in-memory state is
//     exactly the right granularity.

'use client';

import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from 'react';
import {
  MOCK_MATTERS,
  type MatterStatus,
  type MockMatter,
} from '../_data/mock-matters';

// =============================================================================
// Context shape
// =============================================================================

interface MattersContextValue {
  matters: MockMatter[];
  /** Update a matter's status. UI-only; resets on refresh until DB lands. */
  updateStatus: (id: string, status: MatterStatus) => void;
  /** Convenience: find a matter by id from the current state. */
  findMatter: (id: string) => MockMatter | undefined;
}

const MattersContext = createContext<MattersContextValue | null>(null);

// =============================================================================
// Provider
// =============================================================================

export function MattersProvider({ children }: { children: ReactNode }) {
  const [matters, setMatters] = useState<MockMatter[]>(MOCK_MATTERS);

  const updateStatus = useCallback((id: string, status: MatterStatus) => {
    setMatters((prev) =>
      prev.map((m) => (m.id === id ? { ...m, status } : m)),
    );
  }, []);

  const findMatter = useCallback(
    (id: string) => matters.find((m) => m.id === id),
    [matters],
  );

  return (
    <MattersContext.Provider value={{ matters, updateStatus, findMatter }}>
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
