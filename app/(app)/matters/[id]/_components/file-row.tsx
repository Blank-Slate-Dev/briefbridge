// app/(app)/matters/[id]/_components/file-row.tsx
//
// One row in the file list. Three modes:
//
//   - active file: filename, MIME badge, size, AI-readable amber badge
//     (if applicable), tag chips, kebab menu
//   - in-flight upload: filename, progress bar, percentage
//   - rejected/failed upload: filename, red badge with reason, dismiss X
//
// Tag editing happens inline — clicking a chip or "+ tag" enters edit
// mode for that row, no modal. The input handles autocomplete via the
// AU tag suggestions.

'use client';

import { useEffect, useRef, useState } from 'react';
import type { FileWithTags } from '@/lib/db/queries/files';
import { MIME_TYPE_DISPLAY } from '@/lib/files/types';
import { getSuggestions } from '@/lib/files/au-tag-suggestions';
import { useFiles, type UploadingFile } from './files-provider';
import { getDownloadUrlAction } from '../files/_actions';

// =============================================================================
// Active file row
// =============================================================================

export function FileRow({
  file,
  personalTagHistory,
}: {
  file: FileWithTags;
  // The user's personal tag history (DISTINCT tag_label from file_tags)
  // — passed in from the page-level fetch so we don't query per-row.
  personalTagHistory: string[];
}) {
  const { softDelete, updateTags } = useFiles();
  const [editing, setEditing] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  const handleDownload = async () => {
    setMenuOpen(false);
    const result = await getDownloadUrlAction({ fileId: file.id });
    if (!result.ok) {
      // eslint-disable-next-line no-console
      console.error('[files] download failed:', result.error);
      // Surfacing to the user via a transient inline error would be nicer;
      // for v1 we log and leave the row unchanged. Lawyers can retry.
      return;
    }
    // Trigger download via hidden anchor so the browser respects the
    // Content-Disposition header (set in createSignedUrl).
    const a = document.createElement('a');
    a.href = result.data.url;
    a.download = result.data.filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const handleDelete = () => {
    setMenuOpen(false);
    void softDelete(file.id);
  };

  const mimeDisplay =
    (MIME_TYPE_DISPLAY as Record<string, string>)[file.mimeType] ?? 'File';

  return (
    <div className="bb-files-row" data-file-id={file.id}>
      <div className="bb-files-row__main">
        <div className="bb-files-row__title-line">
          <span className="bb-files-row__filename" title={file.filename}>
            {file.filename}
          </span>
          <span className="bb-files-row__mime">{mimeDisplay}</span>
          <span className="bb-files-row__size">{formatBytes(file.fileSize)}</span>
          {!file.aiReadable && file.aiReadableReason && (
            <span
              className="bb-files-row__badge bb-files-row__badge--amber"
              title={file.aiReadableReason}
            >
              AI can't read
            </span>
          )}
        </div>

        {editing ? (
          <TagEditor
            currentTags={file.tags}
            personalHistory={personalTagHistory}
            onCancel={() => setEditing(false)}
            onSave={async (newTags) => {
              const result = await updateTags(file.id, newTags);
              if (result.ok) {
                setEditing(false);
              }
              // On failure, keep editor open so user can see what they
              // were trying to do. updateTags rolls back optimistically.
            }}
          />
        ) : (
          <TagChips
            tags={file.tags}
            onEdit={() => setEditing(true)}
          />
        )}
      </div>

      <div className="bb-files-row__actions">
        <button
          type="button"
          className="bb-files-row__kebab"
          aria-label={`Actions for ${file.filename}`}
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((v) => !v)}
        >
          ⋯
        </button>
        {menuOpen && (
          <KebabMenu
            onClose={() => setMenuOpen(false)}
            onEditTags={() => {
              setMenuOpen(false);
              setEditing(true);
            }}
            onDownload={handleDownload}
            onDelete={handleDelete}
          />
        )}
      </div>
    </div>
  );
}

// =============================================================================
// Tag chips (display mode)
// =============================================================================

