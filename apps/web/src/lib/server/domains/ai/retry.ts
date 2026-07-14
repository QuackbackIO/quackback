/**
 * Retry utility with exponential backoff for AI API calls.
 * Handles transient failures like rate limits and network errors.
 *
 * Best practice from OpenAI: https://cookbook.openai.com/examples/how_to_handle_rate_limits
 */

import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'ai-retry' })

export interface RetryOptions {
  maxRetries?: number
  baseDelayMs?: number
  maxDelayMs?: number
  /**
   * Optional abort signal. When it fires during a backoff sleep the sleep
   * rejects promptly (carrying the accumulated retryCount) and no further dial
   * is attempted — an aborted caller never waits out a backoff or re-dials.
   */
  signal?: AbortSignal
}

const DEFAULT_OPTIONS: Required<Omit<RetryOptions, 'signal'>> = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<{ result: T; retryCount: number }> {
  const { maxRetries, baseDelayMs, maxDelayMs } = { ...DEFAULT_OPTIONS, ...options }
  const signal = options.signal

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

      log.warn(
        {
          attempt: attempt + 1,
          max_retries: maxRetries,
          delay_ms: Math.round(delay),
          err: lastError,
        },
        'retrying ai call'
      )

      try {
        await sleep(delay, signal)
      } catch (abortErr) {
        // Aborted mid-backoff: surface the abort, not the transient error, and
        // stop — never re-dial. Preserve the retry count already accumulated.
        const err = abortErr instanceof Error ? abortErr : new Error(String(abortErr))
        ;(err as Error & { retryCount?: number }).retryCount = retryCount
        throw err
      }
    }
  }

  throw lastError
}

const RETRYABLE_ERROR_PATTERN =
  /econnreset|etimedout|enotfound|socket hang up|rate.limit|too many requests|429|5\d\d|internal server error|bad gateway|service unavailable|inferenceupstreamerror/i

// Client errors that will fail identically forever (invalid model id, revoked
// key, malformed request) — retrying them just amplifies the damage. Checked
// before the retryable pattern so noisy upstream messages can't smuggle a 4xx
// past the gate. See #180.
const NON_RETRYABLE_STATUS_PATTERN = /\b(400|401|403|404|422)\b/

export function isRetryableError(error: Error): boolean {
  if (NON_RETRYABLE_STATUS_PATTERN.test(error.message)) return false
  return RETRYABLE_ERROR_PATTERN.test(error.message)
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signalReason(signal))
      return
    }
    const timer = setTimeout(() => {
      cleanup()
      resolve()
    }, ms)
    const onAbort = () => {
      cleanup()
      reject(signalReason(signal!))
    }
    const cleanup = () => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

function signalReason(signal: AbortSignal): Error {
  const reason = (signal as AbortSignal & { reason?: unknown }).reason
  if (reason instanceof Error) return reason
  return new Error(typeof reason === 'string' && reason ? reason : 'aborted')
}
