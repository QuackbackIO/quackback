/**
 * The request boundary for audit attribution: a signed-in server function is
 * attributed to the app (`ui`), and every other request opens an empty slot
 * that a credential boundary inside the handler (REST key auth) fills. A REST
 * write made with a key is recorded once, here, as `api.write`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ApiKey } from '@/lib/server/domains/api-keys'
import type { ApiKeyId, PrincipalId } from '@quackback/ids'
import type { PermissionKey } from '@/lib/shared/permissions'

vi.mock('@/lib/server/config', () => ({ config: { trustedProxyHops: 1 } }))

const mockInsertValues = vi.fn()
const mockOnConflictDoUpdate = vi.fn()
vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: {
    insert: () => ({
      values: (...args: unknown[]) => {
        const inserted = mockInsertValues(...args)
        // A plain insert awaits this; a summary row goes on to its upsert.
        return {
          then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
            Promise.resolve(inserted).then(resolve, reject),
          onConflictDoUpdate: (...upsert: unknown[]) => {
            mockOnConflictDoUpdate(...upsert)
            return Promise.resolve(inserted)
          },
        }
      },
    }),
  },
}))

const mockVerifyApiKey = vi.fn()
// The key's authority against its creator's access is covered against real
// Postgres elsewhere; here it is stubbed to a role's full preset.
const mockAuthority = vi.fn()
vi.mock('@/lib/server/domains/api-keys/api-key-authority', () => ({
  resolveApiKeyAuthority: (...args: unknown[]) => mockAuthority(...args),
}))
vi.mock('@/lib/server/domains/api-keys/api-key.service', () => ({
  verifyApiKey: (...args: unknown[]) => mockVerifyApiKey(...args),
}))
vi.mock('@/lib/server/domains/api/rate-limit', () => ({
  checkRateLimit: vi.fn(async () => ({ allowed: true, remaining: 100 })),
  getClientIp: vi.fn(() => '203.0.113.9'),
  hasRecentApiKeyFailure: vi.fn(async () => false),
  recordApiKeyFailure: vi.fn(async () => undefined),
  apiRateLimitRetryAfter: vi.fn(async () => 60),
}))

const mockLogError = vi.fn()
vi.mock('@/lib/server/logger', () => ({
  logger: {
    child: () => ({
      error: (...args: unknown[]) => mockLogError(...args),
      warn: vi.fn(),
      info: vi.fn(),
      debug: vi.fn(),
    }),
  },
}))

const { handleRequestWithAuditAttribution } = await import('@/lib/server/audit/request-boundary')
const { recordAuditEvent } = await import('@/lib/server/audit/log')
const { setAuditAttribution, getAuditAttribution } = await import('@/lib/server/audit/attribution')
const { withApiKeyAuth } = await import('@/lib/server/domains/api/auth')
const { createdResponse, successResponse, handleDomainError, noContentResponse } =
  await import('@/lib/server/domains/api/responses')
const { PERMISSIONS } = await import('@/lib/shared/permissions')
const { resolveActorPermissions } = await import('@/lib/server/policy/permissions')

/** The key resolves to the full preset of `role`, as for a creator holding it. */
function keyRole(role: 'admin' | 'member') {
  mockAuthority.mockResolvedValue({
    principal: { role, type: 'service', user: null },
    owner: null,
    role,
    permissions: resolveActorPermissions(role),
  })
}

const CREATOR = 'principal_01h455vb4pex5vsknk084sn02r' as PrincipalId
const KEY: ApiKey = {
  id: 'api_key_01h455vb4pex5vsknk084sn02q' as ApiKeyId,
  name: 'Zapier',
  kind: 'personal' as const,
  keyPrefix: 'qb_test',
  principalId: 'principal_01h455vb4pex5vsknk084sn02s' as PrincipalId,
  createdById: CREATOR,
  createdAt: new Date(),
  lastUsedAt: null,
  expiresAt: null,
  revokedAt: null,
  scopes: null,
}
const POST_ID = 'post_01h455vb4pex5vsknk084sn02t'
const NEW_POST_ID = 'post_01h455vb4pex5vsknk084sn02v'

beforeEach(() => {
  vi.clearAllMocks()
  mockInsertValues.mockResolvedValue(undefined)
  mockVerifyApiKey.mockResolvedValue(KEY)
  keyRole('admin')
})

function request(method: string, path: string, headers: Record<string, string> = {}) {
  return new Request(`https://acme.example${path}`, { method, headers })
}

