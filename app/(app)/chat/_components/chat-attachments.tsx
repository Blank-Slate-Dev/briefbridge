// app/(app)/chat/_components/chat-attachments.tsx
//
// Standalone-chat file attachment UI + upload pipeline (migration 0009).
//
// Owns ALL the upload state and logic for standalone /chat, kept OUT of the
// shared StreamingChat component (which is also used by matter chat and must
// stay untouched). ChatClient renders this and passes its output down to
// StreamingChat via the `attachSlot` prop.
//
// The upload pipeline mirrors the matter Files tab (files-tab.tsx) exactly,
// so behaviour is identical and proven:
//
//   1. User picks files via the attach button.
//   2. ensureConversation() — mint/confirm a conversation id so files have
//      something to attach to (a brand-new /chat has no conversation until
//      the first message; we create it eagerly on first attach).
//   3. requestConversationUploadUrls() — batch quota-checked signed URLs.
//   4. For each accepted result: uploadToSignedUrl() via the browser
//      Supabase client (same bucket, same call as the matter tab).
//   5. completeConversationUpload() — confirm + page count + readability.
//
// Auto-read: once a file finishes uploading, it's immediately readable by
// Claude in this conversation (no consent toggle — attaching IS consent).
//
// State shape: a flat list of attachment items, each with a status
// (uploading | ready | rejected | failed). The chips render from this list.

'use client';

import {
  useCallback,
  useRef,
  useState,
  type ChangeEvent,
} from 'react';
import { createClient } from '@/lib/supabase/client';
import { ACCEPT_ATTRIBUTE, MAX_FILE_BYTES } from '@/lib/files/types';
import {
  ensureConversation,
  requestConversationUploadUrls,
  completeConversationUpload,
} from '../_actions';

// Same bucket as the matter tab — standalone files live in the same
// private bucket, just under a different path prefix (see
// buildConversationStoragePath).
const STORAGE_BUCKET = 'case-files';

// =============================================================================
// Attachment item state
// =============================================================================

export interface Attachment {
  id: string; // fileId once known, else a temp id for rejects
  filename: string;
  size: number;
  status: 'uploading' | 'ready' | 'rejected' | 'failed';
  // Present when status is 'rejected' or 'failed'.
  reason?: string;
}

interface ChatAttachmentsProps {
  /**
   * The current conversation id, or null for a brand-new chat. If null, the
   * first attach will mint one via ensureConversation and report it back
   * through onConversationEnsured so the parent can bind subsequent sends
   * to the same conversation.
   */
  conversationId: string | null;
  /**
   * Called when a conversation id is established (either confirmed or newly
   * created). The parent (ChatClient) updates its own id + the URL so the
   * eventual first message lands in the same conversation the files are in.
   */
  onConversationEnsured: (conversationId: string) => void;
  /** The attachment list (lifted to the parent so it can survive re-render). */
  attachments: Attachment[];
  /** Setter for the attachment list. */
  setAttachments: React.Dispatch<React.SetStateAction<Attachment[]>>;
}

