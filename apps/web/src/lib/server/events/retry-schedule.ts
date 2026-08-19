/**
 * Retry schedule for outbound hook jobs (webhooks and integrations).
 *
 * Two regimes: the first retries land within seconds so a transient blip
 * (connection reset, brief 5xx) clears before anyone notices; once those are
 * spent, slow retries back off through growing hourly intervals (1h, 2h, 4h)
 * with jitter, so a receiving endpoint in a real outage — a deploy, an
 * incident, an overnight maintenance window — still gets the delivery after
 * it recovers instead of being declared dead inside three seconds. The tail
 * keeps retrying for roughly seven hours after the first failure (six hours
 * at the jitter floor).
 */

/** Total tries: first attempt + two fast retries + three slow retries. */
export const HOOK_RETRY_ATTEMPTS = 6

/** Base delays for the slow retries: one, two, and four hours. */
const SLOW_RETRY_BASE_DELAYS_MS = [3_600_000, 7_200_000, 14_400_000] as const

/**
 * Jitter band applied to the slow base delays: ±10%, so endpoints that fail
 * together (a shared outage) do not retry in lockstep when they recover.
 * The floor keeps the worst-case total span at ~6.3 hours.
 */
const JITTER_FLOOR = 0.9
const JITTER_SPREAD = 0.2

/**
 * BullMQ backoff strategy: given the failures so far (1-based `attemptsMade`),
 * returns the delay in ms before the next attempt. The job's `backoff` option
 * still selects the strategy; this function is the strategy. `random` is
 * injectable so tests can pin the jitter draw.
 */
export function hookRetryDelayMs(attemptsMade: number, random: () => number = Math.random): number {
  if (attemptsMade <= 2) return 1_000 * 2 ** (attemptsMade - 1)
  const index = Math.min(attemptsMade - 3, SLOW_RETRY_BASE_DELAYS_MS.length - 1)
  const base = SLOW_RETRY_BASE_DELAYS_MS[index]
  return Math.round(base * (JITTER_FLOOR + random() * JITTER_SPREAD))
}
