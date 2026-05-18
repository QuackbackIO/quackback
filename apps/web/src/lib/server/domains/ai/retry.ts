/**
 * Retry utility with exponential backoff for AI API calls.
 * Handles transient failures like rate limits and network errors.
 *
 * Best practice from OpenAI: https://cookbook.openai.com/examples/how_to_handle_rate_limits
 */

export interface RetryOptions {
  maxRetries?: number
  baseDelayMs?: number
  maxDelayMs?: number
}

const DEFAULT_OPTIONS: Required<RetryOptions> = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<{ result: T; retryCount: number }> {
  const { maxRetries, baseDelayMs, maxDelayMs } = { ...DEFAULT_OPTIONS, ...options }

  let lastError: Error = new Error('No attempts made')
  let retryCount = 0

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const result = await fn()
      return { result, retryCount }
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))

      const isLastAttempt = attempt === maxRetries
      if (!isRetryableError(lastError) || isLastAttempt) {
        // Attach retryCount so withUsageLogging can capture it in error rows
        ;(lastError as Error & { retryCount?: number }).retryCount = retryCount
        throw lastError
      }

      retryCount++
      const delay = Math.min(baseDelayMs * Math.pow(2, attempt) + Math.random() * 1000, maxDelayMs)

      console.log(
        `[AI] Retry attempt ${attempt + 1}/${maxRetries} after ${Math.round(delay)}ms: ${lastError.message}`
      )

      await sleep(delay)
    }
  }

  throw lastError
}

const RETRYABLE_ERROR_PATTERN =
  /econnreset|etimedout|enotfound|socket hang up|rate.limit|too many requests|429|5\d\d|internal server error|bad gateway|service unavailable|inferenceupstreamerror/i

// Non-transient client errors that should never be retried. An invalid model
// ID, a malformed prompt, or a revoked API key will fail identically forever —
// retrying just amplifies the damage (see issue #180, where a misconfigured
// model id caused ~318k retries against api.openai.com).
const NON_RETRYABLE_STATUS_PATTERN = /\b(400|401|403|404|422)\b/

export function isRetryableError(error: Error): boolean {
  // Explicit non-retryable status takes precedence even if other tokens in the
  // message happen to look retryable.
  if (NON_RETRYABLE_STATUS_PATTERN.test(error.message)) return false
  return RETRYABLE_ERROR_PATTERN.test(error.message)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