describe('audit attribution request boundary', () => {
  it('attributes changes made in a server function to the app', async () => {
    await handleRequestWithAuditAttribution({
      request: request('POST', '/_serverFn/abc'),
      handlerType: 'serverFn',
      next: async () => {
        await recordAuditEvent({ event: 'auth.password.disabled', actor: { email: 'a@b.com' } })
        return {}
      },
    })
    expect(mockInsertValues.mock.calls[0][0]).toMatchObject({ channel: 'ui', credentialKind: null })
  })

  it('opens an empty slot for other requests that a boundary inside the handler fills', async () => {
    const seen: unknown[] = []
    await handleRequestWithAuditAttribution({
      request: request('GET', '/api/widget/config'),
      handlerType: 'router',
      next: async () => {
        seen.push(getAuditAttribution())
        setAuditAttribution({ channel: 'api', clientName: 'Zapier' })
        await recordAuditEvent({ event: 'sso.config.changed', actor: { email: 'a@b.com' } })
        return {}
      },
    })
    expect(seen).toEqual([null])
    expect(mockInsertValues.mock.calls[0][0]).toMatchObject({
      channel: 'api',
      clientName: 'Zapier',
    })
  })

  it('never lets one request see another request’s attribution', async () => {
    const seen: unknown[] = []
    await handleRequestWithAuditAttribution({
      request: request('POST', '/api/v1/posts'),
      handlerType: 'router',
      next: async () => {
        setAuditAttribution({ channel: 'api', clientName: 'First' })
        return {}
      },
    })
    await handleRequestWithAuditAttribution({
      request: request('POST', '/api/widget/identify'),
      handlerType: 'router',
      next: async () => {
        seen.push(getAuditAttribution())
        return {}
      },
    })
    expect(seen).toEqual([null])
  })
})

