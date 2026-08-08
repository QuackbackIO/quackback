/**
 * The dynamic-client-registration budget is a per-workspace resource. Counted
 * process-wide, one address exhausts every workspace's allowance at once — and
 * the refusal it causes elsewhere is indistinguishable from a legitimate one.
 */
import { describe, it, expect } from 'vitest'

const { isRegistrationRateLimited } = await import('../$')
const { withTenant } = await import('@/lib/server/__tests__/tenant-scope')

const REG_MAX = 10

function request(ip: string): Request {
  return new Request('https://app.example.com/api/auth/oauth2/register', {
    method: 'POST',
    headers: { 'cf-connecting-ip': ip },
  })
}

/** Spend the whole window for `ip` inside `tenantId`. Returns the last verdict. */
function exhaust(tenantId: string, ip: string): boolean {
  let limited = false
  withTenant(tenantId, () => {
    for (let i = 0; i <= REG_MAX; i += 1) limited = isRegistrationRateLimited(request(ip))
  })
  return limited
}

describe('registration rate limit', () => {
  it('does not spend another tenant budget', () => {
    const ip = '203.0.113.11'

    expect(exhaust('tenant-alpha', ip)).toBe(true)
    expect(withTenant('tenant-bravo', () => isRegistrationRateLimited(request(ip)))).toBe(false)
  })

  it('does not spend the budget in the other direction either', () => {
    const ip = '203.0.113.12'

    expect(exhaust('tenant-bravo', ip)).toBe(true)
    expect(withTenant('tenant-alpha', () => isRegistrationRateLimited(request(ip)))).toBe(false)
  })

  it('leaves an unscoped process unaffected by a tenant exhausting its window', () => {
    const ip = '203.0.113.13'

    expect(exhaust('tenant-alpha', ip)).toBe(true)
    expect(isRegistrationRateLimited(request(ip))).toBe(false)
  })

  it('still limits within one tenant', () => {
    const ip = '203.0.113.14'

    expect(withTenant('tenant-charlie', () => isRegistrationRateLimited(request(ip)))).toBe(false)
    expect(exhaust('tenant-charlie', ip)).toBe(true)
  })
})