export function ChatAttachments({
  conversationId,
  onConversationEnsured,
  attachments,
  setAttachments,
}: ChatAttachmentsProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isBusy, setIsBusy] = useState(false);

  const handleFiles = useCallback(
    async (selected: File[]) => {
      if (selected.length === 0) return;
      setIsBusy(true);

      try {
        // Pre-flight: reject oversize files immediately (server would too).
        const tooBig = selected.filter((f) => f.size > MAX_FILE_BYTES);
        for (const f of tooBig) {
          setAttachments((prev) => [
            ...prev,
            {
              id: `rejected-${Date.now()}-${Math.random()}`,
              filename: f.name,
              size: f.size,
              status: 'rejected',
              reason: 'Over the 10 MB per-file limit.',
            },
          ]);
        }
        const eligible = selected.filter((f) => f.size <= MAX_FILE_BYTES);
        if (eligible.length === 0) return;

        // Ensure we have a conversation to attach to.
        const ensured = await ensureConversation({ conversationId });
        if (!ensured.ok) {
          for (const f of eligible) {
            setAttachments((prev) => [
              ...prev,
              {
                id: `failed-${Date.now()}-${Math.random()}`,
                filename: f.name,
                size: f.size,
                status: 'failed',
                reason: ensured.error,
              },
            ]);
          }
          return;
        }
        const convId = ensured.data.conversationId;
        // Tell the parent (updates its id + URL) if this is new.
        if (convId !== conversationId) {
          onConversationEnsured(convId);
        }

        // Request signed URLs in one batch.
        const result = await requestConversationUploadUrls({
          conversationId: convId,
          files: eligible.map((f) => ({
            filename: f.name,
            size: f.size,
            mimeType: f.type || 'application/octet-stream',
          })),
        });

        if (!result.ok) {
          for (const f of eligible) {
            setAttachments((prev) => [
              ...prev,
              {
                id: `failed-${Date.now()}-${Math.random()}`,
                filename: f.name,
                size: f.size,
                status: 'failed',
                reason: result.error,
              },
            ]);
          }
          return;
        }

        // Match results back to their byte sources by name.
        const fileByName = new Map<string, File>();
        for (const f of eligible) fileByName.set(f.name, f);

        const supabase = createClient();

        for (const r of result.data.results) {
          if (!r.ok) {
            setAttachments((prev) => [
              ...prev,
              {
                id: `rejected-${Date.now()}-${Math.random()}`,
                filename: r.filename,
                size: 0,
                status: 'rejected',
                reason: r.message,
              },
            ]);
            continue;
          }

          const sourceFile = fileByName.get(r.filename);
          if (!sourceFile) {
            setAttachments((prev) => [
              ...prev,
              {
                id: r.fileId,
                filename: r.filename,
                size: 0,
                status: 'failed',
                reason: 'internal: source file lost',
              },
            ]);
            continue;
          }

          // Add the uploading chip.
          setAttachments((prev) => [
            ...prev,
            {
              id: r.fileId,
              filename: r.filename,
              size: sourceFile.size,
              status: 'uploading',
            },
          ]);

          // Fire the upload (parallel — don't await the IIFE).
          void (async () => {
            try {
              const { error } = await supabase.storage
                .from(STORAGE_BUCKET)
                .uploadToSignedUrl(r.storagePath, r.uploadToken, sourceFile, {
                  contentType: sourceFile.type || undefined,
                  upsert: false,
                });

              if (error) {
                markFailed(r.fileId, error.message);
                return;
              }

              const completion = await completeConversationUpload({
                fileId: r.fileId,
              });
              if (!completion.ok) {
                markFailed(r.fileId, completion.error);
                return;
              }

              setAttachments((prev) =>
                prev.map((a) =>
                  a.id === r.fileId ? { ...a, status: 'ready' as const } : a,
                ),
              );
            } catch (err) {
              const msg =
                err instanceof Error ? err.message : 'unknown error';
              markFailed(r.fileId, msg);
            }
          })();
        }
      } finally {
        setIsBusy(false);
      }
    },
    [conversationId, onConversationEnsured, setAttachments],
  );

  const markFailed = useCallback(
    (fileId: string, reason: string) => {
      setAttachments((prev) =>
        prev.map((a) =>
          a.id === fileId ? { ...a, status: 'failed' as const, reason } : a,
        ),
      );
    },
    [setAttachments],
  );

  const onPickerChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const list = e.target.files;
      if (!list) return;
      const selected = Array.from(list);
      e.target.value = ''; // reset so same file re-triggers change
      void handleFiles(selected);
    },
    [handleFiles],
  );

  const removeChip = useCallback(
    (id: string) => {
      // Removes the chip from the visible list only. We deliberately do NOT
      // delete the uploaded file from storage/db here — a "ready" file stays
      // attached to the conversation and readable by Claude. Removing the
      // chip just tidies the input. (A future pass could add real detach via
      // a softDelete on the conversation file.)
      setAttachments((prev) => prev.filter((a) => a.id !== id));
    },
    [setAttachments],
  );

  return (
    <div className="bb-chat-attach">
      <button
        type="button"
        className="bb-chat-attach-btn"
        onClick={() => fileInputRef.current?.click()}
        disabled={isBusy}
        aria-label="Attach a file"
        title="Attach a PDF, Word document, or text file"
      >
        {/* paperclip glyph */}
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
        </svg>
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

      {attachments.length > 0 && (
        <ul className="bb-chat-attach-list">
          {attachments.map((a) => (
            <li
              key={a.id}
              className={`bb-chat-chip bb-chat-chip--${a.status}`}
              title={a.reason ?? a.filename}
            >
              <span className="bb-chat-chip-name">{a.filename}</span>
              <span className="bb-chat-chip-status" aria-hidden>
                {a.status === 'uploading' && '…'}
                {a.status === 'ready' && '✓'}
                {(a.status === 'rejected' || a.status === 'failed') && '!'}
              </span>
              <button
                type="button"
                className="bb-chat-chip-remove"
                onClick={() => removeChip(a.id)}
                aria-label={`Remove ${a.filename}`}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}