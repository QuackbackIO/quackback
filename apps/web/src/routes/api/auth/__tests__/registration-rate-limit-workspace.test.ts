/**
 * The dynamic-client-registration budget is a per-workspace resource. Counted
 * process-wide, one address exhausts every workspace's allowance at once — and
 * the refusal it causes elsewhere is indistinguishable from a legitimate one.
 */
import { describe, it, expect } from 'vitest'

const { isRegistrationRateLimited } = await import('../$')
const { withWorkspace } = await import('@/lib/server/__tests__/workspace-scope')

const REG_MAX = 10

function request(ip: string): Request {
  return new Request('https://app.example.com/api/auth/oauth2/register', {
    method: 'POST',
    headers: { 'cf-connecting-ip': ip },
  })
}

/** Spend the whole window for `ip` inside `workspaceKey`. Returns the last verdict. */
function exhaust(workspaceKey: string, ip: string): boolean {
  let limited = false
  withWorkspace(workspaceKey, () => {
    for (let i = 0; i <= REG_MAX; i += 1) limited = isRegistrationRateLimited(request(ip))
  })
  return limited
}

describe('registration rate limit', () => {
  it('does not spend another workspace budget', () => {
    const ip = '203.0.113.11'

    expect(exhaust('workspace-alpha', ip)).toBe(true)
    expect(withWorkspace('workspace-bravo', () => isRegistrationRateLimited(request(ip)))).toBe(
      false
    )
  })

  it('does not spend the budget in the other direction either', () => {
    const ip = '203.0.113.12'

    expect(exhaust('workspace-bravo', ip)).toBe(true)
    expect(withWorkspace('workspace-alpha', () => isRegistrationRateLimited(request(ip)))).toBe(
      false
    )
  })

  it('leaves an unscoped process unaffected by a workspace exhausting its window', () => {
    const ip = '203.0.113.13'

    expect(exhaust('workspace-alpha', ip)).toBe(true)
    expect(isRegistrationRateLimited(request(ip))).toBe(false)
  })

  it('still limits within one workspace', () => {
    const ip = '203.0.113.14'

    expect(withWorkspace('workspace-charlie', () => isRegistrationRateLimited(request(ip)))).toBe(
      false
    )
    expect(exhaust('workspace-charlie', ip)).toBe(true)
  })
})
