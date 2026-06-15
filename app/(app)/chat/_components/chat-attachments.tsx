// app/(app)/chat/_components/chat-attachments.tsx
//
// Standalone-chat file attachment UI + upload pipeline (migration 0009).
//
// Owns ALL the upload state and logic for standalone /chat, kept OUT of the
// shared StreamingChat component (which is also used by matter chat and must
// stay untouched). ChatClient renders this and passes its output down to
// StreamingChat via TWO slots:
//
//   - variant="button" -> the paperclip button. Rendered INSIDE the input
//     row (attachSlot), left of the textarea.
//   - variant="chips"  -> the attached-file CARDS. Rendered INSIDE the
//     composer box (attachChipsSlot), ABOVE the input row, so the composer
//     grows vertically to contain them — one unified surface, like
//     Claude/ChatGPT. (Despite the historical "chips" name, these now render
//     as small rectangular file cards.)
//
// Both variants share the SAME lifted state (attachments + setAttachments,
// owned by ChatClient), so the button's uploads drive the cards' display.
//
// INSTANT-SKELETON UX: a card is rendered the INSTANT a file is picked —
// BEFORE any server round-trip — using a temporary client id and a 'pending'
// status. This kills the blank gap while ensureConversation +
// requestConversationUploadUrls run. Once the server returns the real fileId,
// the temp card is reconciled: its id swaps to the real fileId and its status
// moves to 'uploading'. The swap is invisible; the skeleton stays put with no
// layout jump.
//
// Status lifecycle for a successful attach:
//   pending (temp id, instant)  ->  uploading (real fileId)  ->  ready (✓)
//
// Pipeline:
//   1. Pick files -> temp 'pending' skeleton cards appear immediately.
//   2. ensureConversation() — mint/confirm a conversation id.
//   3. requestConversationUploadUrls() — batch quota-checked signed URLs;
//      reconcile each temp card to its real fileId (-> 'uploading').
//   4. uploadToSignedUrl() via the browser Supabase client.
//   5. completeConversationUpload() — FAST: confirm object -> 'ready' (✓).
//   6. finalizeConversationFileMeta() — DEFERRED (fire-and-forget): page count
//      + 100-page readability guard, in the background, never blocks the card.
//
// Auto-read: once a file finishes uploading, it's immediately readable by
// Claude in this conversation (no consent toggle — attaching IS consent).

'use client';

import {
  useCallback,
  useRef,
  type ChangeEvent,
} from 'react';
import { createClient } from '@/lib/supabase/client';
import { ACCEPT_ATTRIBUTE, MAX_FILE_BYTES } from '@/lib/files/types';
import {
  ensureConversation,
  requestConversationUploadUrls,
  completeConversationUpload,
  finalizeConversationFileMeta,
} from '../_actions';

const STORAGE_BUCKET = 'case-files';

// =============================================================================
// Attachment item state
// =============================================================================

export interface Attachment {
  id: string; // real fileId once known; a temp 'temp-…' id before that
  filename: string;
  size: number;
  mimeType: string;
  status: 'pending' | 'uploading' | 'ready' | 'rejected' | 'failed';
  reason?: string;
}

interface ChatAttachmentsProps {
  variant?: 'button' | 'chips';
  conversationId: string | null;
  onConversationEnsured: (conversationId: string) => void;
  attachments: Attachment[];
  setAttachments: React.Dispatch<React.SetStateAction<Attachment[]>>;
}

