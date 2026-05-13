// app/api/files-tool/route.ts
//
// Executes the `read_files` tool from /api/chat. Not called by the
// browser directly — this is an internal route the chat route invokes.
//
// CHUNK 7 FIX (May 2026): Anthropic's tool_result content blocks accept
// only `text`. Document blocks are NOT allowed inside tool_result. So
// the response shape changed:
//
//   Before (broken): return contentBlocks array containing text + document blocks
//   After (working): return toolResultText (string for tool_result) AND
//                    documentBlocks (array for a follow-up user message)
//
// The chat route then appends BOTH to the message history:
//   1. assistant tool_use block (Claude's call)
//   2. user tool_result block with the text we returned
//   3. user message containing the document blocks
//   4. continue streaming
//
// This is a documented Anthropic pattern for "the tool fetched something
// large; give the model the actual content in a separate user message."

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { resolveFilenames } from '@/lib/db/queries/ai-access';
import { ensureAnthropicCopy } from '@/lib/anthropic/file-sync';
import {
  MAX_READ_TOKENS_PER_TURN,
  tokenEstimate,
} from '@/lib/files/ai-access-types';

// =============================================================================
// Types
// =============================================================================

/**
 * A document block to be put in a follow-up user message. NOT inside
 * the tool_result — Anthropic rejects that shape.
 */
export interface DocumentBlock {
  type: 'document';
  source: {
    type: 'file';
    file_id: string;
  };
  title?: string;
}

export interface FilesToolResponse {
  ok: true;
  /**
   * Text to put inside the tool_result's content array. Summarizes what
   * was loaded (filenames) + any warnings. Claude reads this BEFORE
   * seeing the document blocks.
   */
  toolResultText: string;
  /**
   * Document blocks for a follow-up user message. Empty if every file
   * failed. Order matches filesUsed.
   */
  documentBlocks: DocumentBlock[];
  warnings: string[];
  filesUsed: Array<{
    fileId: string;
    filename: string;
    anthropicFileId: string;
  }>;
}

export interface FilesToolError {
  ok: false;
  error: string;
}

// =============================================================================
// Handler
// =============================================================================

interface RequestBody {
  matterId: string;
  filenames: string[];
}

export async function POST(req: Request) {
  // 1. Auth.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json<FilesToolError>(
      { ok: false, error: 'Not authenticated' },
      { status: 401 },
    );
  }

  // 2. Parse body.
  let body: RequestBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json<FilesToolError>(
      { ok: false, error: 'Invalid request body' },
      { status: 400 },
    );
  }

  if (
    !body ||
    typeof body.matterId !== 'string' ||
    !Array.isArray(body.filenames)
  ) {
    return NextResponse.json<FilesToolError>(
      { ok: false, error: 'Invalid request shape' },
      { status: 400 },
    );
  }

  if (body.filenames.length === 0) {
    return NextResponse.json<FilesToolError>(
      { ok: false, error: 'No filenames provided' },
      { status: 400 },
    );
  }

  if (body.filenames.length > 50) {
    return NextResponse.json<FilesToolError>(
      { ok: false, error: 'Too many files requested in one call' },
      { status: 400 },
    );
  }

  // 3. Resolve filenames → files (with all access gates applied).
  const resolutions = await resolveFilenames(
    user.id,
    body.matterId,
    body.filenames,
  );

  const documentBlocks: DocumentBlock[] = [];
  const warnings: string[] = [];
  const filesUsed: FilesToolResponse['filesUsed'] = [];
  const loadedFilenames: string[] = [];

  // 4. Bucket the resolutions by outcome.
  const okResolutions = resolutions.filter((r) => r.outcome.kind === 'ok');

  // Sort smallest-first so cap accounting maximizes file count loaded.
  okResolutions.sort((a, b) => {
    if (a.outcome.kind !== 'ok' || b.outcome.kind !== 'ok') return 0;
    return (
      tokenEstimate({
        mimeType: a.outcome.file.mimeType,
        pageCount: a.outcome.file.pageCount,
        fileSize: a.outcome.file.fileSize,
      }) -
      tokenEstimate({
        mimeType: b.outcome.file.mimeType,
        pageCount: b.outcome.file.pageCount,
        fileSize: b.outcome.file.fileSize,
      })
    );
  });

  // 5. Emit warnings for non-ok resolutions.
  for (const r of resolutions) {
    if (r.outcome.kind === 'not_found') {
      warnings.push(
        `"${r.filename}" is not available. It may have been deleted, blocked, or excluded from this case's AI access.`,
      );
    } else if (r.outcome.kind === 'ambiguous') {
      warnings.push(
        `"${r.filename}" matches ${r.outcome.count} files in this case. Please ask the lawyer to clarify which file you want.`,
      );
    }
  }

  let runningTokens = 0;

  for (const r of okResolutions) {
    if (r.outcome.kind !== 'ok') continue;
    const file = r.outcome.file;
    const tokens = tokenEstimate({
      mimeType: file.mimeType,
      pageCount: file.pageCount,
      fileSize: file.fileSize,
    });

    if (runningTokens + tokens > MAX_READ_TOKENS_PER_TURN) {
      warnings.push(
        `"${file.filename}" was not loaded — reading it would exceed the per-turn limit. Please ask a narrower question.`,
      );
      continue;
    }

    // Within cap — ensure Anthropic file_id and include document block.
    const sync = await ensureAnthropicCopy({
      userId: user.id,
      fileId: file.id,
      filename: file.filename,
      mimeType: file.mimeType,
      storagePath: file.storagePath,
      currentAnthropicFileId: file.anthropicFileId,
    });

    if (sync.outcome.kind === 'error') {
      warnings.push(
        `Couldn't load "${file.filename}": ${sync.outcome.message}`,
      );
      continue;
    }

    documentBlocks.push({
      type: 'document',
      source: { type: 'file', file_id: sync.outcome.anthropicFileId },
      title: file.filename,
    });

    filesUsed.push({
      fileId: file.id,
      filename: file.filename,
      anthropicFileId: sync.outcome.anthropicFileId,
    });

    loadedFilenames.push(file.filename);
    runningTokens += tokens;
  }

  // 6. Compose the tool_result text. This is what goes INSIDE the
  // tool_result content array. The actual document content comes in
  // the follow-up user message.
  let toolResultText: string;
  if (loadedFilenames.length === 0) {
    toolResultText = `No files could be loaded. ${
      warnings.length > 0
        ? 'Issues: ' + warnings.join('; ')
        : 'See warnings.'
    }`;
  } else {
    const filesLine =
      loadedFilenames.length === 1
        ? `Loaded "${loadedFilenames[0]}".`
        : `Loaded ${loadedFilenames.length} files: ${loadedFilenames.map((f) => `"${f}"`).join(', ')}.`;
    const warningsLine =
      warnings.length > 0
        ? ` Some files couldn't be loaded: ${warnings.join('; ')}`
        : '';
    toolResultText = `${filesLine} The file contents follow in the next message.${warningsLine}`;
  }

  return NextResponse.json<FilesToolResponse>({
    ok: true,
    toolResultText,
    documentBlocks,
    warnings,
    filesUsed,
  });
}