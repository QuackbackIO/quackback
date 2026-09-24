/**
 * The after-hook's two request-identity duties: forget the memoized identity
 * once an in-process endpoint may have changed it, and sign the session JWT
 * only for a `/get-session` that goes back over the wire.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

// The middleware factory is identity, so `hooksAfter` is directly callable.
vi.mock('better-auth/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('better-auth/api')>()),
  createAuthMiddleware: (fn: (ctx: unknown) => Promise<void>) => fn,
}))

const mockGetJwtToken = vi.fn(async (_ctx: unknown) => 'signed.jwt.token')
vi.mock('better-auth/plugins', () => ({
  getJwtToken: (ctx: unknown) => mockGetJwtToken(ctx),
}))

vi.mock('@tanstack/react-start/server', () => ({
  getRequestHeaders: () => new Headers(),
}))

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: { query: {} },
}))

vi.mock('@/lib/server/domains/settings/settings.service', () => ({
  getWorkspaceSettings: vi.fn(async () => null),
  getPublicPortalConfig: vi.fn(),
}))

vi.mock('@/lib/server/auth/signin-rate-limit', () => ({
  checkCredentialSignInRateLimit: vi.fn(),
  checkMagicLinkSendRateLimit: vi.fn(),
}))

vi.mock('@/lib/server/auth/widget-rate-limit', () => ({
  checkAnonMintRateLimit: vi.fn(),
}))

vi.mock('@/lib/server/audit/log', () => ({
  recordAuditEvent: vi.fn(),
}))

vi.mock('@/lib/server/domains/principals/bootstrap-admin', () => ({
  findHumanAdmin: vi.fn(),
  isOpenToBootstrapClaim: vi.fn(),
}))

vi.mock('@/lib/server/domains/settings/identity-providers.service', () => ({
  listIdentityProviders: vi.fn(async () => []),
}))

vi.mock('@/lib/server/auth/registered-providers', () => ({
  getRegisteredOidcProviderIds: vi.fn(async () => new Set()),
}))

const { hooksAfter } = (await import('../hooks')) as unknown as {
  hooksAfter: (ctx: unknown) => Promise<void>
}
const { runWithLogContext } = await import('@/lib/server/log-context')
const { memoizePerRequest } = await import('@/lib/server/request-memo')
const { IDENTITY_MEMO_PREFIX } = await import('../request-session')

beforeEach(() => {
  vi.clearAllMocks()
})

describe('hooksAfter and the request identity memo', () => {
  async function sessionReadsAround(path: string): Promise<number> {
    let reads = 0
    const read = () => memoizePerRequest(`${IDENTITY_MEMO_PREFIX}session`, async () => ++reads)
    await runWithLogContext({ request_id: `memo:${path}` }, async () => {
      await read()
      await hooksAfter({ path, params: {}, body: {}, context: {} })
      await read()
    })
    return reads
  }

  it('forgets the identity after an endpoint that can change it', async () => {
    expect(await sessionReadsAround('/sign-out')).toBe(2)
    expect(await sessionReadsAround('/revoke-sessions')).toBe(2)
    expect(await sessionReadsAround('/update-user')).toBe(2)
  })

  it('keeps it across a session read', async () => {
    expect(await sessionReadsAround('/get-session')).toBe(1)
  })
})

describe('hooksAfter and the session JWT header', () => {
  function getSessionCtx(opts: { overHttp: boolean; signedIn: boolean; expose?: string }) {
    const responseHeaders = new Headers()
    if (opts.expose) responseHeaders.set('access-control-expose-headers', opts.expose)
    const setHeader = vi.fn((name: string, value: string) => responseHeaders.set(name, value))
    return {
      ctx: {
        path: '/get-session',
        params: {},
        body: {},
        ...(opts.overHttp && { request: new Request('http://localhost/api/auth/get-session') }),
        context: {
          session: opts.signedIn ? { session: { id: 's1' }, user: { id: 'u1' } } : null,
          responseHeaders,
        },
        setHeader,
      },
      setHeader,
    }
  }

  it('signs one for a signed-in /get-session over HTTP, as the plugin would', async () => {
    const { ctx, setHeader } = getSessionCtx({ overHttp: true, signedIn: true, expose: 'x-a' })
    await hooksAfter(ctx)
    expect(mockGetJwtToken).toHaveBeenCalledWith(ctx)
    expect(setHeader).toHaveBeenCalledWith('set-auth-jwt', 'signed.jwt.token')
    expect(setHeader).toHaveBeenCalledWith('Access-Control-Expose-Headers', 'x-a, set-auth-jwt')
  })

  it('skips the signature for an in-process session read', async () => {
    const { ctx, setHeader } = getSessionCtx({ overHttp: false, signedIn: true })
    await hooksAfter(ctx)
    expect(mockGetJwtToken).not.toHaveBeenCalled()
    expect(setHeader).not.toHaveBeenCalled()
  })

  it('skips it when there is no session', async () => {
    const { ctx } = getSessionCtx({ overHttp: true, signedIn: false })
    await hooksAfter(ctx)
    expect(mockGetJwtToken).not.toHaveBeenCalled()
  })
})
