// app/(app)/_components/streaming-chat-sse-events.ts
//
// Types and handlers for the NEW SSE event types added in Chunk 7.
// Importable into the existing streaming-chat.tsx — saves the user
// from defining these inline.
//
// New events (from /api/chat in Chunk 7):
//
//   tool_use_start         { toolName, toolUseId, input: { filenames, reason } }
//   tool_use_complete      { toolUseId, filesUsed: [{ fileId, filename }] }
//   partial_read_warning   { warning: string }
//   file_citations         { citations: FileCitation[] }
//
// The existing events (text, citations, done, error) remain unchanged.

import type { FileCitation } from '@/lib/db/schema';

// =============================================================================
// Event payload types
// =============================================================================

export interface ToolUseStartEvent {
  toolName: 'read_files' | string;
  toolUseId: string;
  input: {
    filenames: string[];
    reason: string;
  };
}

export interface ToolUseCompleteEvent {
  toolUseId: string;
  filesUsed: Array<{ fileId: string; filename: string }>;
}

export interface PartialReadWarningEvent {
  warning: string;
}

export interface FileCitationsEvent {
  citations: FileCitation[];
}

// =============================================================================
// Per-message "tool activity" state — what the UI tracks for indicators
// =============================================================================
//
// As tool_use_start / tool_use_complete events arrive, the streaming-chat
// component should maintain a small piece of state per assistant message:
//
//   - toolCalls: [{ toolUseId, filenames, reason, status: 'running' | 'done' }]
//   - warnings: string[] (for the amber dot)
//   - fileCitations: FileCitation[] (rendered inline + below the message)
//
// We expose a reducer-friendly type below so the user can copy-paste
// the structure into their state.

export type ToolCallStatus = 'running' | 'done';

export interface MessageToolActivity {
  toolCalls: Array<{
    toolUseId: string;
    filenames: string[];
    reason: string;
    status: ToolCallStatus;
    filesUsed?: Array<{ fileId: string; filename: string }>;
  }>;
  warnings: string[];
  fileCitations: FileCitation[];
}

export function emptyToolActivity(): MessageToolActivity {
  return { toolCalls: [], warnings: [], fileCitations: [] };
}

// =============================================================================
// Reducer-style updater functions
// =============================================================================
//
// Pure functions the user calls from their SSE event handler to update
// the activity state. Avoid recreating these inline in the component.

export function onToolUseStart(
  state: MessageToolActivity,
  event: ToolUseStartEvent,
): MessageToolActivity {
  return {
    ...state,
    toolCalls: [
      ...state.toolCalls,
      {
        toolUseId: event.toolUseId,
        filenames: event.input.filenames,
        reason: event.input.reason,
        status: 'running',
      },
    ],
  };
}

export function onToolUseComplete(
  state: MessageToolActivity,
  event: ToolUseCompleteEvent,
): MessageToolActivity {
  return {
    ...state,
    toolCalls: state.toolCalls.map((tc) =>
      tc.toolUseId === event.toolUseId
        ? { ...tc, status: 'done' as const, filesUsed: event.filesUsed }
        : tc,
    ),
  };
}

export function onPartialReadWarning(
  state: MessageToolActivity,
  event: PartialReadWarningEvent,
): MessageToolActivity {
  return {
    ...state,
    warnings: [...state.warnings, event.warning],
  };
}

export function onFileCitations(
  state: MessageToolActivity,
  event: FileCitationsEvent,
): MessageToolActivity {
  return {
    ...state,
    fileCitations: event.citations,
  };
}

// =============================================================================
// Inline status indicator component
// =============================================================================
//
// Renders the "Reading: X, Y — reason" block that appears inline in the
// streaming message while a tool call is running. Pulled out as a
// component so the user can drop it into their message-rendering tree.

export interface ToolStatusIndicatorProps {
  activity: MessageToolActivity;
}
