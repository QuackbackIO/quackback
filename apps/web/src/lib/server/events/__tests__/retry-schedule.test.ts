import { describe, it, expect } from 'vitest'
import { hookRetryDelayMs, HOOK_RETRY_ATTEMPTS } from '../retry-schedule'

const HOUR_MS = 3_600_000

describe('hookRetryDelayMs', () => {
  it('keeps the first retries fast so transient blips clear in seconds', () => {
    // Mid-band jitter draw exposes the base delays: 1s, 2s.
    const mid = () => 0.5
    expect(hookRetryDelayMs(1, mid)).toBe(1_000)
    expect(hookRetryDelayMs(2, mid)).toBe(2_000)
    for (const draw of [0, 0.999]) {
      expect(hookRetryDelayMs(1, () => draw)).toBeGreaterThanOrEqual(500)
      expect(hookRetryDelayMs(1, () => draw)).toBeLessThan(1_500)
      expect(hookRetryDelayMs(2, () => draw)).toBeGreaterThanOrEqual(1_000)
      expect(hookRetryDelayMs(2, () => draw)).toBeLessThan(3_000)
    }
  })

  it('jitters the fast retries, so jobs throttled together do not retry together', () => {
    // A bulk send that hits a provider rate limit fails dozens of jobs in the
    // same second; without a spread they all come back in the same second too.
    expect(hookRetryDelayMs(1, () => 0)).not.toBe(hookRetryDelayMs(1, () => 0.999))
    expect(hookRetryDelayMs(2, () => 0)).not.toBe(hookRetryDelayMs(2, () => 0.999))
  })

  it('spreads the slow retries at growing hourly intervals', () => {
    // Mid-band jitter draw exposes the base delays: 1h, 2h, 4h.
    const mid = () => 0.5
    expect(hookRetryDelayMs(3, mid)).toBe(HOUR_MS)
    expect(hookRetryDelayMs(4, mid)).toBe(2 * HOUR_MS)
    expect(hookRetryDelayMs(5, mid)).toBe(4 * HOUR_MS)
  })

  it('still has a retry pending roughly six hours after the first failure', () => {
    // Worst-case jitter (every draw at the floor) must keep the tail at or
    // past the six-hour mark, so an endpoint in a long incident still gets
    // the delivery once it recovers.
    const floor = () => 0
    const worstCaseSpan = [1, 2, 3, 4, 5].reduce((sum, n) => sum + hookRetryDelayMs(n, floor), 0)
    expect(worstCaseSpan).toBeGreaterThanOrEqual(6 * HOUR_MS)
  })

  it('lands the nominal tail around seven hours total', () => {
    const mid = () => 0.5
    const nominalSpan = [1, 2, 3, 4, 5].reduce((sum, n) => sum + hookRetryDelayMs(n, mid), 0)
    expect(nominalSpan).toBeGreaterThanOrEqual(6.5 * HOUR_MS)
    expect(nominalSpan).toBeLessThanOrEqual(8 * HOUR_MS)
  })

  it('jitters identical attempts so fleet-wide failures do not retry in lockstep', () => {
    expect(hookRetryDelayMs(4, () => 0)).not.toBe(hookRetryDelayMs(4, () => 0.999))
  })

  it('has enough attempts for the full tail to run', () => {
    // attempts counts total tries: first try + two fast retries + three slow ones.
    expect(HOOK_RETRY_ATTEMPTS).toBe(6)
  })
})
