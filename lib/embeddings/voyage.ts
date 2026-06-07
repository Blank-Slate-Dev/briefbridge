// lib/embeddings/voyage.ts
//
// Minimal client for Voyage AI's embeddings API.
// Docs: https://docs.voyageai.com/reference/embeddings-api
//
// Key facts about Voyage:
//   - Endpoint: POST https://api.voyageai.com/v1/embeddings
//   - Auth: Bearer token in Authorization header
//   - Batch size: up to 128 texts per request; the per-batch TOKEN limit is
//     model-specific — for voyage-law-2 it is 120,000 tokens (confirmed by a
//     live API rejection; an earlier note here said 320k, which is wrong for
//     this model).
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
//
// Token-limit robustness:
//   estimateTokens() (chars / 3.5) badly undercounts token-dense content —
//   tariff schedules and numeric tables run closer to ~2 chars/token, so a
//   batch we budget under the limit can still be rejected by Voyage. Rather
//   than guess an ever-smaller char budget, embed() reacts to the actual
//   rejection: it bisects the offending batch and retries until the pieces
//   fit. batchTexts() + BATCH_TOKEN_BUDGET still do the first-pass sizing so
//   the split rarely triggers; the split is the guarantee.

const VOYAGE_API_URL = 'https://api.voyageai.com/v1/embeddings';

// Voyage's hard limits for voyage-law-2.
const MAX_BATCH_SIZE = 128;

// Voyage rejects any batch over 120,000 tokens for voyage-law-2 — confirmed by
// the API error "max allowed tokens per submitted batch is 120000". estimateTokens()
// below is a char-based approximation (chars / 3.5) that UNDER-counts on
// token-dense content (tariff schedules, numeric tables, classification codes —
// observed ~2 chars/token, i.e. ~1.7x our estimate). We pack against this budget
// as a first pass; embed() then auto-splits anything Voyage still rejects.
const BATCH_TOKEN_BUDGET = 80_000;

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
 * Auto-splitting: if Voyage rejects the batch for exceeding its per-batch token
 * limit, this bisects the batch and retries each half (recursing until the
 * pieces fit). Our token estimate can undercount dense content, so this makes
 * embedding robust to that error regardless of how off the estimate is. The
 * returned embeddings stay in input order. Any non-token-limit error, or a
 * single text that alone exceeds the limit, propagates unchanged.
 *
 * Callers should still pre-batch with batchTexts() (≤ MAX_BATCH_SIZE items and
 * a conservative token budget) so splitting is the rare exception, not the norm.
 */
export async function embed(options: EmbedOptions): Promise<EmbedResult> {
  try {
    return await embedRequest(options);
  } catch (err) {
    const isTokenLimit =
      err instanceof Error &&
      /max allowed tokens per submitted batch/i.test(err.message);

    // Only auto-split token-limit rejections, and only when there's more than
    // one text to split. A single text is capped upstream at 50k chars
    // (≈ ≤25k tokens), comfortably under the limit, so this guard also
    // guarantees the recursion terminates.
    if (!isTokenLimit || options.texts.length <= 1) {
      throw err;
    }

    const mid = Math.ceil(options.texts.length / 2);
    const left = await embed({ ...options, texts: options.texts.slice(0, mid) });
    const right = await embed({ ...options, texts: options.texts.slice(mid) });

    return {
      embeddings: [...left.embeddings, ...right.embeddings],
      totalTokens: left.totalTokens + right.totalTokens,
      model: left.model,
    };
  }
}

/**
 * One HTTP request to Voyage (with transient-error retry). No splitting — the
 * public embed() wraps this and handles token-limit bisection.
 *
 * Throws on non-2xx responses. Caller is responsible for batching the texts
 * into groups of MAX_BATCH_SIZE — this function takes whatever you give it
 * (up to that limit) and sends one request.
 *
 * Includes built-in retry for transient errors (429, 500, 502, 503, 504)
 * with exponential backoff. After 3 retries it gives up and throws.
 */
async function embedRequest(options: EmbedOptions): Promise<EmbedResult> {
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
 *
 * NOTE: this still under-counts on token-dense content (tariff codes, numeric
 * tables — closer to ~2 chars/token). batchTexts() packs against
 * BATCH_TOKEN_BUDGET as a first pass, and embed() auto-splits anything Voyage
 * rejects, so an undercount here can no longer cause a hard failure.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.5);
}

/**
 * Splits a list of texts into batches that respect both:
 *   - The MAX_BATCH_SIZE item-count limit
 *   - The BATCH_TOKEN_BUDGET token-count budget (a safe margin under Voyage's
 *     real 120k per-batch ceiling, since estimateTokens can undercount)
 *
 * This is best-effort sizing; embed() provides the hard guarantee by splitting
 * any batch Voyage still rejects for the token limit.
 */
export function batchTexts(texts: string[]): string[][] {
  const batches: string[][] = [];
  let currentBatch: string[] = [];
  let currentTokens = 0;

  for (const text of texts) {
    const tokens = estimateTokens(text);

    // If a single text alone exceeds the batch token budget, send it on its own
    // and let Voyage truncate or error. (The model has its own per-text token
    // limit ~16k for voyage-law-2; we trust the API to handle this.)
    if (tokens > BATCH_TOKEN_BUDGET) {
      if (currentBatch.length > 0) {
        batches.push(currentBatch);
        currentBatch = [];
        currentTokens = 0;
      }
      batches.push([text]);
      continue;
    }

    const wouldExceedTokens = currentTokens + tokens > BATCH_TOKEN_BUDGET;
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