function TagChips({
  tags,
  onEdit,
}: {
  tags: string[];
  onEdit: () => void;
}) {
  return (
    <div className="bb-files-row__tags">
      {tags.length === 0 ? (
        <button
          type="button"
          className="bb-files-row__tag-add"
          onClick={onEdit}
        >
          + add tags
        </button>
      ) : (
        <>
          {tags.map((tag) => (
            <button
              key={tag}
              type="button"
              className="bb-files-row__tag"
              onClick={onEdit}
            >
              {tag}
            </button>
          ))}
          <button
            type="button"
            className="bb-files-row__tag-add bb-files-row__tag-add--inline"
            onClick={onEdit}
            aria-label="Edit tags"
          >
            +
          </button>
        </>
      )}
    </div>
  );
}

// =============================================================================
// Tag editor (edit mode)
// =============================================================================

function TagEditor({
  currentTags,
  personalHistory,
  onCancel,
  onSave,
}: {
  currentTags: string[];
  personalHistory: string[];
  onCancel: () => void;
  onSave: (tags: string[]) => void | Promise<void>;
}) {
  const [tags, setTags] = useState<string[]>(currentTags);
  const [input, setInput] = useState('');
  const [highlighted, setHighlighted] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus the input on mount so the lawyer can start typing immediately.
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const suggestions = getSuggestions(input, tags, personalHistory);

  const commitTag = (label: string) => {
    const trimmed = label.trim();
    if (!trimmed) return;
    // Dedupe case-insensitively.
    const lower = trimmed.toLowerCase();
    if (tags.some((t) => t.toLowerCase() === lower)) {
      setInput('');
      setHighlighted(-1);
      return;
    }
    if (tags.length >= 10) return;
    setTags([...tags, trimmed]);
    setInput('');
    setHighlighted(-1);
  };

  const removeTag = (tag: string) => {
    setTags(tags.filter((t) => t !== tag));
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (highlighted >= 0 && highlighted < suggestions.length) {
        commitTag(suggestions[highlighted]);
      } else if (input.trim()) {
        commitTag(input);
      } else {
        // Empty + Enter = save the whole set.
        void onSave(tags);
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onCancel();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlighted((h) => Math.min(suggestions.length - 1, h + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlighted((h) => Math.max(-1, h - 1));
    } else if (e.key === 'Backspace' && input === '' && tags.length > 0) {
      // Backspace on empty input removes the last tag — standard chip-input UX.
      setTags(tags.slice(0, -1));
    } else if (e.key === ',' || e.key === 'Tab') {
      if (input.trim()) {
        e.preventDefault();
        commitTag(input);
      }
    }
  };

  return (
    <div className="bb-files-row__tag-editor">
      <div className="bb-files-row__tag-editor-chips">
        {tags.map((tag) => (
          <span key={tag} className="bb-files-row__tag bb-files-row__tag--editing">
            {tag}
            <button
              type="button"
              className="bb-files-row__tag-remove"
              onClick={() => removeTag(tag)}
              aria-label={`Remove tag ${tag}`}
            >
              ×
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          type="text"
          className="bb-files-row__tag-input"
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            setHighlighted(-1);
          }}
          onKeyDown={handleKeyDown}
          placeholder={tags.length === 0 ? 'Type a tag…' : ''}
          maxLength={30}
          aria-label="Add a tag"
        />
      </div>
      {suggestions.length > 0 && (
        <div className="bb-files-row__tag-suggestions" role="listbox">
          {suggestions.map((s, idx) => (
            <button
              key={s}
              type="button"
              role="option"
              aria-selected={idx === highlighted}
              className={`bb-files-row__tag-suggestion${idx === highlighted ? ' bb-files-row__tag-suggestion--active' : ''}`}
              onMouseEnter={() => setHighlighted(idx)}
              onClick={() => commitTag(s)}
            >
              {s}
            </button>
          ))}
        </div>
      )}
      <div className="bb-files-row__tag-editor-actions">
        <button
          type="button"
          className="bb-button bb-button--ghost"
          onClick={onCancel}
        >
          Cancel
        </button>
        <button
          type="button"
          className="bb-button bb-button--primary"
          onClick={() => {
            // If the user has typed something but not committed it, commit
            // first then save.
            if (input.trim()) {
              const trimmed = input.trim();
              const lower = trimmed.toLowerCase();
              const newSet = tags.some((t) => t.toLowerCase() === lower)
                ? tags
                : tags.length < 10
                  ? [...tags, trimmed]
                  : tags;
              void onSave(newSet);
            } else {
              void onSave(tags);
            }
          }}
        >
          Save
        </button>
      </div>
    </div>
  );
}

// =============================================================================
// Kebab menu
// =============================================================================

function KebabMenu({
  onClose,
  onEditTags,
  onDownload,
  onDelete,
}: {
  onClose: () => void;
  onEditTags: () => void;
  onDownload: () => void;
  onDelete: () => void;
}) {
  // Close on outside click + Escape.
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const keyHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', handler);
    document.addEventListener('keydown', keyHandler);
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('keydown', keyHandler);
    };
  }, [onClose]);

  return (
    <div ref={ref} className="bb-files-row__menu" role="menu">
      <button
        type="button"
        role="menuitem"
        className="bb-files-row__menu-item"
        onClick={onEditTags}
      >
        Edit tags
      </button>
      <button
        type="button"
        role="menuitem"
        className="bb-files-row__menu-item"
        onClick={onDownload}
      >
        Download
      </button>
      <button
        type="button"
        role="menuitem"
        className="bb-files-row__menu-item bb-files-row__menu-item--danger"
        onClick={onDelete}
      >
        Delete
      </button>
    </div>
  );
}

