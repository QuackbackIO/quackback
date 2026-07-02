import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PrincipalId } from '@quackback/ids'
import { PERMISSIONS } from '@/lib/server/domains/authz'

type AnyHandler = (args: { data: Record<string, unknown> }) => Promise<unknown>

const handlersByIndex: AnyHandler[] = []

vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => {
    const chain = {
      validator() {
        return chain
      },
      inputValidator() {
        return chain
      },
      handler(fn: AnyHandler) {
        handlersByIndex.push(fn)
        return chain
      },
    }
    return chain
  },
}))

const hoisted = vi.hoisted(() => ({
  mockRequireAuth: vi.fn(),
  mockListApiKeys: vi.fn(),
  mockGetApiKeyById: vi.fn(),
  mockCreateApiKey: vi.fn(),
  mockUpdateApiKey: vi.fn(),
  mockRotateApiKey: vi.fn(),
  mockRevokeApiKey: vi.fn(),
  mockAcknowledgeLegacyCompat: vi.fn(),
  mockRecordEvent: vi.fn(),
  mockLoggerDebug: vi.fn(),
  mockLoggerError: vi.fn(),
}))

vi.mock('@/lib/server/functions/auth-helpers', () => ({
  requireAuth: hoisted.mockRequireAuth,
}))

vi.mock('@/lib/server/domains/api-keys/api-key.service', () => ({
  listApiKeys: hoisted.mockListApiKeys,
  getApiKeyById: hoisted.mockGetApiKeyById,
  createApiKey: hoisted.mockCreateApiKey,
  updateApiKey: hoisted.mockUpdateApiKey,
  rotateApiKey: hoisted.mockRotateApiKey,
  revokeApiKey: hoisted.mockRevokeApiKey,
  acknowledgeLegacyCompat: hoisted.mockAcknowledgeLegacyCompat,
}))

vi.mock('@/lib/server/domains/audit', () => ({
  recordEvent: hoisted.mockRecordEvent,
}))

vi.mock('@/lib/server/logger', () => ({
  logger: {
    child: () => ({
      debug: hoisted.mockLoggerDebug,
      error: hoisted.mockLoggerError,
    }),
  },
}))

const PRINCIPAL = 'principal_admin' as PrincipalId
const API_KEY_ID = 'api_key_123'

await import('../api-keys')

const [
  fetchApiKeys,
  fetchApiKey,
  createApiKeyFn,
  updateApiKeyFn,
  rotateApiKeyFn,
  revokeApiKeyFn,
  acknowledgeLegacyApiKeyFn,
] = handlersByIndex

if (!acknowledgeLegacyApiKeyFn) {
  throw new Error(`api-keys handlers were not registered; found ${handlersByIndex.length}`)
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
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
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
  hoisted.mockRequireAuth.mockResolvedValue({
    principal: { id: PRINCIPAL, role: 'admin' },
    source: 'app',
    ipAddress: '203.0.113.10',
    userAgent: 'vitest',
  })
  hoisted.mockRecordEvent.mockResolvedValue(undefined)
})

