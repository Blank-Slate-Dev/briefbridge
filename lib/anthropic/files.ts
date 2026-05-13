// lib/anthropic/files.ts
//
// Server-only wrapper around Anthropic's Files API. Used by the chat
// route when Claude needs to read a user-uploaded file.
//
// SECURITY: This module is SERVER ONLY. It uses the Anthropic API key
// from environment, which must never be shipped to the browser. Any file
// importing this must be a server component, server action, or API route.
// We rely on Next.js's 'server-only' import to fail loudly if this ever
// gets imported into a client-side bundle.

import 'server-only';
import Anthropic from '@anthropic-ai/sdk';

// =============================================================================
// Client construction
// =============================================================================

function getAnthropicClient(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY is not set in the environment');
  }
  return new Anthropic({ apiKey });
}

// =============================================================================
// Upload
// =============================================================================

/**
 * Uploads bytes to Anthropic's Files API and returns the file_id.
 *
 * @returns The Anthropic file_id (something like 'file_011CXXXX...').
 */
export async function uploadFileToAnthropic(args: {
  buffer: Buffer | Uint8Array;
  filename: string;
  mimeType: string;
}): Promise<string> {
  const client = getAnthropicClient();

  // TS FIX (Category E, third time's the charm):
  //
  // TS lib.dom 2025+ types BlobPart's binary variant as
  // ArrayBufferView<ArrayBuffer>, NOT ArrayBufferView<ArrayBufferLike>.
  // This is paranoia about SharedArrayBuffer-backed views being passed
  // to APIs that expect transferable buffers. In our code path:
  //
  //   - The buffer comes from Supabase Storage's getObjectBytes()
  //   - That returns a plain Node Buffer (which is ArrayBuffer-backed)
  //   - There is NO SharedArrayBuffer anywhere in this call chain
  //
  // The type system can't see that. We use `unknown as BlobPart` to
  // assert what we know to be true at the value level.
  //
  // Alternative we tried first: wrap in a fresh Uint8Array. TS still
  // narrows it to Uint8Array<ArrayBufferLike>. Going through Blob also
  // fails for the same root reason. A type assertion is the cleanest
  // way out, and the runtime is safe.
  const blob = new Blob([args.buffer as unknown as BlobPart], {
    type: args.mimeType,
  });
  const file = new File([blob], args.filename, { type: args.mimeType });

  const result = await client.beta.files.upload({ file });

  if (!result.id) {
    throw new Error('Anthropic Files API returned no file id');
  }

  return result.id;
}

// =============================================================================
// Delete
// =============================================================================

/**
 * Deletes a file from Anthropic Files API. Used when:
 *   - Lawyer soft-deletes a file (mirror Supabase deletion)
 *   - Lawyer marks a file ai_blocked_by_user (revoke AI access)
 *   - 30-day TTL cron eventually removes inactive copies
 *
 * Idempotent: if the file is already gone (404), we treat that as
 * success. Anything else throws.
 */
export async function deleteAnthropicFile(fileId: string): Promise<void> {
  const client = getAnthropicClient();

  try {
    await client.beta.files.delete(fileId);
  } catch (err: unknown) {
    // 404 = already gone. Treat as success.
    if (
      typeof err === 'object' &&
      err !== null &&
      'status' in err &&
      (err as { status: unknown }).status === 404
    ) {
      return;
    }
    throw err;
  }
}