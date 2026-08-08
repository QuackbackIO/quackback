/**
 * Tenant separation of the process-lifetime state in `auth/index.ts`.
 *
 * Two things live here that a pooled process cannot share: the credential
 * stashes the plugin callbacks write (keyed by a lowercased email address,
 * which is not unique across workspaces) and the rate-limit counters the
 * library keys by IP and path.
 *
 * Every stash assertion runs in BOTH orders. The stash is last-writer-wins, so
 * a one-directional test passes as soon as the surviving value happens to be
 * the one it read.
 */
import { describe, it, expect } from 'vitest'

const { storeOTP, getOTP, tenantRateLimitStorage, __resetRateLimitCountersForTenant } =
  await import('../index')
const { withTenant } = await import('@/lib/server/__tests__/tenant-scope')

const SHARED_ADDRESS = 'admin@example.com'

describe('OTP stash', () => {
  it('keeps two tenants apart for the same address, alpha first', () => {
    withTenant('tenant-alpha', () => storeOTP('sign-in', SHARED_ADDRESS, 'alpha-code'))
    withTenant('tenant-bravo', () => storeOTP('sign-in', SHARED_ADDRESS, 'bravo-code'))

    expect(withTenant('tenant-alpha', () => getOTP('sign-in', SHARED_ADDRESS))).toBe('alpha-code')
    expect(withTenant('tenant-bravo', () => getOTP('sign-in', SHARED_ADDRESS))).toBe('bravo-code')
  })

  it('keeps two tenants apart for the same address, bravo first', () => {
    withTenant('tenant-bravo', () => storeOTP('sign-in', SHARED_ADDRESS, 'bravo-code-2'))
    withTenant('tenant-alpha', () => storeOTP('sign-in', SHARED_ADDRESS, 'alpha-code-2'))

    expect(withTenant('tenant-bravo', () => getOTP('sign-in', SHARED_ADDRESS))).toBe('bravo-code-2')
    expect(withTenant('tenant-alpha', () => getOTP('sign-in', SHARED_ADDRESS))).toBe('alpha-code-2')
  })

  it('does not hand a tenant a code stashed with no tenant scope', () => {
    storeOTP('sign-in', SHARED_ADDRESS, 'unscoped-code')

    expect(withTenant('tenant-alpha', () => getOTP('sign-in', SHARED_ADDRESS))).toBeUndefined()
    expect(getOTP('sign-in', SHARED_ADDRESS)).toBe('unscoped-code')
  })

  it('still drains once — a taken code is gone for its own tenant', () => {
    withTenant('tenant-alpha', () => storeOTP('sign-in', SHARED_ADDRESS, 'once'))

    expect(withTenant('tenant-alpha', () => getOTP('sign-in', SHARED_ADDRESS))).toBe('once')
    expect(withTenant('tenant-alpha', () => getOTP('sign-in', SHARED_ADDRESS))).toBeUndefined()
  })

  it('keeps purpose separation inside one tenant', () => {
    withTenant('tenant-alpha', () => {
      storeOTP('sign-in', SHARED_ADDRESS, 'signin-code')
      storeOTP('change-email', SHARED_ADDRESS, 'change-code')
    })

    expect(withTenant('tenant-alpha', () => getOTP('change-email', SHARED_ADDRESS))).toBe(
      'change-code'
    )
    expect(withTenant('tenant-alpha', () => getOTP('sign-in', SHARED_ADDRESS))).toBe('signin-code')
  })
})

describe('rate-limit counters', () => {
  const key = '203.0.113.9/sign-in/email'

  it('counts each tenant separately for the same IP and path', async () => {
    await withTenant('tenant-alpha', async () => {
      __resetRateLimitCountersForTenant()
      await tenantRateLimitStorage.set(key, { key, count: 3, lastRequest: 1_000 })
    })
    await withTenant('tenant-bravo', async () => {
      __resetRateLimitCountersForTenant()
      await tenantRateLimitStorage.set(key, { key, count: 1, lastRequest: 2_000 })
    })

    const alpha = await withTenant('tenant-alpha', () => tenantRateLimitStorage.get(key))
    const bravo = await withTenant('tenant-bravo', () => tenantRateLimitStorage.get(key))

    expect(alpha?.count).toBe(3)
    expect(bravo?.count).toBe(1)
  })

  it('does not let one tenant see another tenant-only counter', async () => {
    await withTenant('tenant-charlie', async () => {
      __resetRateLimitCountersForTenant()
      await tenantRateLimitStorage.set(key, { key, count: 9, lastRequest: 5_000 })
    })

    expect(await withTenant('tenant-delta', () => tenantRateLimitStorage.get(key))).toBeNull()
  })
})
