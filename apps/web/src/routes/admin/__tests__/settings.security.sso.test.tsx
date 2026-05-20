import { describe, it, expect, vi } from 'vitest'

const mockRequireWorkspaceRole = vi.fn(async (_input: unknown) => undefined)
vi.mock('@/lib/server/functions/workspace-utils', () => ({
  requireWorkspaceRole: (input: unknown) => mockRequireWorkspaceRole(input),
}))

const mockEnsureQueryData = vi.fn(async () => undefined)

const { Route } = await import('../settings.security.sso')

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type LoaderFn = (ctx: any) => Promise<unknown>

describe('settings.security.sso route', () => {
  it('requires admin role', async () => {
    await (Route.options.loader as LoaderFn)({
      context: { queryClient: { ensureQueryData: mockEnsureQueryData } },
    })
    expect(mockRequireWorkspaceRole).toHaveBeenCalledWith({
      data: { allowedRoles: ['admin'] },
    })
  })

  it('prefetches authConfig, verifiedDomains, ssoStatus, recoveryCodes', async () => {
    mockEnsureQueryData.mockClear()
    await (Route.options.loader as LoaderFn)({
      context: { queryClient: { ensureQueryData: mockEnsureQueryData } },
    })
    expect(mockEnsureQueryData).toHaveBeenCalledTimes(4)
  })
})
