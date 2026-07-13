import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PrincipalId } from '@quackback/ids'
import { PERMISSIONS } from '@/lib/server/domains/authz'
import { ForbiddenError } from '@/lib/shared/errors'

const PRINCIPAL = 'principal_admin' as PrincipalId
const API_KEY_ID = 'api_key_123'

const mockWithApiKeyAuth = vi.fn()
const mockAssertScopeAllowed = vi.fn()
const mockLoadPermissionSet = vi.fn()
const mockHasPermission = vi.fn()
const mockListApiKeys = vi.fn()
const mockCreateApiKey = vi.fn()
const mockGetApiKeyById = vi.fn()
const mockUpdateApiKey = vi.fn()
const mockRevokeApiKey = vi.fn()
const mockRotateApiKey = vi.fn()
const mockAcknowledgeLegacyCompat = vi.fn()
const mockRecordEvent = vi.fn()

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: vi.fn(() => (opts: unknown) => ({ options: opts })),
}))

vi.mock('@/lib/server/domains/api/auth', () => ({
  withApiKeyAuth: (...args: unknown[]) => mockWithApiKeyAuth(...args),
  assertScopeAllowed: (...args: unknown[]) => mockAssertScopeAllowed(...args),
}))

vi.mock('@/lib/server/domains/authz/authz.service', () => ({
  loadPermissionSet: (...args: unknown[]) => mockLoadPermissionSet(...args),
  hasPermission: (...args: unknown[]) => mockHasPermission(...args),
}))

vi.mock('@/lib/server/domains/api-keys/api-key.service', () => ({
  listApiKeys: (...args: unknown[]) => mockListApiKeys(...args),
  createApiKey: (...args: unknown[]) => mockCreateApiKey(...args),
  getApiKeyById: (...args: unknown[]) => mockGetApiKeyById(...args),
  updateApiKey: (...args: unknown[]) => mockUpdateApiKey(...args),
  revokeApiKey: (...args: unknown[]) => mockRevokeApiKey(...args),
  rotateApiKey: (...args: unknown[]) => mockRotateApiKey(...args),
  acknowledgeLegacyCompat: (...args: unknown[]) => mockAcknowledgeLegacyCompat(...args),
}))

vi.mock('@/lib/server/domains/audit', () => ({
  recordEvent: (...args: unknown[]) => mockRecordEvent(...args),
}))

import { Route as AcknowledgeRoute } from '../$apiKeyId.acknowledge-legacy'
import { Route as RotateRoute } from '../$apiKeyId.rotate'
import { Route as DetailRoute } from '../$apiKeyId'
import { Route as IndexRoute } from '../index'

type HandlerArgs = { request: Request; params: { apiKeyId: string } }
type RouteWithOptions = {
  options: {
    server: {
      handlers: Record<string, (args: HandlerArgs) => Promise<Response>>
    }
  }
}

const indexHandlers = (IndexRoute as unknown as RouteWithOptions).options.server.handlers
const detailHandlers = (DetailRoute as unknown as RouteWithOptions).options.server.handlers
const rotateHandlers = (RotateRoute as unknown as RouteWithOptions).options.server.handlers
const acknowledgeHandlers = (AcknowledgeRoute as unknown as RouteWithOptions).options.server
  .handlers

