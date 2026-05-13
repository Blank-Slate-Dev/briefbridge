// app/(app)/matters/[id]/_components/files-tab.tsx
//
// The Files tab of the matter detail view.
//
// Replaces the Chunk-5 placeholder stub. Wires together:
//   - AI access panel (Chunk 7) at the top
//   - Header with "+ Upload files" button + QuotaIndicator
//   - Drag-anywhere drop zone covering the tab content
//   - File list (active files + in-flight uploads, newest first)
//   - Undo toast (bottom-anchored)
//   - Empty state when no files
//
// The upload pipeline (per file):
//   1. User selects/drops files
//   2. Client calls requestUploadUrls with the batch
//   3. For each accepted result: addUploadingFile, then uploadToSignedUrl
//      via the browser Supabase client, with progress tracking
//   4. On upload success: call completeUpload action, then markUploadComplete
//   5. For rejected results: addRejectedUpload (red badge appears immediately)
//
// Drag-anywhere: dragover anywhere in the tab content highlights the drop
// zone. Drop accepts the files. This is per the design doc — lawyers
// shouldn't have to aim for a specific button.
//
// CHUNK 7: AiAccessPanel sits at the very top of the tab content,
// before the header. Logic for "is this case AI-accessible" is
// deliberately separate from the upload affordance — the lawyer sets
// the policy once, then uploads files freely below.

'use client';

import {
  useCallback,
  useRef,
  useState,
  type DragEvent,
  type ChangeEvent,
} from 'react';
import { createClient } from '@/lib/supabase/client';
import { ACCEPT_ATTRIBUTE, MAX_FILE_BYTES } from '@/lib/files/types';
import { requestUploadUrls, completeUpload } from '../files/_actions';
import { useFiles } from './files-provider';
import { QuotaIndicator } from './quota-indicator';
import { FileRow, UploadRow } from './file-row';
// CHUNK 7: AI access panel
import { AiAccessPanel } from './ai-access-panel';

const STORAGE_BUCKET = 'case-files';

interface FilesTabProps {
  matterId: string;
  personalTagHistory: string[];
}

