/**
 * Retry schedule for outbound hook jobs (webhooks and integrations).
 *
 * Two regimes: the first retries land within seconds so a transient blip
 * (connection reset, brief 5xx) clears before anyone notices; once those are
 * spent, the final retry waits an hour so a receiving endpoint in a real
 * outage — a deploy, an incident — still gets the delivery after it recovers
 * instead of being declared dead inside three seconds.
 */

/** Total tries: first attempt + two fast retries + the slow final retry. */
export const HOOK_RETRY_ATTEMPTS = 4

/** Delay before the final retry: one hour. */
export const SLOW_RETRY_DELAY_MS = 3_600_000

/**
 * BullMQ backoff strategy: given the failures so far (1-based `attemptsMade`),
 * returns the delay in ms before the next attempt. The job's `backoff` option
 * still selects the strategy; this function is the strategy.
 */
export function hookRetryDelayMs(attemptsMade: number): number {
  if (attemptsMade >= HOOK_RETRY_ATTEMPTS - 1) return SLOW_RETRY_DELAY_MS
  return 1_000 * 2 ** (attemptsMade - 1)
}
