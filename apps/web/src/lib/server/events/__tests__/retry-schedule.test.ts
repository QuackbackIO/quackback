import { describe, it, expect } from 'vitest'
import { hookRetryDelayMs, HOOK_RETRY_ATTEMPTS } from '../retry-schedule'

const HOUR_MS = 3_600_000

describe('hookRetryDelayMs', () => {
  it('keeps the first retries fast so transient blips clear in seconds', () => {
    expect(hookRetryDelayMs(1)).toBe(1_000)
    expect(hookRetryDelayMs(2)).toBe(2_000)
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