export function FilesTab({ matterId, personalTagHistory }: FilesTabProps) {
  const {
    files,
    uploads,
    undo,
    addUploadingFile,
    addRejectedUpload,
    updateUploadProgress,
    markUploadFailed,
    markUploadComplete,
    undoSoftDelete,
    dismissUndo,
  } = useFiles();

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  // Counter approach to avoid the dragenter/dragleave child-element flicker.
  const dragCounterRef = useRef(0);

  // -------------------------------------------------------------------------
  // Upload pipeline
  // -------------------------------------------------------------------------

  const handleFiles = useCallback(
    async (selected: File[]) => {
      if (selected.length === 0) return;

      // Pre-flight: filter out files clearly over the per-file limit so
      // the user gets immediate feedback (the server would reject them
      // too, but this saves a roundtrip + creates a cleaner UX).
      const tooBig = selected.filter((f) => f.size > MAX_FILE_BYTES);
      for (const f of tooBig) {
        addRejectedUpload({
          id: `rejected-${Date.now()}-${Math.random()}`,
          filename: f.name,
          size: f.size,
          progress: 0,
          status: 'rejected',
          rejectionReason: 'file is over the 10 MB per-file limit',
        });
      }
      const eligible = selected.filter((f) => f.size <= MAX_FILE_BYTES);
      if (eligible.length === 0) return;

      // Request signed URLs in one batch.
      const result = await requestUploadUrls({
        matterId,
        files: eligible.map((f) => ({
          filename: f.name,
          size: f.size,
          mimeType: f.type || 'application/octet-stream',
        })),
      });

      if (!result.ok) {
        // Whole batch failed (auth, matter not found, etc.). Mark every
        // eligible file as rejected with the error message.
        for (const f of eligible) {
          addRejectedUpload({
            id: `rejected-${Date.now()}-${Math.random()}`,
            filename: f.name,
            size: f.size,
            progress: 0,
            status: 'rejected',
            rejectionReason: result.error,
          });
        }
        return;
      }

      // Index the original Files by name so we can match results back to
      // their byte sources. If the lawyer dropped two files with the
      // same name in one batch, this is ambiguous — but Supabase paths
      // would conflict on the server side too, so this is a real edge
      // case we don't try to solve gracefully in v1.
      const fileByName = new Map<string, File>();
      for (const f of eligible) {
        fileByName.set(f.name, f);
      }

      const supabase = createClient();

      // Process each per-file result.
      for (const r of result.data.results) {
        if (!r.ok) {
          addRejectedUpload({
            id: `rejected-${Date.now()}-${Math.random()}`,
            filename: r.filename,
            size: 0,
            progress: 0,
            status: 'rejected',
            rejectionReason: r.message,
          });
          continue;
        }

        const sourceFile = fileByName.get(r.filename);
        if (!sourceFile) {
          // Shouldn't happen — server sanitised the name but kept the
          // base. Defensive bailout.
          addRejectedUpload({
            id: r.fileId,
            filename: r.filename,
            size: 0,
            progress: 0,
            status: 'rejected',
            rejectionReason: 'internal: source file lost',
          });
          continue;
        }

        addUploadingFile({
          id: r.fileId,
          filename: r.filename,
          size: sourceFile.size,
          progress: 0,
          status: 'uploading',
        });

        // Fire the actual upload. We don't await here so multiple files
        // upload in parallel.
        void (async () => {
          try {
            const { error } = await supabase.storage
              .from(STORAGE_BUCKET)
              .uploadToSignedUrl(r.storagePath, r.uploadToken, sourceFile, {
                contentType: sourceFile.type || undefined,
                upsert: false,
              });

            if (error) {
              markUploadFailed(r.fileId, error.message);
              return;
            }

            // Set progress to ~95% before the server-side completeUpload
            // call — we don't get real progress events from
            // uploadToSignedUrl in the JS SDK (the XHR progress for the
            // signed PUT isn't exposed). 95% signals "almost done".
            updateUploadProgress(r.fileId, 95);

            const completion = await completeUpload({ fileId: r.fileId });
            if (!completion.ok) {
              markUploadFailed(r.fileId, completion.error);
              return;
            }

            markUploadComplete(r.fileId, completion.data.file);
          } catch (err) {
            const msg = err instanceof Error ? err.message : 'unknown error';
            markUploadFailed(r.fileId, msg);
          }
        })();
      }
    },
    [
      matterId,
      addUploadingFile,
      addRejectedUpload,
      updateUploadProgress,
      markUploadFailed,
      markUploadComplete,
    ],
  );

  // -------------------------------------------------------------------------
  // Drag and drop handlers
  // -------------------------------------------------------------------------

  const onDragEnter = useCallback((e: DragEvent<HTMLDivElement>) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragCounterRef.current += 1;
    setIsDraggingOver(true);
  }, []);

  const onDragLeave = useCallback((e: DragEvent<HTMLDivElement>) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragCounterRef.current -= 1;
    if (dragCounterRef.current <= 0) {
      dragCounterRef.current = 0;
      setIsDraggingOver(false);
    }
  }, []);

  const onDragOver = useCallback((e: DragEvent<HTMLDivElement>) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
  }, []);

  const onDrop = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      dragCounterRef.current = 0;
      setIsDraggingOver(false);
      const dropped = Array.from(e.dataTransfer.files);
      void handleFiles(dropped);
    },
    [handleFiles],
  );

  const onPickerChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const list = e.target.files;
      if (!list) return;
      const selected = Array.from(list);
      // Reset the input so picking the same file again triggers change.
      e.target.value = '';
      void handleFiles(selected);
    },
    [handleFiles],
  );

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  // Show uploads first (newest at top), then files (newest at top).
  // Reversed so the most recently started upload appears at the top
  // of the list rather than bottom.
  const orderedUploads = [...uploads].reverse();

  const isEmpty = files.length === 0 && uploads.length === 0;

  return (
    <div
      className={`bb-files-tab${isDraggingOver ? ' bb-files-tab--dragover' : ''}`}
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      {/*
        CHUNK 7: AI access panel sits at the very top.
        - When AI access is OFF: collapsed single-row panel with "Turn on" button
        - When ON + committed: collapsed summary row with Edit/Turn off
        - When ON + pending (after new upload): amber panel prompting Review
        - When picking: expanded form with mode radios + exclusion list
        Lives inside the FilesProvider (already wrapping this whole tab),
        which feeds it aiAccess state via useFiles().
      */}
      <AiAccessPanel />

      <header className="bb-files-tab__header">
        <div className="bb-files-tab__header-titles">
          <h2 className="bb-files-tab__title">Case files</h2>
          <p className="bb-files-tab__subtitle">
            Drop PDFs, Word documents, or text files anywhere on this tab —
            or use the button to pick from your computer.
          </p>
        </div>
        <div className="bb-files-tab__header-actions">
          <button
            type="button"
            className="bb-button bb-button--primary"
            onClick={() => fileInputRef.current?.click()}
          >
            + Upload files
          </button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept={ACCEPT_ATTRIBUTE}
            onChange={onPickerChange}
            style={{ display: 'none' }}
            aria-hidden
          />
        </div>
      </header>

      <div className="bb-files-tab__quota">
        <QuotaIndicator variant="full" />
      </div>

      {isEmpty ? (
        <div className="bb-files-tab__empty">
          <div className="bb-files-tab__empty-illustration" aria-hidden>
            ◐
          </div>
          <h3 className="bb-files-tab__empty-title">No files yet</h3>
          <p className="bb-files-tab__empty-text">
            Drop pleadings, affidavits, expert reports, or anything else
            relevant to this case. Up to 10 MB per file, 250 MB per case.
          </p>
          <button
            type="button"
            className="bb-button bb-button--primary"
            onClick={() => fileInputRef.current?.click()}
          >
            + Upload files
          </button>
        </div>
      ) : (
        <ul className="bb-files-list">
          {orderedUploads.map((upload) => (
            <li key={upload.id}>
              <UploadRow upload={upload} />
            </li>
          ))}
          {files.map((file) => (
            <li key={file.id}>
              <FileRow file={file} personalTagHistory={personalTagHistory} />
            </li>
          ))}
        </ul>
      )}

      {/* Drop overlay — shows during dragover */}
      {isDraggingOver && (
        <div className="bb-files-tab__dropzone" aria-hidden>
          <div className="bb-files-tab__dropzone-inner">
            <div className="bb-files-tab__dropzone-icon">↓</div>
            <div className="bb-files-tab__dropzone-text">
              Drop files to upload
            </div>
          </div>
        </div>
      )}

      {/* Undo toast */}
      {undo && (
        <div
          className={`bb-files-toast${undo.errorMessage ? ' bb-files-toast--error' : ''}`}
          role="status"
          aria-live="polite"
        >
          <div className="bb-files-toast__body">
            {undo.errorMessage ? (
              <>
                <span className="bb-files-toast__icon" aria-hidden>!</span>
                <span className="bb-files-toast__message">
                  {undo.errorMessage}
                </span>
              </>
            ) : (
              <>
                <span className="bb-files-toast__message">
                  Deleted <strong>{undo.filename}</strong>
                </span>
                <button
                  type="button"
                  className="bb-files-toast__action"
                  onClick={() => void undoSoftDelete()}
                  disabled={undo.isRestoring}
                >
                  {undo.isRestoring ? 'Restoring…' : 'Undo'}
                </button>
              </>
            )}
            <button
              type="button"
              className="bb-files-toast__dismiss"
              onClick={dismissUndo}
              aria-label="Dismiss"
            >
              ×
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Returns true if the drag event carries actual files (not just text
 * selection or other browser-internal drag content). Avoids the drop
 * zone activating when a lawyer drags text from one part of the page
 * to another.
 */
function hasFiles(e: DragEvent<HTMLDivElement>): boolean {
  const types = e.dataTransfer.types;
  if (!types) return false;
  // `types` is a DOMStringList in some browsers, array in others.
  for (let i = 0; i < types.length; i++) {
    if (types[i] === 'Files') return true;
  }
  return false;
}