function jsonRequest(url: string, method: string, body?: unknown) {
  return new Request(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

function apiKey(overrides: Record<string, unknown> = {}) {
  return {
    id: API_KEY_ID,
    name: 'Scoped key',
    keyPrefix: 'qb_aaaaaaaaa',
    createdById: PRINCIPAL,
    principalId: 'principal_service',
    lastUsedAt: null,
    expiresAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    revokedAt: null,
    scopes: [PERMISSIONS.ADMIN_MANAGE_API_KEYS],
    allowedTeamIds: [],
    allowedInboxIds: [],
    lastIp: null,
    lastUserAgent: null,
    rotatedAt: null,
    compatLegacyFullAccess: false,
    compatAcknowledgedAt: null,
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockWithApiKeyAuth.mockResolvedValue({
    principalId: PRINCIPAL,
    role: 'admin',
    source: 'api',
    ipAddress: '203.0.113.7',
    userAgent: 'vitest',
    key: {
      id: API_KEY_ID,
      name: 'caller',
      scopes: [PERMISSIONS.ADMIN_MANAGE_API_KEYS],
      allowedTeamIds: [],
      allowedInboxIds: [],
      compatLegacyFullAccess: false,
    },
  })
  mockLoadPermissionSet.mockResolvedValue(new Set([PERMISSIONS.ADMIN_MANAGE_API_KEYS]))
  mockHasPermission.mockReturnValue(true)
  mockRecordEvent.mockResolvedValue(undefined)
})

describe('/api/v1/api-keys', () => {
  it('lists API keys only after admin scope and permission checks pass', async () => {
    const key = apiKey()
    mockListApiKeys.mockResolvedValue([key])

    const res = await indexHandlers.GET({
      request: new Request('http://test/api/v1/api-keys'),
      params: { apiKeyId: API_KEY_ID },
    })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data).toEqual([key])
    expect(mockWithApiKeyAuth).toHaveBeenCalledWith(expect.any(Request), { role: 'admin' })
    expect(mockAssertScopeAllowed).toHaveBeenCalledWith(
      expect.any(Object),
      PERMISSIONS.ADMIN_MANAGE_API_KEYS
    )
    expect(mockLoadPermissionSet).toHaveBeenCalledWith(PRINCIPAL)
  })

  it('does not call the service when the API key scope is denied', async () => {
    mockAssertScopeAllowed.mockImplementationOnce(() => {
      throw new ForbiddenError('API_KEY_SCOPE_DENIED', 'missing scope')
    })

    const res = await indexHandlers.GET({
      request: new Request('http://test/api/v1/api-keys'),
      params: { apiKeyId: API_KEY_ID },
    })

    expect(res.status).toBe(403)
    expect(mockListApiKeys).not.toHaveBeenCalled()
  })

  it('does not list keys when the principal lacks admin.manage_api_keys permission', async () => {
    mockHasPermission.mockReturnValue(false)

    const res = await indexHandlers.GET({
      request: new Request('http://test/api/v1/api-keys'),
      params: { apiKeyId: API_KEY_ID },
    })

    expect(res.status).toBe(403)
    expect(mockListApiKeys).not.toHaveBeenCalled()
  })

  it('returns 403 when the principal lacks admin.manage_api_keys permission', async () => {
    mockHasPermission.mockReturnValue(false)

    const res = await indexHandlers.POST({
      request: jsonRequest('http://test/api/v1/api-keys', 'POST', { name: 'New key' }),
      params: { apiKeyId: API_KEY_ID },
    })

    expect(res.status).toBe(403)
    expect(mockCreateApiKey).not.toHaveBeenCalled()
  })

  it('rejects invalid create bodies before creating a key', async () => {
    const res = await indexHandlers.POST({
      request: jsonRequest('http://test/api/v1/api-keys', 'POST', { name: '' }),
      params: { apiKeyId: API_KEY_ID },
    })

    expect(res.status).toBe(400)
    expect(mockCreateApiKey).not.toHaveBeenCalled()
  })

  it('creates a scoped key and audits metadata without the plaintext key', async () => {
    const result = {
      apiKey: apiKey({
        name: 'Created key',
        scopes: [PERMISSIONS.ADMIN_MANAGE_API_KEYS],
        allowedTeamIds: ['team_a'],
        allowedInboxIds: ['inbox_a'],
      }),
      plainTextKey: 'qb_secret',
    }
    mockCreateApiKey.mockResolvedValue(result)

    const res = await indexHandlers.POST({
      request: jsonRequest('http://test/api/v1/api-keys', 'POST', {
        name: 'Created key',
        expiresAt: '2026-12-01T00:00:00.000Z',
        scopes: [PERMISSIONS.ADMIN_MANAGE_API_KEYS],
        allowedTeamIds: ['team_a'],
        allowedInboxIds: ['inbox_a'],
      }),
      params: { apiKeyId: API_KEY_ID },
    })

    expect(res.status).toBe(201)
    expect(mockCreateApiKey).toHaveBeenCalledWith(
      {
        name: 'Created key',
        expiresAt: new Date('2026-12-01T00:00:00.000Z'),
        scopes: [PERMISSIONS.ADMIN_MANAGE_API_KEYS],
        allowedTeamIds: ['team_a'],
        allowedInboxIds: ['inbox_a'],
      },
      PRINCIPAL
    )
    expect(mockRecordEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'api_key.created',
        diff: {
          after: {
            name: 'Created key',
            keyPrefix: 'qb_aaaaaaaaa',
            scopes: [PERMISSIONS.ADMIN_MANAGE_API_KEYS],
            allowedTeamIds: ['team_a'],
            allowedInboxIds: ['inbox_a'],
          },
        },
      })
    )
    expect(mockRecordEvent.mock.calls[0]?.[0]).not.toMatchObject({
      diff: { after: { plainTextKey: 'qb_secret' } },
    })
  })

  it('creates a key with no expiration when expiresAt is omitted', async () => {
    const result = { apiKey: apiKey({ name: 'No expiry' }), plainTextKey: 'qb_secret' }
    mockCreateApiKey.mockResolvedValue(result)

    const res = await indexHandlers.POST({
      request: jsonRequest('http://test/api/v1/api-keys', 'POST', { name: 'No expiry' }),
      params: { apiKeyId: API_KEY_ID },
    })

    expect(res.status).toBe(201)
    expect(mockCreateApiKey).toHaveBeenCalledWith(
      {
        name: 'No expiry',
        expiresAt: null,
        scopes: undefined,
        allowedTeamIds: undefined,
        allowedInboxIds: undefined,
      },
      PRINCIPAL
    )
  })
})