describe('REST write auditing', () => {
  /** A key-authenticated route handler, the shape every /api/v1 route has. */
  const route =
    (respond: () => Response, permission: PermissionKey = PERMISSIONS.POST_CREATE) =>
    (request: Request) =>
    async () => {
      try {
        await withApiKeyAuth(request, { permission })
        return { response: respond() }
      } catch (error) {
        return { response: handleDomainError(error) }
      }
    }

  function keyed(method: string, path: string, body?: unknown, extra: Record<string, string> = {}) {
    return new Request(`https://acme.example${path}`, {
      method,
      headers: {
        authorization: 'Bearer qb_test_secret_value',
        'content-type': 'application/json',
        'user-agent': 'zapier/1.0',
        'x-request-id': 'req_42',
        ...extra,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  }

  it('counts import-mode writes into one summary row instead of a row each', async () => {
    const req = keyed('POST', '/api/v1/posts', {}, { 'x-import-mode': 'true' })
    const result = await serve(
      req,
      route(() => createdResponse({ id: NEW_POST_ID }))
    )

    expect(result.response?.status).toBe(201)
    expect(mockInsertValues).toHaveBeenCalledTimes(1)
    const row = mockInsertValues.mock.calls[0][0]
    expect(row).toMatchObject({
      eventType: 'api.import',
      eventOutcome: 'success',
      channel: 'api',
      credentialKind: 'api_key',
      credentialId: KEY.id,
      clientName: 'Zapier',
      onBehalfOfPrincipalId: CREATOR,
      metadata: { count: 1, failures: 0 },
    })
    expect(row.metadata.window).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00\.000Z$/)
    // Later writes in the same window add to this row rather than adding rows.
    expect(mockOnConflictDoUpdate).toHaveBeenCalledTimes(1)
  })

  it('records each write when a key that may not import asks for import mode', async () => {
    keyRole('member')
    const req = keyed('POST', '/api/v1/posts', {}, { 'x-import-mode': 'true' })
    await serve(
      req,
      route(() => createdResponse({ id: NEW_POST_ID }))
    )
    expect(mockInsertValues.mock.calls[0][0]).toMatchObject({ eventType: 'api.write' })
    expect(mockOnConflictDoUpdate).not.toHaveBeenCalled()
  })

  async function serve(
    req: Request,
    handler: (r: Request) => () => Promise<{ response?: Response }>
  ) {
    return handleRequestWithAuditAttribution({
      request: req,
      handlerType: 'router',
      next: handler(req),
    })
  }

  it('records a key write once, attributed to the key and the teammate who created it', async () => {
    const req = keyed('POST', '/api/v1/posts', { title: 'Do not log me', secret: 'hunter2' })
    const result = await serve(
      req,
      route(() => createdResponse({ id: NEW_POST_ID }))
    )

    expect(result.response?.status).toBe(201)
    expect(mockInsertValues).toHaveBeenCalledTimes(1)
    const row = mockInsertValues.mock.calls[0][0]
    expect(row).toMatchObject({
      eventType: 'api.write',
      eventOutcome: 'success',
      actorUserId: null,
      actorRole: 'admin',
      actorType: 'service',
      authMethod: 'api_key',
      actorIp: '203.0.113.9',
      actorUserAgent: 'zapier/1.0',
      requestId: 'req_42',
      channel: 'api',
      credentialKind: 'api_key',
      credentialId: KEY.id,
      clientName: 'Zapier',
      onBehalfOfPrincipalId: CREATOR,
      targetType: 'post',
      targetId: NEW_POST_ID,
      metadata: { method: 'POST', route: '/api/v1/posts', status: 201 },
    })
    // Never the body and never the credential.
    const stored = JSON.stringify(row)
    expect(stored).not.toContain('hunter2')
    expect(stored).not.toContain('Do not log me')
    expect(stored).not.toContain('qb_test_secret_value')
  })

  it('names the route pattern and the resource the path points at', async () => {
    const req = keyed('PATCH', `/api/v1/posts/${POST_ID}/comments?draft=1`)
    await serve(
      req,
      route(() => successResponse({ ok: true }))
    )

    expect(mockInsertValues.mock.calls[0][0]).toMatchObject({
      eventType: 'api.write',
      targetType: 'post',
      targetId: POST_ID,
      metadata: { method: 'PATCH', route: '/api/v1/posts/:id/comments', status: 200 },
    })
  })

  it('records a refused write as a failure with its status and error code', async () => {
    keyRole('member')
    const req = keyed('DELETE', `/api/v1/posts/${POST_ID}`)
    const result = await serve(
      req,
      route(() => noContentResponse(), PERMISSIONS.BILLING_MANAGE)
    )

    expect(result.response?.status).toBe(403)
    expect(mockInsertValues.mock.calls[0][0]).toMatchObject({
      eventType: 'api.write',
      eventOutcome: 'failure',
      channel: 'api',
      credentialId: KEY.id,
      targetId: POST_ID,
      metadata: {
        method: 'DELETE',
        route: '/api/v1/posts/:id',
        status: 403,
        errorCode: 'FORBIDDEN',
      },
    })
  })

  it('does not audit reads', async () => {
    const req = keyed('GET', `/api/v1/posts/${POST_ID}`)
    await serve(
      req,
      route(() => successResponse({ id: POST_ID }))
    )
    expect(mockInsertValues).not.toHaveBeenCalled()
  })

  it('does not audit a request no key authenticated', async () => {
    mockVerifyApiKey.mockResolvedValue(null)
    const req = keyed('POST', '/api/v1/posts', {})
    const result = await serve(
      req,
      route(() => createdResponse({ id: NEW_POST_ID }))
    )
    expect(result.response?.status).toBe(401)
    expect(mockInsertValues).not.toHaveBeenCalled()
  })

  it('does not audit writes outside the REST API', async () => {
    const req = keyed('POST', '/api/widget/identify', {})
    await serve(
      req,
      route(() => successResponse({ ok: true }))
    )
    expect(mockInsertValues).not.toHaveBeenCalled()
  })

  it('never fails the request when the audit write fails', async () => {
    mockInsertValues.mockRejectedValue(new Error('audit_log is down'))
    const req = keyed('POST', '/api/v1/posts', {})
    const result = await serve(
      req,
      route(() => createdResponse({ id: NEW_POST_ID }))
    )
    expect(result.response?.status).toBe(201)
    expect(mockLogError).toHaveBeenCalled()
  })

  it('records a handler that throws as a server error, then rethrows it', async () => {
    const req = keyed('POST', '/api/v1/posts', {})
    const boom = new Error('boom')
    await expect(
      handleRequestWithAuditAttribution({
        request: req,
        handlerType: 'router',
        next: async () => {
          await withApiKeyAuth(req)
          throw boom
        },
      })
    ).rejects.toBe(boom)
    expect(mockInsertValues.mock.calls[0][0]).toMatchObject({
      eventType: 'api.write',
      eventOutcome: 'failure',
      metadata: { method: 'POST', route: '/api/v1/posts', status: 500 },
    })
  })
})