describe('API key server functions', () => {
  it('lists API keys after requiring admin auth', async () => {
    const key = apiKey()
    hoisted.mockListApiKeys.mockResolvedValue([key])

    const result = await fetchApiKeys({ data: {} })

    expect(result).toEqual([key])
    expect(hoisted.mockRequireAuth).toHaveBeenCalledWith({ roles: ['admin'] })
  })

  it('does not list keys when admin auth fails', async () => {
    hoisted.mockRequireAuth.mockRejectedValueOnce(new Error('admin required'))

    await expect(fetchApiKeys({ data: {} })).rejects.toThrow('admin required')

    expect(hoisted.mockListApiKeys).not.toHaveBeenCalled()
  })

  it('fetches a single API key by id', async () => {
    const key = apiKey({ name: 'One key' })
    hoisted.mockGetApiKeyById.mockResolvedValue(key)

    const result = await fetchApiKey({ data: { id: API_KEY_ID } })

    expect(result).toEqual(key)
    expect(hoisted.mockGetApiKeyById).toHaveBeenCalledWith(API_KEY_ID)
  })

  it('creates a scoped API key and audits non-secret metadata', async () => {
    const result = {
      apiKey: apiKey({
        name: 'Created key',
        allowedTeamIds: ['team_a'],
        allowedInboxIds: ['inbox_a'],
      }),
      plainTextKey: 'qb_new_secret',
    }
    hoisted.mockCreateApiKey.mockResolvedValue(result)

    const created = await createApiKeyFn({
      data: {
        name: 'Created key',
        expiresAt: '2026-12-01T00:00:00.000Z',
        scopes: [PERMISSIONS.ADMIN_MANAGE_API_KEYS],
        allowedTeamIds: ['team_a'],
        allowedInboxIds: ['inbox_a'],
      },
    })

    expect(created).toEqual(result)
    expect(hoisted.mockCreateApiKey).toHaveBeenCalledWith(
      {
        name: 'Created key',
        expiresAt: new Date('2026-12-01T00:00:00.000Z'),
        scopes: [PERMISSIONS.ADMIN_MANAGE_API_KEYS],
        allowedTeamIds: ['team_a'],
        allowedInboxIds: ['inbox_a'],
      },
      PRINCIPAL
    )
    expect(hoisted.mockRecordEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'api_key.created',
        diff: {
          after: {
            name: 'Created key',
            keyPrefix: 'qb_aaaaaaaaa',
            scopes: [PERMISSIONS.ADMIN_MANAGE_API_KEYS],
            allowedTeamIds: ['team_a'],
            allowedInboxIds: ['inbox_a'],
            compatLegacyFullAccess: false,
          },
        },
      })
    )
    expect(hoisted.mockRecordEvent.mock.calls[0]?.[0]).not.toMatchObject({
      diff: { after: { plainTextKey: 'qb_new_secret' } },
    })
  })

  it('updates a key and audits the before/after authorization metadata', async () => {
    const before = apiKey({ name: 'Before', scopes: [], compatLegacyFullAccess: true })
    const after = apiKey({
      name: 'After',
      scopes: [PERMISSIONS.ADMIN_MANAGE_API_KEYS],
      allowedTeamIds: ['team_a'],
    })
    hoisted.mockGetApiKeyById.mockResolvedValue(before)
    hoisted.mockUpdateApiKey.mockResolvedValue(after)

    const result = await updateApiKeyFn({
      data: {
        id: API_KEY_ID,
        name: 'After',
        scopes: [PERMISSIONS.ADMIN_MANAGE_API_KEYS],
        allowedTeamIds: ['team_a'],
      },
    })

    expect(result).toEqual(after)
    expect(hoisted.mockUpdateApiKey).toHaveBeenCalledWith(API_KEY_ID, {
      name: 'After',
      scopes: [PERMISSIONS.ADMIN_MANAGE_API_KEYS],
      allowedTeamIds: ['team_a'],
      allowedInboxIds: undefined,
    })
    expect(hoisted.mockRecordEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'api_key.updated',
        diff: {
          before: {
            name: 'Before',
            scopes: [],
            allowedTeamIds: [],
            allowedInboxIds: [],
            compatLegacyFullAccess: true,
          },
          after: {
            name: 'After',
            scopes: [PERMISSIONS.ADMIN_MANAGE_API_KEYS],
            allowedTeamIds: ['team_a'],
            allowedInboxIds: [],
            compatLegacyFullAccess: false,
          },
        },
      })
    )
  })

  it('rotates a key and audits only old/new prefixes', async () => {
    hoisted.mockGetApiKeyById.mockResolvedValue(apiKey({ keyPrefix: 'qb_before' }))
    hoisted.mockRotateApiKey.mockResolvedValue({
      apiKey: apiKey({ keyPrefix: 'qb_after' }),
      plainTextKey: 'qb_rotated_secret',
    })

    const result = await rotateApiKeyFn({ data: { id: API_KEY_ID } })

    expect(result).toEqual({
      apiKey: apiKey({ keyPrefix: 'qb_after' }),
      plainTextKey: 'qb_rotated_secret',
    })
    expect(hoisted.mockRotateApiKey).toHaveBeenCalledWith(API_KEY_ID)
    expect(hoisted.mockRecordEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'api_key.rotated',
        diff: {
          before: { keyPrefix: 'qb_before' },
          after: { keyPrefix: 'qb_after' },
        },
      })
    )
    expect(hoisted.mockRecordEvent.mock.calls[0]?.[0]).not.toMatchObject({
      diff: { after: { plainTextKey: 'qb_rotated_secret' } },
    })
  })

  it('revokes a key and records the admin action', async () => {
    hoisted.mockRevokeApiKey.mockResolvedValue(undefined)

    const result = await revokeApiKeyFn({ data: { id: API_KEY_ID } })

    expect(result).toEqual({ id: API_KEY_ID })
    expect(hoisted.mockRevokeApiKey).toHaveBeenCalledWith(API_KEY_ID)
    expect(hoisted.mockRecordEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'api_key.revoked',
        targetId: API_KEY_ID,
      })
    )
  })

  it('acknowledges legacy compatibility and records the admin action', async () => {
    const acknowledged = apiKey({ compatAcknowledgedAt: new Date('2026-03-01T00:00:00.000Z') })
    hoisted.mockAcknowledgeLegacyCompat.mockResolvedValue(acknowledged)

    const result = await acknowledgeLegacyApiKeyFn({ data: { id: API_KEY_ID } })

    expect(result).toEqual(acknowledged)
    expect(hoisted.mockAcknowledgeLegacyCompat).toHaveBeenCalledWith(API_KEY_ID)
    expect(hoisted.mockRecordEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'api_key.legacy_acknowledged',
        targetId: API_KEY_ID,
      })
    )
  })
})