describe('/api/v1/api-keys/:apiKeyId', () => {
  it('rejects detail operations when the principal lacks admin.manage_api_keys permission', async () => {
    mockHasPermission.mockReturnValue(false)

    const getResponse = await detailHandlers.GET({
      request: new Request('http://test/api/v1/api-keys/api_key_123'),
      params: { apiKeyId: API_KEY_ID },
    })
    const patchResponse = await detailHandlers.PATCH({
      request: jsonRequest('http://test/api/v1/api-keys/api_key_123', 'PATCH', {
        name: 'Denied',
      }),
      params: { apiKeyId: API_KEY_ID },
    })
    const deleteResponse = await detailHandlers.DELETE({
      request: new Request('http://test/api/v1/api-keys/api_key_123', { method: 'DELETE' }),
      params: { apiKeyId: API_KEY_ID },
    })

    expect(getResponse.status).toBe(403)
    expect(patchResponse.status).toBe(403)
    expect(deleteResponse.status).toBe(403)
    expect(mockGetApiKeyById).not.toHaveBeenCalled()
    expect(mockUpdateApiKey).not.toHaveBeenCalled()
    expect(mockRevokeApiKey).not.toHaveBeenCalled()
  })

  it('fetches a single API key after admin checks pass', async () => {
    const key = apiKey({ name: 'Fetched key' })
    mockGetApiKeyById.mockResolvedValue(key)

    const res = await detailHandlers.GET({
      request: new Request('http://test/api/v1/api-keys/api_key_123'),
      params: { apiKeyId: API_KEY_ID },
    })

    expect(res.status).toBe(200)
    expect((await res.json()).data).toEqual(key)
    expect(mockGetApiKeyById).toHaveBeenCalledWith(API_KEY_ID)
  })

  it('patches a key and audits before/after metadata', async () => {
    const before = apiKey({ name: 'Before', scopes: [] })
    const after = apiKey({
      name: 'After',
      scopes: [PERMISSIONS.ADMIN_MANAGE_API_KEYS],
      allowedTeamIds: ['team_a'],
    })
    mockGetApiKeyById.mockResolvedValue(before)
    mockUpdateApiKey.mockResolvedValue(after)

    const res = await detailHandlers.PATCH({
      request: jsonRequest('http://test/api/v1/api-keys/api_key_123', 'PATCH', {
        name: 'After',
        scopes: [PERMISSIONS.ADMIN_MANAGE_API_KEYS],
        allowedTeamIds: ['team_a'],
      }),
      params: { apiKeyId: API_KEY_ID },
    })

    expect(res.status).toBe(200)
    expect(mockUpdateApiKey).toHaveBeenCalledWith(API_KEY_ID, {
      name: 'After',
      scopes: [PERMISSIONS.ADMIN_MANAGE_API_KEYS],
      allowedTeamIds: ['team_a'],
    })
    expect(mockRecordEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'api_key.updated',
        diff: {
          before: {
            name: 'Before',
            scopes: [],
            allowedTeamIds: [],
            allowedInboxIds: [],
          },
          after: {
            name: 'After',
            scopes: [PERMISSIONS.ADMIN_MANAGE_API_KEYS],
            allowedTeamIds: ['team_a'],
            allowedInboxIds: [],
          },
        },
      })
    )
  })

  it('rejects invalid patch bodies before loading the target key', async () => {
    const res = await detailHandlers.PATCH({
      request: jsonRequest('http://test/api/v1/api-keys/api_key_123', 'PATCH', {
        allowedTeamIds: [''],
      }),
      params: { apiKeyId: API_KEY_ID },
    })

    expect(res.status).toBe(400)
    expect(mockGetApiKeyById).not.toHaveBeenCalled()
    expect(mockUpdateApiKey).not.toHaveBeenCalled()
  })

  it('revokes a key and records an audit event', async () => {
    mockRevokeApiKey.mockResolvedValue(undefined)

    const res = await detailHandlers.DELETE({
      request: new Request('http://test/api/v1/api-keys/api_key_123', { method: 'DELETE' }),
      params: { apiKeyId: API_KEY_ID },
    })

    expect(res.status).toBe(204)
    expect(mockRevokeApiKey).toHaveBeenCalledWith(API_KEY_ID)
    expect(mockRecordEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'api_key.revoked',
        targetId: API_KEY_ID,
      })
    )
  })
})

