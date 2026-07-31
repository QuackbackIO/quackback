import { describe, it, expect } from 'vitest'
import { hookRetryDelayMs, HOOK_RETRY_ATTEMPTS, SLOW_RETRY_DELAY_MS } from '../retry-schedule'

describe('hookRetryDelayMs', () => {
  it('keeps the first retries fast so transient blips clear in seconds', () => {
    expect(hookRetryDelayMs(1)).toBe(1_000)
    expect(hookRetryDelayMs(2)).toBe(2_000)
  })

  it('schedules a retry at least one hour after the first failure', () => {
    // After the fast retries are spent, the next attempt waits an hour, so a
    // receiving endpoint in a real outage (deploy, incident) still gets the
    // delivery once it recovers.
    expect(hookRetryDelayMs(HOOK_RETRY_ATTEMPTS - 1)).toBeGreaterThanOrEqual(3_600_000)
    expect(hookRetryDelayMs(HOOK_RETRY_ATTEMPTS - 1)).toBe(SLOW_RETRY_DELAY_MS)
  })

  it('has enough attempts for the slow retry to actually run', () => {
    // attempts counts total tries: first try + fast retries + the slow one.
    expect(HOOK_RETRY_ATTEMPTS).toBeGreaterThanOrEqual(4)
  })
})
