/**
 * Pure SSO-gate predicates — the freshness rule shared by "enable SSO"
 * and "enforce per-domain". The contract:
 *
 *   - a successful test sign-in only counts if it postdates the last
 *     connection-details change (`detailsChangedAt`)
 *   - enforcement additionally accepts a real team SSO sign-in under
 *     the same postdates-the-change rule
 *   - a missing `detailsChangedAt` means "never recorded a change"
 *     (config predates the feature) — don't retroactively invalidate
 */
import { describe, it, expect } from 'vitest'
import { isSsoTestValid, isSsoEnforcementUnlocked } from '../sso-gates'
import type { AuthConfig } from '@/lib/server/domains/settings/settings.types'

type Sso = NonNullable<AuthConfig['ssoOidc']>

const base: Sso = {
  enabled: false,
  discoveryUrl: 'https://idp.example/.well-known/openid-configuration',
  clientId: 'cid',
  autoCreateUsers: false,
}

const T0 = '2026-05-10T00:00:00.000Z' // earlier
const T1 = '2026-05-12T00:00:00.000Z' // later

describe('isSsoTestValid', () => {
  it('returns false when sso is undefined', () => {
    expect(isSsoTestValid(undefined)).toBe(false)
  })

  it('returns false when there is no successful test on record', () => {
    expect(isSsoTestValid(base)).toBe(false)
    expect(isSsoTestValid({ ...base, detailsChangedAt: T0 })).toBe(false)
  })

  it('returns true when a test exists and no details change was ever recorded', () => {
    // Config predates the feature — don't retroactively invalidate it.
    expect(isSsoTestValid({ ...base, lastSuccessfulTestAt: T0 })).toBe(true)
  })

  it('returns true when the test postdates the last details change', () => {
    expect(isSsoTestValid({ ...base, detailsChangedAt: T0, lastSuccessfulTestAt: T1 })).toBe(true)
  })

  it('returns false when the test predates the last details change', () => {
    expect(isSsoTestValid({ ...base, detailsChangedAt: T1, lastSuccessfulTestAt: T0 })).toBe(false)
  })

  it('returns false when test and change are the same instant (must be strictly after)', () => {
    expect(isSsoTestValid({ ...base, detailsChangedAt: T0, lastSuccessfulTestAt: T0 })).toBe(false)
  })

  it('returns false when timestamps are unparseable', () => {
    expect(isSsoTestValid({ ...base, lastSuccessfulTestAt: 'not-a-date' })).toBe(false)
  })
})

describe('isSsoEnforcementUnlocked', () => {
  it('returns true when the test sign-in alone is valid (real sign-in irrelevant)', () => {
    expect(
      isSsoEnforcementUnlocked({ ...base, detailsChangedAt: T0, lastSuccessfulTestAt: T1 }, null)
    ).toBe(true)
  })

  it('returns true when no valid test but a real team sign-in postdates the change', () => {
    expect(isSsoEnforcementUnlocked({ ...base, detailsChangedAt: T0 }, T1)).toBe(true)
  })

  it('accepts a Date instance for the real sign-in timestamp', () => {
    expect(isSsoEnforcementUnlocked({ ...base, detailsChangedAt: T0 }, new Date(T1))).toBe(true)
  })

  it('returns false when the real sign-in predates the last details change', () => {
    expect(isSsoEnforcementUnlocked({ ...base, detailsChangedAt: T1 }, T0)).toBe(false)
  })

  it('returns false when there is neither a valid test nor a real sign-in', () => {
    expect(isSsoEnforcementUnlocked({ ...base, detailsChangedAt: T0 }, null)).toBe(false)
    expect(isSsoEnforcementUnlocked(undefined, null)).toBe(false)
  })

  it('returns true when a real sign-in exists and no details change was ever recorded', () => {
    expect(isSsoEnforcementUnlocked(base, T0)).toBe(true)
  })

  it('stale test still passes when a fresh real sign-in covers it (OR semantics)', () => {
    // test is stale (predates change) but a real sign-in postdates it
    expect(
      isSsoEnforcementUnlocked(
        { ...base, detailsChangedAt: T1, lastSuccessfulTestAt: T0 },
        '2026-05-13T00:00:00.000Z'
      )
    ).toBe(true)
  })
})