describe('/api/v1/api-keys/:apiKeyId/rotate', () => {
  it('rejects rotation when the principal lacks admin.manage_api_keys permission', async () => {
    mockHasPermission.mockReturnValue(false)

    const res = await rotateHandlers.POST({
      request: new Request('http://test/api/v1/api-keys/api_key_123/rotate', { method: 'POST' }),
      params: { apiKeyId: API_KEY_ID },
    })

    expect(res.status).toBe(403)
    expect(mockRotateApiKey).not.toHaveBeenCalled()
  })

  it('rotates a key and audits the key-prefix transition only', async () => {
    mockGetApiKeyById.mockResolvedValue(apiKey({ keyPrefix: 'qb_before' }))
    mockRotateApiKey.mockResolvedValue({
      apiKey: apiKey({ keyPrefix: 'qb_after' }),
      plainTextKey: 'qb_new_secret',
    })

    const res = await rotateHandlers.POST({
      request: new Request('http://test/api/v1/api-keys/api_key_123/rotate', { method: 'POST' }),
      params: { apiKeyId: API_KEY_ID },
    })

    expect(res.status).toBe(200)
    expect(mockRotateApiKey).toHaveBeenCalledWith(API_KEY_ID)
    expect(mockRecordEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'api_key.rotated',
        diff: {
          before: { keyPrefix: 'qb_before' },
          after: { keyPrefix: 'qb_after' },
        },
      })
    )
    expect(mockRecordEvent.mock.calls[0]?.[0]).not.toMatchObject({
      diff: { after: { plainTextKey: 'qb_new_secret' } },
    })
  })
})

describe('/api/v1/api-keys/:apiKeyId/acknowledge-legacy', () => {
  it('rejects acknowledgement when the principal lacks admin.manage_api_keys permission', async () => {
    mockHasPermission.mockReturnValue(false)

    const res = await acknowledgeHandlers.POST({
      request: new Request('http://test/api/v1/api-keys/api_key_123/acknowledge-legacy', {
        method: 'POST',
      }),
      params: { apiKeyId: API_KEY_ID },
    })

    expect(res.status).toBe(403)
    expect(mockAcknowledgeLegacyCompat).not.toHaveBeenCalled()
  })

  it('acknowledges legacy compatibility after authz checks pass', async () => {
    const acknowledged = apiKey({ compatAcknowledgedAt: '2026-02-01T00:00:00.000Z' })
    mockAcknowledgeLegacyCompat.mockResolvedValue(acknowledged)

    const res = await acknowledgeHandlers.POST({
      request: new Request('http://test/api/v1/api-keys/api_key_123/acknowledge-legacy', {
        method: 'POST',
      }),
      params: { apiKeyId: API_KEY_ID },
    })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data).toEqual(acknowledged)
    expect(mockAcknowledgeLegacyCompat).toHaveBeenCalledWith(API_KEY_ID)
    expect(mockRecordEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'api_key.legacy_acknowledged',
        targetId: API_KEY_ID,
      })
    )
  })
})
