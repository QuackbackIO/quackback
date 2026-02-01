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

export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const { maxRetries, baseDelayMs, maxDelayMs } = { ...DEFAULT_OPTIONS, ...options }

  let lastError: Error = new Error('No attempts made')

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn()
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))

      const isLastAttempt = attempt === maxRetries
      if (!isRetryableError(lastError) || isLastAttempt) {
        throw lastError
      }

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

export function isRetryableError(error: Error): boolean {
  return RETRYABLE_ERROR_PATTERN.test(error.message)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
