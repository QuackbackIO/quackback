/**
 * The dynamic-client-registration budget is a per-workspace resource. Counted
 * process-wide, one address exhausts every workspace's allowance at once — and
 * the refusal it causes elsewhere is indistinguishable from a legitimate one.
 */
import { describe, it, expect, vi } from 'vitest'

const { mockGetRequestIP } = vi.hoisted(() => ({ mockGetRequestIP: vi.fn() }))
vi.mock('@tanstack/react-start/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-start/server')>()),
  getRequestIP: mockGetRequestIP,
}))

const { isRegistrationRateLimited, REG_MAX } = await import('../$')
const { withWorkspace } = await import('@/lib/server/__tests__/workspace-scope')

/** A registration from socket peer `ip`, carrying whatever headers the client chose. */
function request(ip: string, headers: Record<string, string> = {}): Request {
  mockGetRequestIP.mockReturnValue(ip)
  return new Request('https://app.example.com/api/auth/oauth2/register', {
    method: 'POST',
    headers,
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

  it('does not let a forwarding header buy a fresh budget', () => {
    const ip = '203.0.113.15'

    expect(exhaust('workspace-delta', ip)).toBe(true)
    expect(
      withWorkspace('workspace-delta', () =>
        isRegistrationRateLimited(
          request(ip, { 'x-forwarded-for': '9.9.9.9', 'cf-connecting-ip': '9.9.9.8' })
        )
      )
    ).toBe(true)
  })
})