function tempId(): string {
  return `temp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function ChatAttachments({
  variant = 'button',
  conversationId,
  onConversationEnsured,
  attachments,
  setAttachments,
}: ChatAttachmentsProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const markFailed = useCallback(
    (id: string, reason: string) => {
      setAttachments((prev) =>
        prev.map((a) =>
          a.id === id ? { ...a, status: 'failed' as const, reason } : a,
        ),
      );
    },
    [setAttachments],
  );

  const handleFiles = useCallback(
    async (selected: File[]) => {
      if (selected.length === 0) return;

      // STEP 0 — INSTANT skeleton cards (temp ids), before any server work.
      const pendingByTempId = new Map<string, File>();
      const pendingCards: Attachment[] = selected.map((f) => {
        const id = tempId();
        pendingByTempId.set(id, f);
        const tooBig = f.size > MAX_FILE_BYTES;
        return {
          id,
          filename: f.name,
          size: f.size,
          mimeType: f.type || 'application/octet-stream',
          status: tooBig ? ('rejected' as const) : ('pending' as const),
          reason: tooBig ? 'Over the 10 MB per-file limit.' : undefined,
        };
      });
      setAttachments((prev) => [...prev, ...pendingCards]);

      const eligibleEntries = pendingCards.filter(
        (c) => c.status === 'pending',
      );
      if (eligibleEntries.length === 0) return;

      const failTemp = (tempIdValue: string, reason: string) => {
        setAttachments((prev) =>
          prev.map((a) =>
            a.id === tempIdValue
              ? { ...a, status: 'failed' as const, reason }
              : a,
          ),
        );
      };

      try {
        // STEP 1 — ensure a conversation.
        const ensured = await ensureConversation({ conversationId });
        if (!ensured.ok) {
          for (const c of eligibleEntries) failTemp(c.id, ensured.error);
          return;
        }
        const convId = ensured.data.conversationId;
        if (convId !== conversationId) {
          onConversationEnsured(convId);
        }

        // STEP 2 — request signed URLs.
        const result = await requestConversationUploadUrls({
          conversationId: convId,
          files: eligibleEntries.map((c) => ({
            filename: c.filename,
            size: c.size,
            mimeType: c.mimeType,
          })),
        });

        if (!result.ok) {
          for (const c of eligibleEntries) failTemp(c.id, result.error);
          return;
        }

        // Match server results to temp cards by filename (positional for dups).
        const remainingByName = new Map<string, string[]>();
        for (const c of eligibleEntries) {
          const list = remainingByName.get(c.filename) ?? [];
          list.push(c.id);
          remainingByName.set(c.filename, list);
        }
        const takeTempId = (filename: string): string | undefined => {
          const list = remainingByName.get(filename);
          if (!list || list.length === 0) return undefined;
          return list.shift();
        };

        const supabase = createClient();

        for (const r of result.data.results) {
          const matchedTempId = takeTempId(r.filename);

          if (!r.ok) {
            if (matchedTempId) {
              setAttachments((prev) =>
                prev.map((a) =>
                  a.id === matchedTempId
                    ? { ...a, status: 'rejected' as const, reason: r.message }
                    : a,
                ),
              );
            }
            continue;
          }

          const sourceFile = matchedTempId
            ? pendingByTempId.get(matchedTempId)
            : undefined;

          if (!matchedTempId || !sourceFile) {
            if (matchedTempId) {
              failTemp(matchedTempId, 'internal: source file lost');
            }
            continue;
          }

          // RECONCILE: temp id -> real fileId, pending -> uploading.
          setAttachments((prev) =>
            prev.map((a) =>
              a.id === matchedTempId
                ? { ...a, id: r.fileId, status: 'uploading' as const }
                : a,
            ),
          );

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

              // ✓ now; page-count guard runs in the background.
              void finalizeConversationFileMeta({ fileId: r.fileId });

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
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'unknown error';
        for (const c of eligibleEntries) failTemp(c.id, msg);
      }
    },
    [conversationId, onConversationEnsured, setAttachments, markFailed],
  );

  const onPickerChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const list = e.target.files;
      if (!list) return;
      const selected = Array.from(list);
      e.target.value = '';
      void handleFiles(selected);
    },
    [handleFiles],
  );

  const removeChip = useCallback(
    (id: string) => {
      setAttachments((prev) => prev.filter((a) => a.id !== id));
    },
    [setAttachments],
  );

  // ---------------------------------------------------------------------------
  // CHIPS variant — VERTICAL file CARDS (icon on top, filename + type stacked
  // below), rendered INSIDE the composer box above the input row. Like the
  // Claude/ChatGPT attachment preview. Skeleton bars while loading; the loaded
  // card itself is the "ready" signal (no separate ✓). Remove ✕ floats at the
  // top-right corner. Renders nothing when empty.
  // ---------------------------------------------------------------------------
  if (variant === 'chips') {
    if (attachments.length === 0) return null;
    return (
      <ul className="bb-chat-cards">
        {attachments.map((a) => {
          const isLoading = a.status === 'pending' || a.status === 'uploading';
          const isError = a.status === 'rejected' || a.status === 'failed';
          const typeLabel = fileTypeLabel(a.mimeType);
          return (
            <li
              key={a.id}
              className={`bb-chat-card bb-chat-card--${a.status}`}
              title={a.reason ?? a.filename}
            >
              <button
                type="button"
                className="bb-chat-card-remove"
                onClick={() => removeChip(a.id)}
                aria-label={`Remove ${a.filename}`}
              >
                ×
              </button>

              <span className="bb-chat-card-icon" aria-hidden>
                <FileTypeGlyph mimeType={a.mimeType} />
              </span>

              <div className="bb-chat-card-body">
                {isLoading ? (
                  <>
                    <span className="bb-chat-card-skel bb-chat-card-skel--name" />
                    <span className="bb-chat-card-skel bb-chat-card-skel--meta" />
                  </>
                ) : (
                  <>
                    <span className="bb-chat-card-name">{a.filename}</span>
                    <span className="bb-chat-card-meta">
                      {isError ? (
                        <span className="bb-chat-card-err">
                          {a.reason ?? 'failed'}
                        </span>
                      ) : (
                        typeLabel
                      )}
                    </span>
                  </>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    );
  }

  // ---------------------------------------------------------------------------
  // BUTTON variant (default) — paperclip + hidden file input. Lives inside
  // the input row.
  // ---------------------------------------------------------------------------
  return (
    <div className="bb-chat-attach">
      <button
        type="button"
        className="bb-chat-attach-btn"
        onClick={() => fileInputRef.current?.click()}
        aria-label="Attach a file"
        title="Attach a PDF, Word document, or text file"
      >
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
    </div>
  );
}

// =============================================================================
// Helpers
// =============================================================================

function fileTypeLabel(mimeType: string): string {
  if (mimeType === 'application/pdf') return 'PDF';
  if (mimeType.includes('word') || mimeType.includes('officedocument'))
    return 'Word';
  if (mimeType === 'text/plain') return 'Text';
  return 'File';
}

function FileTypeGlyph({ mimeType }: { mimeType: string }) {
  const kind =
    mimeType === 'application/pdf'
      ? 'pdf'
      : mimeType.includes('word') || mimeType.includes('officedocument')
        ? 'doc'
        : 'txt';

  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
      className={`bb-chat-card-glyph bb-chat-card-glyph--${kind}`}
    >
      <path
        d="M6 2.5h7L19 8v12.5a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V3.5a1 1 0 0 1 1-1Z"
        fill="currentColor"
        opacity="0.16"
      />
      <path
        d="M6 2.5h7L19 8v12.5a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V3.5a1 1 0 0 1 1-1Z"
        stroke="currentColor"
        strokeWidth="1.4"
      />
      <path d="M13 2.5V8h6" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}