/**
 * Connecting GitHub before its platform credentials exist is a setup step the
 * admin has not done yet, not a server fault: it must fail as a typed 4xx so
 * the server-function log records it at warn.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ValidationError } from '@/lib/shared/errors'
import { classifyServerFnError } from '@/lib/server/middleware/server-fn-log'

vi.mock('@tanstack/react-start', async (importOriginal) => {
  const { withServerFnsInProcess } = await import('@/test/server-fns-in-process')
  return withServerFnsInProcess(await importOriginal())
})

const hasPlatformCredentials = vi.fn<(type: string) => Promise<boolean>>()

vi.mock('@/lib/server/functions/auth-helpers', () => ({
  requireAuth: vi.fn(async () => ({
    settings: { id: 'workspace_1' },
    principal: { id: 'principal_1' },
  })),
}))
vi.mock('@/lib/server/domains/platform-credentials/platform-credential.service', () => ({
  hasPlatformCredentials: (type: string) => hasPlatformCredentials(type),
}))
vi.mock('@/lib/server/config', () => ({ config: { baseUrl: 'https://feedback.example.com' } }))
vi.mock('@/lib/server/auth/oauth-state', () => ({ signOAuthState: () => 'signed-state' }))

const { getGitHubConnectUrl } = await import('../functions')

describe('getGitHubConnectUrl', () => {
  beforeEach(() => hasPlatformCredentials.mockReset())

  it('rejects with a typed 4xx when the platform credentials are not configured', async () => {
    hasPlatformCredentials.mockResolvedValue(false)

    const error = await getGitHubConnectUrl().then(
      () => undefined,
      (e: unknown) => e
    )

    expect(hasPlatformCredentials).toHaveBeenCalledWith('github')
    expect(error).toBeInstanceOf(ValidationError)
    expect((error as ValidationError).statusCode).toBe(400)
    expect((error as ValidationError).code).toBe('PLATFORM_CREDENTIALS_NOT_CONFIGURED')
    expect(classifyServerFnError(error)).toBe('warn')
  })

  it('returns the connect URL once they are', async () => {
    hasPlatformCredentials.mockResolvedValue(true)
    await expect(getGitHubConnectUrl()).resolves.toBe('/oauth/github/connect?state=signed-state')
  })
})
