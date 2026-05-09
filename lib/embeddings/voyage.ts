// lib/embeddings/voyage.ts
//
// Minimal client for Voyage AI's embeddings API.
// Docs: https://docs.voyageai.com/reference/embeddings-api
//
// Key facts about Voyage:
//   - Endpoint: POST https://api.voyageai.com/v1/embeddings
//   - Auth: Bearer token in Authorization header
//   - Batch size: up to 128 texts per request, up to 320,000 tokens combined
//   - Outputs are L2-normalised, so cosine similarity == dot product
//   - voyage-law-2 outputs 1024-dim vectors
//
// Why this client and not their official SDK:
//   - Their SDK targets Python first; the JS one lags
//   - Our needs are simple (embed, retry, error)
//   - Less dependency surface area for our project
//
// "input_type":
//   - 'document' for paragraphs going INTO the index
//   - 'query' for the user's question being matched against the index
//   This gives meaningfully better retrieval than treating both the same.

const VOYAGE_API_URL = 'https://api.voyageai.com/v1/embeddings';

// Voyage's documented hard limits.
const MAX_BATCH_SIZE = 128;
const MAX_TOKENS_PER_BATCH = 120_000; // We pick 120k as a safe ceiling under the 320k limit
                                        // (token count estimation isn't exact; better to err under).

export type VoyageModel = 'voyage-law-2' | 'voyage-3' | 'voyage-3-lite';
export type InputType = 'document' | 'query';

export interface EmbedOptions {
  texts: string[];
  model?: VoyageModel;
  inputType: InputType;
}

export interface EmbedResult {
  embeddings: number[][];
  totalTokens: number;
  model: string;
}

/**
 * Embed a batch of texts via Voyage's API.
 *
 * Throws on non-2xx responses. Caller is responsible for batching the texts
 * into groups of MAX_BATCH_SIZE — this function takes whatever you give it
 * (up to that limit) and sends one request.
 *
 * Includes built-in retry for transient errors (429, 500, 502, 503, 504)
 * with exponential backoff. After 3 retries it gives up and throws.
 */
export async function embed(options: EmbedOptions): Promise<EmbedResult> {
  const apiKey = process.env.VOYAGE_API_KEY;
  if (!apiKey) {
    throw new Error('VOYAGE_API_KEY environment variable is not set.');
  }

  if (options.texts.length === 0) {
    return { embeddings: [], totalTokens: 0, model: options.model ?? 'voyage-law-2' };
  }

  if (options.texts.length > MAX_BATCH_SIZE) {
    throw new Error(
      `Batch size ${options.texts.length} exceeds Voyage's per-request limit of ${MAX_BATCH_SIZE}. ` +
      `Split your texts into smaller batches.`,
    );
  }

  const model = options.model ?? 'voyage-law-2';

  const body = {
    input: options.texts,
    model,
    input_type: options.inputType,
  };

  // Retry config: 3 attempts, 1s/2s/4s delays.
  const RETRY_DELAYS_MS = [1000, 2000, 4000];

  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    const response = await fetch(VOYAGE_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (response.ok) {
      const data: VoyageResponse = await response.json();
      // Voyage returns embeddings in the same order as input.
      const embeddings = data.data
        .sort((a, b) => a.index - b.index)
        .map((item) => item.embedding);
      return {
        embeddings,
        totalTokens: data.usage.total_tokens,
        model: data.model,
      };
    }

    // Non-2xx. Decide whether to retry.
    const isRetryable = response.status === 429 || (response.status >= 500 && response.status < 600);

    if (!isRetryable || attempt === RETRY_DELAYS_MS.length) {
      const errorBody = await response.text();
      throw new Error(
        `Voyage API error: HTTP ${response.status} ${response.statusText}\n${errorBody}`,
      );
    }

    // Wait before retrying.
    await sleep(RETRY_DELAYS_MS[attempt]);
  }

  // Unreachable, but TypeScript doesn't know that.
  throw new Error('Unreachable: Voyage embed retry loop exited without success or failure.');
}

/**
 * Estimate token count for a string. Voyage's tokeniser is similar to GPT's;
 * a rough rule of thumb is ~4 characters per token for English prose, ~3 for
 * dense legal text (which has more punctuation and shorter words).
 *
 * We use 3.5 as a conservative estimate so we don't accidentally exceed the
 * per-batch token limit.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.5);
}

/**
 * Splits a list of texts into batches that respect both:
 *   - The MAX_BATCH_SIZE item-count limit
 *   - The MAX_TOKENS_PER_BATCH token-count limit
 */
export function batchTexts(texts: string[]): string[][] {
  const batches: string[][] = [];
  let currentBatch: string[] = [];
  let currentTokens = 0;

  for (const text of texts) {
    const tokens = estimateTokens(text);

    // If a single text alone exceeds the per-batch token limit, send it on its own
    // and let Voyage truncate or error. (The model has its own per-text token limit
    // ~16k for voyage-law-2; we trust the API to handle this.)
    if (tokens > MAX_TOKENS_PER_BATCH) {
      if (currentBatch.length > 0) {
        batches.push(currentBatch);
        currentBatch = [];
        currentTokens = 0;
      }
      batches.push([text]);
      continue;
    }

    const wouldExceedTokens = currentTokens + tokens > MAX_TOKENS_PER_BATCH;
    const wouldExceedItems = currentBatch.length + 1 > MAX_BATCH_SIZE;

    if (wouldExceedTokens || wouldExceedItems) {
      batches.push(currentBatch);
      currentBatch = [];
      currentTokens = 0;
    }

    currentBatch.push(text);
    currentTokens += tokens;
  }

  if (currentBatch.length > 0) {
    batches.push(currentBatch);
  }

  return batches;
}

// =============================================================================
// Internal types
// =============================================================================

interface VoyageResponse {
  data: Array<{ embedding: number[]; index: number }>;
  model: string;
  usage: { total_tokens: number };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
