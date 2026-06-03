/**
 * GET /api/v1/apps/boards must pass the authenticated team actor to
 * listPublicBoardsWithStats — otherwise the call defaults to
 * ANONYMOUS_ACTOR and the team caller sees only public boards instead
 * of all the boards they're entitled to.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { PrincipalId } from '@quackback/ids'

const mockListPublicBoardsWithStats = vi.fn()
const mockWithApiKeyAuth = vi.fn()

vi.mock('@/lib/server/domains/api/auth', () => ({
  withApiKeyAuth: (...args: unknown[]) => mockWithApiKeyAuth(...args),
}))
vi.mock('@/lib/server/integrations/apps/cors', () => ({
  appJsonResponse: (body: unknown) => ({ body }),
  preflightResponse: () => ({}),
}))
vi.mock('@/lib/server/domains/api/responses', () => ({
  handleDomainError: (e: unknown) => ({ error: String(e) }),
}))
vi.mock('@/lib/server/domains/boards/board.public', () => ({
  listPublicBoardsWithStats: (...args: unknown[]) => mockListPublicBoardsWithStats(...args),
}))

beforeEach(() => {
  vi.clearAllMocks()
  mockListPublicBoardsWithStats.mockResolvedValue([])
})

describe('GET /api/v1/apps/boards — actor pass-through', () => {
  it('passes a team-role actor (not ANONYMOUS_ACTOR) when called with a member-role API key', async () => {
    mockWithApiKeyAuth.mockResolvedValue({
      apiKey: { id: 'key_1' },
      principalId: 'prn_test' as PrincipalId,
      role: 'member',
      importMode: false,
    })
    const mod = await import('../boards')
    const handler = (
      mod.Route.options as unknown as {
        server: { handlers: { GET: (ctx: { request: Request }) => Promise<unknown> } }
      }
    ).server.handlers.GET

    await handler({ request: new Request('http://test/api/v1/apps/boards') })

    expect(mockListPublicBoardsWithStats).toHaveBeenCalledOnce()
    const actorArg = mockListPublicBoardsWithStats.mock.calls[0][0]
    expect(actorArg).toBeDefined()
    // Must NOT be the empty anonymous actor — role + principalId carry through.
    expect(actorArg.role).toBe('member')
    expect(actorArg.principalId).toBe('prn_test')
  })

  it('passes the admin role through when called with an admin API key', async () => {
    mockWithApiKeyAuth.mockResolvedValue({
      apiKey: { id: 'key_admin' },
      principalId: 'prn_admin' as PrincipalId,
      role: 'admin',
      importMode: false,
    })
    const mod = await import('../boards')
    const handler = (
      mod.Route.options as unknown as {
        server: { handlers: { GET: (ctx: { request: Request }) => Promise<unknown> } }
      }
    ).server.handlers.GET
    await handler({ request: new Request('http://test/api/v1/apps/boards') })
    const actorArg = mockListPublicBoardsWithStats.mock.calls[0][0]
    expect(actorArg.role).toBe('admin')
  })
})