// =============================================================================
// Upload-in-progress / rejected / failed rows
// =============================================================================

export function UploadRow({ upload }: { upload: UploadingFile }) {
  const { dismissUpload } = useFiles();
  const isRejected = upload.status === 'rejected';
  const isFailed = upload.status === 'failed';

  return (
    <div
      className={`bb-files-row bb-files-row--upload${isRejected ? ' bb-files-row--rejected' : ''}${isFailed ? ' bb-files-row--failed' : ''}`}
      data-upload-id={upload.id}
    >
      <div className="bb-files-row__main">
        <div className="bb-files-row__title-line">
          <span className="bb-files-row__filename" title={upload.filename}>
            {upload.filename}
          </span>
          <span className="bb-files-row__size">{formatBytes(upload.size)}</span>
        </div>

        {isRejected ? (
          <div className="bb-files-row__status bb-files-row__status--rejected">
            Couldn't add — {upload.rejectionReason ?? upload.errorMessage ?? 'unknown reason'}
          </div>
        ) : isFailed ? (
          <div className="bb-files-row__status bb-files-row__status--failed">
            Upload failed — {upload.errorMessage ?? 'try again'}
          </div>
        ) : (
          <div className="bb-files-row__progress" aria-label="Upload progress">
            <div className="bb-files-row__progress-bar">
              <div
                className="bb-files-row__progress-fill"
                style={{ width: `${Math.max(2, upload.progress)}%` }}
              />
            </div>
            <span className="bb-files-row__progress-label">
              {upload.status === 'queued' ? 'Queued…' : `${Math.round(upload.progress)}%`}
            </span>
          </div>
        )}
      </div>

      <div className="bb-files-row__actions">
        {(isRejected || isFailed) && (
          <button
            type="button"
            className="bb-files-row__dismiss"
            onClick={() => dismissUpload(upload.id)}
            aria-label="Dismiss"
          >
            ×
          </button>
        )}
      </div>
    </div>
  );
}

// =============================================================================
// Local byte formatter (same conventions as quota-indicator)
// =============================================================================

function formatBytes(bytes: number): string {
  if (bytes < 1_000) return `${bytes} B`;
  if (bytes < 1_000_000) return `${Math.round(bytes / 1_000)} KB`;
  if (bytes < 10_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
  if (bytes < 1_000_000_000) return `${Math.round(bytes / 1_000_000)} MB`;
  return `${(bytes / 1_000_000_000).toFixed(1)} GB`;
}
