// app/(app)/matters/[id]/_components/file-block-control.tsx
//
// Composable bits for the existing file-row.tsx (Chunk 6). Two exports:
//
//   - <FileBlockMenuItem fileId aiBlockedByUser /> — the kebab menu item.
//     Renders "Block Claude from reading" or "Allow Claude to read"
//     depending on current state. Triggers setFileAiBlockAction.
//
//   - <FileProtectedBadge /> — the small gold "Protected" pill shown
//     next to the filename when ai_blocked_by_user is true.
//
// User wires these in by:
//   1. Importing both
//   2. Adding <FileBlockMenuItem ... /> as a sibling of Delete in the
//      kebab menu list
//   3. Rendering {file.aiBlockedByUser && <FileProtectedBadge />} next
//      to the filename
//
// See README §5 for the exact patch instructions.

'use client';

import { useState } from 'react';
import { setFileAiBlockAction } from '@/app/(app)/matters/[id]/files/_actions-ai';

// =============================================================================
// FileBlockMenuItem
// =============================================================================

interface FileBlockMenuItemProps {
  fileId: string;
  aiBlockedByUser: boolean;
  /** Called after a successful toggle so the parent can refresh its file list. */
  onChanged?: () => void;
  /** Called to close the kebab menu (typically the parent's close handler). */
  onClose?: () => void;
}

export function FileBlockMenuItem({
  fileId,
  aiBlockedByUser,
  onChanged,
  onClose,
}: FileBlockMenuItemProps) {
  const [isWorking, setIsWorking] = useState(false);

  const handleClick = async () => {
    if (isWorking) return;
    setIsWorking(true);
    const target = !aiBlockedByUser;
    const result = await setFileAiBlockAction({
      fileId,
      blocked: target,
    });
    setIsWorking(false);
    if (result.ok) {
      onChanged?.();
    }
    // Always close, error or not — the menu shouldn't linger.
    onClose?.();
  };

  return (
    <button
      type="button"
      role="menuitem"
      className="bb-kebab-item"
      onClick={handleClick}
      disabled={isWorking}
    >
      {aiBlockedByUser ? 'Allow Claude to read' : 'Block Claude from reading'}
    </button>
  );
}

// =============================================================================
// FileProtectedBadge
// =============================================================================

export function FileProtectedBadge() {
  return (
    <span className="bb-file-badge bb-file-badge--protected" title="Claude cannot read this file">
      Protected
    </span>
  );
}
