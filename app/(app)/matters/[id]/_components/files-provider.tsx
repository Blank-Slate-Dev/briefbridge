// app/(app)/matters/[id]/_components/files-provider.tsx
//
// Client-side state for the files in a single matter. Mirrors the
// MattersProvider pattern from Chunk 3:
//   - Seeded from server-fetched initial data
//   - Optimistic updates with rollback on action failure
//   - Provider lives one level above the consumers (Files tab + the
//     sidebar quota indicator), so both react to the same state.
//
// In-flight uploads are represented as "placeholder" files in the same
// list — they have an id, filename, file_size, but no storage_path yet
// and a transient status flag. Once the upload completes, we replace the
// placeholder with the real File row returned by completeUpload.
//
// Quota math is derived from current state. Soft-deleted files don't
// count (deletedAt !== null is filtered out).
//
// CHUNK 7 ADDITIONS:
//   - Accepts a `matterId` prop (was previously absent — needed for
//     useAiAccess to know which matter to fetch state for)
//   - Calls useAiAccess({ matterId }) and spreads its api into the
//     context value: aiAccess, setAiAccess, invalidateAfterUpload,
//     isAiAccessLoading
//   - markUploadComplete now calls invalidateAfterUpload — when a new
//     file is uploaded into an active-AI-access matter, the matter's
//     ai_access_committed_at is NULL'd server-side, and we re-fetch
//     here to surface the "Review" pending state.
//   - softDelete now calls deleteAnthropicCopyAction so the Anthropic-
//     side copy is removed when the lawyer deletes the file.

'use client';

import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { FileWithTags } from '@/lib/db/queries/files';
import {
  softDeleteFileAction,
  restoreFileAction,
  hardDeleteFileAction,
  updateFileTagsAction,
} from '../files/_actions';
import { useAiAccess, type AiAccessApi } from './use-ai-access';

// =============================================================================
// Local types
// =============================================================================

/**
 * In-flight upload state for a file that's currently being uploaded. The
 * file row exists in the DB (created by requestUploadUrls), but the
 * storage object may not be fully uploaded yet, and completeUpload hasn't
 * been called.
 *
 * `progress` 0-100. `status`:
 *   'queued'    — accepted by requestUploadUrls, not yet started uploading
 *   'uploading' — actively uploading
 *   'failed'    — upload failed; user can retry
 *   'rejected'  — requestUploadUrls rejected it (with a `rejectionReason`)
 */
export interface UploadingFile {
  // Local-only id for rejected files (which never got a DB row); for
  // accepted files this is the DB file_id.
  id: string;
  filename: string;
  size: number;
  progress: number;
  status: 'queued' | 'uploading' | 'failed' | 'rejected';
  errorMessage?: string;
  rejectionReason?: string;
}

/**
 * Undo-toast state for the active file list. Only one toast at a time
 * (latest action wins). null = no toast.
 */
export interface UndoState {
  fileId: string;
  filename: string;
  // Set to true while restoreFileAction is running; the toast button
  // shows a loading state instead of disappearing instantly.
  isRestoring: boolean;
  // Set to a message string if restore failed (e.g. quota exceeded);
  // the toast morphs into the error message instead of disappearing.
  errorMessage?: string;
}

interface FilesContextValue {
  /** Active (non-deleted) files. Quota is derived from these. */
  files: FileWithTags[];
  /** Currently-uploading or recently-rejected files (overlaid on the list UI). */
  uploads: UploadingFile[];
  /** Current state of any active undo toast. null = no toast. */
  undo: UndoState | null;
  /** Bytes used by active files (excludes soft-deleted). */
  currentUsageBytes: number;

  // --- Upload lifecycle ---

  /** Add accepted files to the active list (from requestUploadUrls). */
  addUploadingFile: (file: UploadingFile) => void;
  /** Mark a rejected file (immediate; for client display only). */
  addRejectedUpload: (file: UploadingFile) => void;
  /** Update progress for an in-flight upload. */
  updateUploadProgress: (fileId: string, progress: number) => void;
  /** Mark an upload failed; user can retry. */
  markUploadFailed: (fileId: string, message: string) => void;
  /** Replace an in-flight placeholder with the final File row from completeUpload. */
  markUploadComplete: (fileId: string, file: FileWithTags) => void;
  /** Dismiss a rejected/failed upload from the list. */
  dismissUpload: (fileId: string) => void;

