import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PERMISSIONS } from '@/lib/shared/permissions'

vi.mock('@tanstack/react-start', async (importOriginal) => {
  const { withServerFnsInProcess } = await import('@/test/server-fns-in-process')
  return withServerFnsInProcess(await importOriginal())
})
const m = vi.hoisted(() => ({ auth: vi.fn(), credentials: vi.fn(), sign: vi.fn() }))
vi.mock('@/lib/server/functions/auth-helpers', () => ({ requireAuth: m.auth }))
vi.mock('@/lib/server/domains/platform-credentials/platform-credential.service', () => ({
  hasPlatformCredentials: m.credentials,
}))
vi.mock('@/lib/server/config', () => ({ config: { baseUrl: 'https://feedback.example.com' } }))
vi.mock('@/lib/server/auth/oauth-state', () => ({ signOAuthState: m.sign }))
const { getSlackConnectUrl } = await import('../functions')

beforeEach(() => {
  vi.resetAllMocks()
  m.auth.mockResolvedValue({ settings: { id: 'workspace_1' }, principal: { id: 'principal_1' } })
  m.credentials.mockResolvedValue(true)
  m.sign.mockReturnValue('signed-state')
})
describe('Slack signed reconnect URL', () => {
  it('uses the authenticated workspace and principal in a fresh signed state', async () => {
    await expect(getSlackConnectUrl()).resolves.toBe('/oauth/slack/connect?state=signed-state')
    expect(m.auth).toHaveBeenCalledWith({ permission: PERMISSIONS.INTEGRATION_MANAGE })
    expect(m.sign).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'slack_oauth',
        workspaceId: 'workspace_1',
        principalId: 'principal_1',
        returnDomain: 'feedback.example.com',
        nonce: expect.any(String),
        ts: expect.any(Number),
      })
    )
  })
  it('does not sign a URL when the caller lacks integration management permission', async () => {
    m.auth.mockRejectedValue(new Error('Forbidden'))
    await expect(getSlackConnectUrl()).rejects.toThrow('Forbidden')
    expect(m.sign).not.toHaveBeenCalled()
    expect(m.credentials).not.toHaveBeenCalled()
  })
  it('does not sign a URL before platform credentials have been configured', async () => {
    m.credentials.mockResolvedValue(false)
    await expect(getSlackConnectUrl()).rejects.toMatchObject({
      code: 'PLATFORM_CREDENTIALS_NOT_CONFIGURED',
    })
    expect(m.sign).not.toHaveBeenCalled()
  })
})
