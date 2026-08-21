/**
 * Refusals a retry cannot fix.
 *
 * The measured defect: a tenant whose `appSecretsRef` names a store this build
 * has no resolver for was reconnected once per second, holding the busiest
 * compute in the fleet at 70% active for zero work. The two properties that
 * matter are therefore opposites and both are asserted — a terminal refusal must
 * stop being retried, and a transient one must keep being retried, because a
 * classifier that called everything terminal would "fix" the storm by taking the
 * fleet down.
 */
import { afterEach, describe, expect, it } from 'vitest'
import {
  __resetQuarantineForTests,
  classifyRefusal,
  isTenantQuarantined,
  listQuarantinedTenants,
  noteTenantRefusal,
  noteTenantServed,
  quarantineRetryAt,
  refusalCode,
} from '../quarantine'

afterEach(() => __resetQuarantineForTests())

const t = (revision = 1) => ({ tenantId: 'inst_a', revision })

describe('classification', () => {
  it('calls the measured failure terminal', () => {
    expect(classifyRefusal('app_secret_no_resolver')).toBe('terminal')
  })

  it('derives the identity codes from the fingerprint map rather than restating them', () => {
    // If `IDENTITY_FAILURE_SUBJECT` gains a code, this picks it up; a
    // hand-maintained second list would not.
    expect(classifyRefusal('workspace_id_mismatch')).toBe('terminal')
    expect(classifyRefusal('secret_key_canary_mismatch')).toBe('terminal')
  })

  it('calls a compute that is still starting transient', () => {
    expect(classifyRefusal('CONNECT_TIMEOUT')).toBe('transient')
    expect(classifyRefusal('57P03')).toBe('transient')
    // A rotation heals a bad password without any record change.
    expect(classifyRefusal('28P01')).toBe('transient')
  })

  it('treats an unrecognised code as transient, not terminal', () => {
    // Fail-open on retrying: an unknown terminal failure costs a bounded
    // backoff, an unknown transient one wrongly quarantined costs a tenant its
    // service until a human notices.
    expect(classifyRefusal('something_new')).toBe('transient')
  })

  it('finds a code on every shape the refusal paths throw', () => {
    expect(refusalCode(Object.assign(new Error('x'), { code: 'app_secret_no_resolver' }))).toBe(
      'app_secret_no_resolver'
    )
    expect(refusalCode(new Error('no code'))).toBe('pool_unavailable')
    expect(refusalCode(null)).toBe('pool_unavailable')
  })
})

describe('the wait each disposition earns', () => {
  it('holds a terminal refusal off for the whole rescan interval', () => {
    const now = Date.now()
    const entry = noteTenantRefusal(t(), 'app_secret_no_resolver', 'no resolver')
    expect(entry.disposition).toBe('terminal')
    // Default rescan interval is 15 minutes; the point is that it is minutes
    // rather than the poll interval, not the exact figure.
    expect(entry.retryAfter - now).toBeGreaterThan(60_000)
    expect(isTenantQuarantined(t())).toBe(true)
  })

  it('backs a transient refusal off geometrically rather than skipping it', () => {
    const first = noteTenantRefusal(t(), 'CONNECT_TIMEOUT', 'slow')
    const second = noteTenantRefusal(t(), 'CONNECT_TIMEOUT', 'slow')
    const third = noteTenantRefusal(t(), 'CONNECT_TIMEOUT', 'slow')
    expect(second.retryAfter - second.lastRefusedAt).toBeGreaterThan(
      first.retryAfter - first.lastRefusedAt
    )
    expect(third.attempts).toBe(3)
    // And it does come back: the wait is bounded, not permanent.
    expect(third.retryAfter - third.lastRefusedAt).toBeLessThanOrEqual(60_000)
  })

  it('lets a quarantined tenant be retried once its wait has elapsed', () => {
    const entry = noteTenantRefusal(t(), 'CONNECT_TIMEOUT', 'slow')
    expect(isTenantQuarantined(t(), entry.retryAfter - 1)).toBe(true)
    expect(isTenantQuarantined(t(), entry.retryAfter + 1)).toBe(false)
  })

  it('exposes the retry instant so a detached loop sleeps instead of polling', () => {
    const entry = noteTenantRefusal(t(), 'app_secret_no_resolver', 'no resolver')
    expect(quarantineRetryAt('inst_a')).toBe(entry.retryAfter)
    expect(quarantineRetryAt('inst_never_refused')).toBeNull()
  })
})

describe('what releases a tenant', () => {
  it('retries immediately when the registry record changes', () => {
    noteTenantRefusal(t(1), 'app_secret_no_resolver', 'no resolver')
    expect(isTenantQuarantined(t(1))).toBe(true)
    // Any write to the record bumps `revision`, including the hand-run UPDATE
    // that repairs it — so this is the signal a fix has landed.
    expect(isTenantQuarantined(t(2))).toBe(false)
    expect(listQuarantinedTenants()).toEqual([])
  })

  it('starts the backoff again rather than carrying one the old record earned', () => {
    noteTenantRefusal(t(1), 'CONNECT_TIMEOUT', 'slow')
    noteTenantRefusal(t(1), 'CONNECT_TIMEOUT', 'slow')
    const afterChange = noteTenantRefusal(t(2), 'CONNECT_TIMEOUT', 'slow')
    expect(afterChange.attempts).toBe(1)
  })

  it('clears on a tenant that is served again', () => {
    noteTenantRefusal(t(), 'CONNECT_TIMEOUT', 'slow')
    noteTenantServed('inst_a')
    expect(listQuarantinedTenants()).toEqual([])
  })
})

describe('a refused tenant stays visible', () => {
  it('keeps reporting a tenant it has stopped retrying', () => {
    // The requirement that makes quarantine safe: not being retried must never
    // mean not being mentioned.
    noteTenantRefusal(t(), 'app_secret_no_resolver', 'no resolver')
    const listed = listQuarantinedTenants()
    expect(listed).toHaveLength(1)
    expect(listed[0]).toMatchObject({
      tenantId: 'inst_a',
      code: 'app_secret_no_resolver',
      disposition: 'terminal',
    })
  })
})