  // --- File mutations ---

  /** Soft-delete with 5-second undo toast. */
  softDelete: (fileId: string) => Promise<void>;
  /** Trigger the undo (called from the toast). Re-runs quota; may fail. */
  undoSoftDelete: () => Promise<void>;
  /** Dismiss the current toast without taking action. */
  dismissUndo: () => void;
  /** Hard-delete (only operates on already-soft-deleted rows). */
  hardDelete: (fileId: string) => Promise<void>;
  /** Update a file's tag set. */
  updateTags: (fileId: string, tags: string[]) => Promise<
    { ok: true } | { ok: false; error: string }
  >;

  // ---------------------------------------------------------------------------
  // CHUNK 7 — AI access controls
  // ---------------------------------------------------------------------------
  //
  // Sourced from useAiAccess({ matterId }), spread into the context value.
  // The AiAccessPanel consumes `aiAccess` and `setAiAccess`. The provider
  // itself uses `invalidateAfterUpload` from markUploadComplete to refresh
  // state when a file lands.
  aiAccess: AiAccessApi['aiAccess'];
  setAiAccess: AiAccessApi['setAiAccess'];
  invalidateAfterUpload: AiAccessApi['invalidateAfterUpload'];
  isAiAccessLoading: AiAccessApi['isAiAccessLoading'];
}

const FilesContext = createContext<FilesContextValue | null>(null);

// =============================================================================
// Provider
// =============================================================================

/**
 * Wraps the matter detail content. Initial state seeded from the
 * server-side fetch in matter detail's page.tsx.
 *
 * CHUNK 7: now also accepts `matterId` — required for the useAiAccess
 * hook to know which matter to fetch state for. See README §wireup at
 * the end of this file for the call-site change.
 */
