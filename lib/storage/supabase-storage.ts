// lib/storage/supabase-storage.ts
//
// Server-side helpers for the `case-files` storage bucket.
//
// Responsibility: generate signed URLs that the browser can use to talk
// directly to Supabase Storage, and perform server-side admin operations
// (object existence checks, deletes, byte reads for Chunk 7).
//
// Why server-side:
//   - All operations here happen AFTER our Drizzle-layer ownership check.
//     The signed URLs we generate are capability tokens; once handed to
//     the browser, they bypass RLS. So we MUST verify ownership ourselves
//     before issuing them.
//   - storage.objects RLS policies are a backstop for cases where signed
//     URLs aren't used (e.g. if we later add direct Supabase-from-browser
//     queries against storage.objects).
//
// The path convention is:   {user_id}/{matter_id}/{file_id}{extension}
//
// The user_id prefix is what the bucket's storage RLS policy keys on. Do
// NOT change the path convention without updating both:
//   - lib/db/migrations/0005_files.sql (the storage RLS policies)
//   - The buildStoragePath() helper below
// These must agree.

import { createClient } from '@/lib/supabase/server';

// Bucket name MUST match the name set in the Supabase dashboard (see
// 0005_files.sql README block). One constant, one place to change.
const BUCKET = 'case-files';

// Signed URL TTLs — short enough that a leaked URL has limited blast radius.
// Long enough that lawyers with slow connections can complete uploads/
// downloads without retrying.
const UPLOAD_URL_TTL_SECONDS = 900; // 15 min
const DOWNLOAD_URL_TTL_SECONDS = 300; // 5 min

// =============================================================================
// Path construction
// =============================================================================

/**
 * Builds the canonical storage path for a file.
 *
 * Format: {user_id}/{matter_id}/{file_id}{extension}
 *
 * - user_id prefix is what storage RLS keys on. NEVER omit it.
 * - file_id is the UUID we generated in the files row, NOT the original
 *   filename. This is what guarantees uniqueness and means special
 *   characters in lawyer-typed filenames can't break the storage layer.
 * - extension is preserved (lowercased) so the storage object has a
 *   recognisable suffix in the dashboard, but the rest of the original
 *   filename never appears in the path.
 *
 * For "R v Smith (No 2) — final.pdf" uploaded by user U for matter M
 * with file_id F:
 *   path = "U/M/F.pdf"
 * The em-dash, parens, spaces — none of them hit the storage layer.
 */
export function buildStoragePath(
  userId: string,
  matterId: string,
  fileId: string,
  filename: string,
): string {
  return `${userId}/${matterId}/${fileId}${getExtension(filename)}`;
}

/**
 * Returns the lowercased extension WITH the leading dot, or empty string
 * if the filename has no extension.
 *
 *   "Smith.pdf"          -> ".pdf"
 *   "Smith.PDF"          -> ".pdf"
 *   "Smith (No 2).pdf"   -> ".pdf"
 *   "no-extension"       -> ""
 *   ".dotfile"           -> ""  (no extension; the dot is the name)
 *   "a.b.c.txt"          -> ".txt"
 */
function getExtension(filename: string): string {
  const lastDot = filename.lastIndexOf('.');
  if (lastDot <= 0) return ''; // dotfile or no dot — no extension
  if (lastDot === filename.length - 1) return ''; // trailing dot — no extension
  return filename.slice(lastDot).toLowerCase();
}

// =============================================================================
// Signed URL operations
// =============================================================================

/**
 * Generates a signed upload URL for the browser to PUT/POST file bytes to.
 *
 * The returned `token` is what the browser passes to
 * `supabase.storage.from(...).uploadToSignedUrl(path, token, file)`.
 *
 * The `signedUrl` is informational only — the SDK's uploadToSignedUrl
 * method builds its own request URL from the path + token. We return it
 * for logging/debugging.
 *
 * Note: createSignedUploadUrl uploads happen via PUT (resumable for files
 * over 6MB internally), so this single helper covers our 10MB cap range.
 * The TUS resumable upload pathway kicks in transparently.
 */
export async function getUploadUrl(args: {
  storagePath: string;
}): Promise<{ signedUrl: string; token: string; path: string }> {
  const supabase = await createClient();

  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUploadUrl(args.storagePath);

  if (error) {
    throw new Error(`Failed to create signed upload URL: ${error.message}`);
  }
  if (!data) {
    throw new Error('createSignedUploadUrl returned no data');
  }

  return {
    signedUrl: data.signedUrl,
    token: data.token,
    path: data.path,
  };
}

