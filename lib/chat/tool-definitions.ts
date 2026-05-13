// lib/chat/tool-definitions.ts
//
// Tool definitions passed to Anthropic in the `tools` parameter of
// messages.stream(). Kept here as standalone constants so the schema
// can be unit-tested + reasoned about independently of the chat route.
//
// Schema notes:
//   - JSON Schema with `type: "object"`, properties, required[]
//   - We don't use Anthropic's "computer use" or "text editor" built-ins;
//     read_files is fully custom
//   - The description field is what Claude actually reads to decide
//     when to invoke. Be specific.
//
// CHUNK 7 TS FIX (Category D): Earlier version used `as const` which made
// the `required: ['filenames', 'reason']` array a readonly tuple. The
// Anthropic SDK's Tool type expects a mutable string[], so the readonly
// tuple was rejected as incompatible. Fix: don't use `as const`, just
// type the export as Anthropic.Tool[] and let TS check structural match.

import type Anthropic from '@anthropic-ai/sdk';

export const READ_FILES_TOOL: Anthropic.Tool = {
  name: 'read_files',
  description:
    "Read the contents of one or more case files uploaded by the lawyer. Use this when you need to quote, compare, or analyze the actual content of documents. The lawyer's case files are listed in your system prompt — reference them by filename. Always provide a clear reason explaining what you're looking for.",
  input_schema: {
    type: 'object',
    properties: {
      filenames: {
        type: 'array',
        description:
          'The filenames to read, exactly as they appear in the available files list. Each filename is case-sensitive. You can read one or many in a single call — prefer one call with all files you anticipate needing for this turn.',
        items: {
          type: 'string',
        },
        minItems: 1,
        maxItems: 50,
      },
      reason: {
        type: 'string',
        description:
          "A short, specific reason explaining what you're trying to find or compare across these files. The lawyer reviews this. Examples: 'To compare what each party claims about the 14 March meeting', 'To check the dates of the orders'.",
      },
    },
    required: ['filenames', 'reason'],
  },
};

/**
 * Array form for handing to Anthropic's `tools` parameter.
 * Right now we have one tool; the array shape is forward-compatible
 * for when we add more (e.g. a `search_caselaw` tool down the road).
 */
export const CHAT_TOOLS: Anthropic.Tool[] = [READ_FILES_TOOL];

/**
 * Tool name constants for switch statements in the chat route.
 */
export const TOOL_NAMES = {
  READ_FILES: 'read_files' as const,
};

/**
 * Runtime shape Claude sends back when calling read_files.
 * (After we JSON.parse the partial_json chunks.)
 */
export interface ReadFilesToolInput {
  filenames: string[];
  reason: string;
}

export function isReadFilesToolInput(value: unknown): value is ReadFilesToolInput {
  return (
    typeof value === 'object' &&
    value !== null &&
    'filenames' in value &&
    Array.isArray((value as { filenames: unknown }).filenames) &&
    (value as { filenames: unknown[] }).filenames.every(
      (f) => typeof f === 'string',
    ) &&
    'reason' in value &&
    typeof (value as { reason: unknown }).reason === 'string'
  );
}