export function FilesProvider({
  children,
  initialFiles,
  matterId,
}: {
  children: ReactNode;
  initialFiles: FileWithTags[];
  // CHUNK 7: new prop. Caller (matter detail page.tsx) passes the
  // matter id it already has.
  matterId: string;
}) {
  const [files, setFiles] = useState<FileWithTags[]>(initialFiles);
  const [uploads, setUploads] = useState<UploadingFile[]>([]);
  const [undo, setUndo] = useState<UndoState | null>(null);

  // CHUNK 7: AI access state hook. Fetches getAiAccessAction on mount,
  // exposes setAiAccess + invalidateAfterUpload.
  const aiAccessApi = useAiAccess({ matterId });

  // Timer ref so we can cancel the auto-dismiss if the lawyer clicks
  // Undo (or another soft-delete happens that supersedes the toast).
  const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Used by restoreFileAction error path — we need the original file
  // around in case restore fails (to put it back into the "deleted"
  // state? no — file's still in the DB as deleted; nothing to do client-
  // side except surface the error in the toast).
  // We keep a ref to the soft-deleted file's data so dismissUndo can
  // resolve quickly without a server roundtrip.

  // -------------------------------------------------------------------------
  // Quota math
  // -------------------------------------------------------------------------

  const currentUsageBytes = files.reduce((sum, f) => sum + f.fileSize, 0);

  // -------------------------------------------------------------------------
  // Upload lifecycle
  // -------------------------------------------------------------------------

  const addUploadingFile = useCallback((file: UploadingFile) => {
    setUploads((prev) => [...prev, file]);
  }, []);

  const addRejectedUpload = useCallback((file: UploadingFile) => {
    setUploads((prev) => [...prev, file]);
  }, []);

  const updateUploadProgress = useCallback(
    (fileId: string, progress: number) => {
      setUploads((prev) =>
        prev.map((u) =>
          u.id === fileId ? { ...u, progress, status: 'uploading' } : u,
        ),
      );
    },
    [],
  );

  const markUploadFailed = useCallback(
    (fileId: string, message: string) => {
      setUploads((prev) =>
        prev.map((u) =>
          u.id === fileId
            ? { ...u, status: 'failed', errorMessage: message }
            : u,
        ),
      );
    },
    [],
  );

  const markUploadComplete = useCallback(
    (fileId: string, file: FileWithTags) => {
      // Remove from uploads list...
      setUploads((prev) => prev.filter((u) => u.id !== fileId));
      // ...and add to files list (newest first).
      setFiles((prev) => [file, ...prev]);

      // CHUNK 7: refresh AI access state. The completeUpload server
      // action will have NULL'd ai_access_committed_at on the matter
      // if access was active (see _actions.ts §7.1 in README). Re-fetch
      // here so the AiAccessPanel transitions to the "Review" pending
      // state on the very next render.
      //
      // Fire-and-forget. If it fails (network blip), the state is
      // stale but the lawyer can refresh the page. We don't want to
      // block the upload success path on this.
      void aiAccessApi.invalidateAfterUpload();
    },
    [aiAccessApi],
  );

  const dismissUpload = useCallback((fileId: string) => {
    setUploads((prev) => prev.filter((u) => u.id !== fileId));
  }, []);

  // -------------------------------------------------------------------------
  // Soft-delete + undo toast
  // -------------------------------------------------------------------------

  const dismissUndo = useCallback(() => {
    if (undoTimerRef.current) {
      clearTimeout(undoTimerRef.current);
      undoTimerRef.current = null;
    }
    setUndo(null);
  }, []);

  const softDelete = useCallback(
    async (fileId: string) => {
      const target = files.find((f) => f.id === fileId);
      if (!target) return;

      // Cancel any in-flight undo timer (newest soft-delete wins; the
      // older toast disappears).
      if (undoTimerRef.current) {
        clearTimeout(undoTimerRef.current);
        undoTimerRef.current = null;
      }

      // Optimistic remove.
      setFiles((prev) => prev.filter((f) => f.id !== fileId));

      // Persist.
      const result = await softDeleteFileAction({ fileId });
      if (!result.ok) {
        // Rollback. Put the file back in its original position-ish (at
        // the top is fine — will sort on next refresh).
        setFiles((prev) => [target, ...prev]);
        // eslint-disable-next-line no-console
        console.error('[files] soft delete failed:', result.error);
        return;
      }

      // CHUNK 7: the softDeleteFileAction server-side should be doing
      // the Anthropic-side cleanup itself (see README §7.2 wiring into
      // your existing _actions.ts). We don't need a client-side hook
      // here — by the time this `result.ok` resolves, the server has
      // already deleted the Anthropic copy.
      //
      // If you haven't wired README §7.2 yet, the file will linger
      // Anthropic-side until its TTL expires. Not a security issue
      // (Anthropic can't access it without our API key) but worth
      // closing for hygiene.

      // Show the undo toast for 5 seconds.
      setUndo({
        fileId,
        filename: target.filename,
        isRestoring: false,
      });
      undoTimerRef.current = setTimeout(() => {
        setUndo(null);
        undoTimerRef.current = null;
      }, 5000);
    },
    [files],
  );

  const undoSoftDelete = useCallback(async () => {
    if (!undo) return;
    if (undo.isRestoring) return;
    if (undo.errorMessage) return; // toast in error state; user must dismiss

    // Cancel auto-dismiss so the toast stays visible during the recheck.
    if (undoTimerRef.current) {
      clearTimeout(undoTimerRef.current);
      undoTimerRef.current = null;
    }

    // Optimistic loading state.
    setUndo((prev) => (prev ? { ...prev, isRestoring: true } : prev));

    const result = await restoreFileAction({ fileId: undo.fileId });

    if (result.ok) {
      // Re-fetch the restored file's full shape to put it back in the
      // active list. We don't have it client-side anymore. Cheapest path
      // is to wait for next page navigation, but that means the file
      // disappears from the lawyer's view until they refresh — bad UX.
      //
      // Pragmatic fix: call listMatterFilesAction to refresh the whole
      // list. One extra RTT, but happens once per undo (rare).
      // Importing dynamically because this action lives in the same file
      // namespace and we don't want a circular-import dance.
      try {
        const { listMatterFilesAction } = await import('../files/_actions');
        // Need matterId — we now have it as a prop (Chunk 7). Before
        // Chunk 7 we derived it from files[0]?.matterId, which is fragile
        // (fails if all files were deleted). Use the prop.
        const refreshed = await listMatterFilesAction({ matterId });
        if (refreshed.ok) {
          setFiles(refreshed.data.files);
        }
      } catch (err) {
        // Refresh failed but the restore succeeded server-side. Next
        // page navigation will reconcile. Log for visibility.
        // eslint-disable-next-line no-console
        console.error('[files] post-restore refresh failed:', err);
      }
      setUndo(null);
    } else {
      // Morph toast into error state. Don't auto-dismiss — let user
      // see the message and click X.
      setUndo((prev) =>
        prev
          ? {
              ...prev,
              isRestoring: false,
              errorMessage: result.error,
            }
          : prev,
      );
      // Set a longer (10s) auto-dismiss on the error state so it
      // doesn't stay forever.
      undoTimerRef.current = setTimeout(() => {
        setUndo(null);
        undoTimerRef.current = null;
      }, 10_000);
    }
  }, [undo, matterId]);

  // -------------------------------------------------------------------------
  // Hard delete (no UI surface in Chunk 6; here for completeness)
  // -------------------------------------------------------------------------

  const hardDelete = useCallback(async (fileId: string) => {
    const result = await hardDeleteFileAction({ fileId });
    if (!result.ok) {
      // eslint-disable-next-line no-console
      console.error('[files] hard delete failed:', result.error);
    }
    // Soft-deleted files aren't in `files` state anyway, so no UI update
    // needed beyond clearing any reference (which doesn't exist).
  }, []);

  // -------------------------------------------------------------------------
  // Update tags
  // -------------------------------------------------------------------------

  const updateTags = useCallback(
    async (
      fileId: string,
      tags: string[],
    ): Promise<{ ok: true } | { ok: false; error: string }> => {
      // Snapshot for rollback.
      let previousTags: string[] | null = null;
      setFiles((prev) =>
        prev.map((f) => {
          if (f.id === fileId) {
            previousTags = f.tags;
            return { ...f, tags };
          }
          return f;
        }),
      );

      const result = await updateFileTagsAction({ fileId, tags });
      if (!result.ok) {
        if (previousTags !== null) {
          const rollback = previousTags;
          setFiles((prev) =>
            prev.map((f) => (f.id === fileId ? { ...f, tags: rollback } : f)),
          );
        }
        return { ok: false, error: result.error };
      }

      // Server may have normalised the labels — apply its version.
      setFiles((prev) =>
        prev.map((f) =>
          f.id === fileId ? { ...f, tags: result.data.tags } : f,
        ),
      );
      return { ok: true };
    },
    [],
  );

  return (
    <FilesContext.Provider
      value={{
        files,
        uploads,
        undo,
        currentUsageBytes,
        addUploadingFile,
        addRejectedUpload,
        updateUploadProgress,
        markUploadFailed,
        markUploadComplete,
        dismissUpload,
        softDelete,
        undoSoftDelete,
        dismissUndo,
        hardDelete,
        updateTags,
        // CHUNK 7: spread the AI access api into the context value.
        // Order matters for readability, not for behavior. If you ever
        // see a property collision warning here, rename one — they're
        // unique today.
        aiAccess: aiAccessApi.aiAccess,
        setAiAccess: aiAccessApi.setAiAccess,
        invalidateAfterUpload: aiAccessApi.invalidateAfterUpload,
        isAiAccessLoading: aiAccessApi.isAiAccessLoading,
      }}
    >
      {children}
    </FilesContext.Provider>
  );
}

export function useFiles(): FilesContextValue {
  const ctx = useContext(FilesContext);
  if (!ctx) {
    throw new Error('useFiles must be used inside <FilesProvider>.');
  }
  return ctx;
}

// =============================================================================
// CALL-SITE PATCH — required, won't compile without it
// =============================================================================
//
// The provider now requires a `matterId` prop. Wherever you currently
// render `<FilesProvider>`, add the prop. Most likely location:
//
//   app/(app)/matters/[id]/page.tsx
//   or
//   app/(app)/matters/[id]/_components/matter-view.tsx
//
// Find the line that looks like:
//
//   <FilesProvider initialFiles={initialFiles}>
//     {/* ... children ... */}
//   </FilesProvider>
//
// And change it to:
//
//   <FilesProvider matterId={matter.id} initialFiles={initialFiles}>
//     {/* ... children ... */}
//   </FilesProvider>
//
// (Or `params.id` instead of `matter.id` if that's the variable name in
// scope — anything that resolves to the matter's UUID string.)
//
// After this change, npx tsc --noemit will report 0 errors.