/**
 * Generates a signed GET URL for direct download from Supabase Storage.
 *
 * `downloadFilename` controls the Content-Disposition response header so
 * the lawyer's browser saves the file with the original (user-typed)
 * filename rather than the UUID-based storage path. RFC 5987 encoding for
 * non-ASCII filenames is handled by the SDK.
 *
 * If you pass a filename containing special characters or unicode (e.g.
 * "R v Smith (No 2) — final.pdf"), the SDK encodes it as filename*=UTF-8''...
 * in the Content-Disposition header. Browsers handle that correctly.
 */
export async function getDownloadUrl(args: {
  storagePath: string;
  downloadFilename: string;
}): Promise<string> {
  const supabase = await createClient();

  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(args.storagePath, DOWNLOAD_URL_TTL_SECONDS, {
      // Setting `download` to a string forces the file to download (not
      // open inline in the browser) AND sets Content-Disposition with the
      // given filename. The SDK does RFC 5987 encoding for us.
      download: args.downloadFilename,
    });

  if (error) {
    throw new Error(`Failed to create signed download URL: ${error.message}`);
  }
  if (!data?.signedUrl) {
    throw new Error('createSignedUrl returned no signedUrl');
  }

  return data.signedUrl;
}

// =============================================================================
// Admin operations (object inspection / deletion)
// =============================================================================

/**
 * Checks whether an object actually exists in the bucket.
 *
 * Used by:
 *   - completeUpload (to confirm the client's upload landed)
 *   - listMatterFiles (to detect orphan rows whose upload failed silently)
 *
 * Uses `list()` rather than HEAD because the SDK's list method handles
 * the bucket prefix and policies cleanly. We list with a 1-result limit
 * and the exact filename, which uses the bucket's name index.
 */
export async function objectExists(storagePath: string): Promise<boolean> {
  const supabase = await createClient();

  // Split the path into prefix + filename for list() since it needs them
  // separately. storagePath is always {user}/{matter}/{file}.ext, so
  // prefix = "{user}/{matter}" and filename = "{file}.ext".
  const lastSlash = storagePath.lastIndexOf('/');
  if (lastSlash < 0) return false;
  const prefix = storagePath.slice(0, lastSlash);
  const name = storagePath.slice(lastSlash + 1);

  const { data, error } = await supabase.storage
    .from(BUCKET)
    .list(prefix, { limit: 1, search: name });

  if (error) {
    // Treat list errors as "doesn't exist" rather than throwing — the
    // caller (listMatterFiles) uses this for orphan detection and shouldn't
    // hard-error if Storage is briefly unavailable.
    return false;
  }
  return (data ?? []).some((obj) => obj.name === name);
}

/**
 * Deletes one or more objects from the bucket.
 *
 * Idempotent — deleting a non-existent path is not an error here. We use
 * this in hardDeleteFile, where the object SHOULD exist but a previous
 * partial-delete might have left the DB row with no corresponding object.
 *
 * The Supabase Storage SDK accepts an array of paths in a single call,
 * which we'd use for bulk operations later. For Chunk 6 we delete one at
 * a time (no bulk delete UI yet).
 */
export async function deleteObject(storagePath: string): Promise<void> {
  const supabase = await createClient();

  const { error } = await supabase.storage.from(BUCKET).remove([storagePath]);
  if (error) {
    // Don't swallow — if the storage delete fails on a hard-delete path,
    // we want to know. The calling action surfaces this to logs.
    throw new Error(`Failed to delete storage object: ${error.message}`);
  }
}

/**
 * Reads object bytes server-side. RESERVED FOR CHUNK 7.
 *
 * Currently unused in Chunk 6 (no Claude integration yet). Included here
 * so the storage helper module exposes the full shape we'll need.
 *
 * When called in Chunk 7, this will fetch the PDF bytes from Supabase
 * Storage so we can hand them to Anthropic's Files API on first read.
 */
export async function getObjectBytes(storagePath: string): Promise<Buffer> {
  const supabase = await createClient();

  const { data, error } = await supabase.storage
    .from(BUCKET)
    .download(storagePath);

  if (error) {
    throw new Error(`Failed to download storage object: ${error.message}`);
  }
  if (!data) {
    throw new Error('Storage download returned no data');
  }

  const arrayBuffer = await data.arrayBuffer();
  return Buffer.from(arrayBuffer);
}
