import { createHmac } from 'crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PrincipalId } from '@quackback/ids'
import { PERMISSIONS } from '@/lib/server/domains/authz/authz.permissions'
import { ValidationError } from '@/lib/shared/errors'
import type { ApiKey, ApiKeyId } from '../api-key.types'

const SECRET_KEY = 'test-secret-key-for-api-key-service'
const KEY = 'api_key_123' as ApiKeyId
const CREATOR = 'principal_creator' as PrincipalId
const SERVICE_PRINCIPAL = 'principal_service' as PrincipalId

const mockUpdate = vi.fn()
const mockInsert = vi.fn()
const mockApiKeysFindFirst = vi.fn()
const mockApiKeysFindMany = vi.fn()
const mockPrincipalFindFirst = vi.fn()
const mockCreateServicePrincipal = vi.fn()
const mockDispatchApiKeyCreated = vi.fn()
const mockDispatchApiKeyRotated = vi.fn()
const mockDispatchApiKeyRevoked = vi.fn()

vi.mock('@/lib/server/config', () => ({
  config: { secretKey: SECRET_KEY },
}))

vi.mock('@/lib/server/domains/principals/principal.service', () => ({
  createServicePrincipal: (...args: unknown[]) => mockCreateServicePrincipal(...args),
}))

vi.mock('@/lib/server/events/dispatch', () => ({
  dispatchApiKeyCreated: (...args: unknown[]) => mockDispatchApiKeyCreated(...args),
  dispatchApiKeyRotated: (...args: unknown[]) => mockDispatchApiKeyRotated(...args),
  dispatchApiKeyRevoked: (...args: unknown[]) => mockDispatchApiKeyRevoked(...args),
}))

vi.mock('@/lib/server/db', () => ({
  db: {
    insert: (...args: unknown[]) => mockInsert(...args),
    update: (...args: unknown[]) => mockUpdate(...args),
    query: {
      apiKeys: {
        findFirst: (...args: unknown[]) => mockApiKeysFindFirst(...args),
        findMany: (...args: unknown[]) => mockApiKeysFindMany(...args),
      },
      principal: {
        findFirst: (...args: unknown[]) => mockPrincipalFindFirst(...args),
      },
    },
  },
  apiKeys: {
    id: 'apiKeys.id',
    keyPrefix: 'apiKeys.keyPrefix',
    revokedAt: 'apiKeys.revokedAt',
  },
  principal: {
    id: 'principal.id',
  },
  eq: vi.fn(),
  and: vi.fn(),
  isNull: vi.fn(),
}))

const {
  acknowledgeLegacyCompat,
  createApiKey,
  getApiKeyById,
  listApiKeys,
  revokeApiKey,
  rotateApiKey,
  updateApiKey,
  verifyApiKey,
} = await import('../api-key.service')

type UpdateChain = {
  set: ReturnType<typeof vi.fn>
  where: ReturnType<typeof vi.fn>
  returning: ReturnType<typeof vi.fn>
  execute: ReturnType<typeof vi.fn>
}

type InsertChain = {
  values: ReturnType<typeof vi.fn>
  returning: ReturnType<typeof vi.fn>
}

function apiKeyRow(overrides: Partial<ApiKey> & { keyHash?: string | null } = {}) {
  return {
    id: KEY,
    name: 'Test key',
    keyPrefix: 'qb_aaaaaaaaa',
    keyHash: '0'.repeat(64),
    createdById: CREATOR,
    principalId: SERVICE_PRINCIPAL,
    lastUsedAt: null,
    expiresAt: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    revokedAt: null,
    scopes: [],
    allowedTeamIds: [],
    allowedInboxIds: [],
    lastIp: null,
    lastUserAgent: null,
    rotatedAt: null,
    compatLegacyFullAccess: true,
    compatAcknowledgedAt: null,
    ...overrides,
  }
}

function makeUpdateChain(returningRows: readonly unknown[] = []): UpdateChain {
  const chain: UpdateChain = {
    set: vi.fn(),
    where: vi.fn(),
    returning: vi.fn().mockResolvedValue(returningRows),
    execute: vi.fn().mockResolvedValue(undefined),
  }
  chain.set.mockReturnValue(chain)
  chain.where.mockReturnValue(chain)
  return chain
}

function makeInsertChain(
  buildRows: (values: Record<string, unknown>) => readonly unknown[]
): InsertChain {
  let insertedValues: Record<string, unknown> = {}
  const chain: InsertChain = {
    values: vi.fn((values: Record<string, unknown>) => {
      insertedValues = values
      return chain
    }),
    returning: vi.fn(() => Promise.resolve(buildRows(insertedValues))),
  }
  return chain
}

function keyHash(plainTextKey: string) {
  return createHmac('sha256', SECRET_KEY).update(plainTextKey).digest('hex')
}

beforeEach(() => {
  vi.clearAllMocks()
  mockDispatchApiKeyCreated.mockResolvedValue(undefined)
  mockDispatchApiKeyRotated.mockResolvedValue(undefined)
  mockDispatchApiKeyRevoked.mockResolvedValue(undefined)
})

describe('createApiKey', () => {
  it('normalizes scope and resource restrictions before storing the key', async () => {
    mockPrincipalFindFirst.mockResolvedValue({ role: 'admin' })
    mockCreateServicePrincipal.mockResolvedValue({ id: SERVICE_PRINCIPAL })

    const insertChain = makeInsertChain((values) => [
      apiKeyRow({
        ...values,
        id: KEY,
        createdById: CREATOR,
        principalId: SERVICE_PRINCIPAL,
        scopes: values.scopes as string[],
        allowedTeamIds: values.allowedTeamIds as string[],
        allowedInboxIds: values.allowedInboxIds as string[],
        compatLegacyFullAccess: values.compatLegacyFullAccess as boolean,
      }),
    ])
    const principalUpdateChain = makeUpdateChain()
    mockInsert.mockReturnValueOnce(insertChain)
    mockUpdate.mockReturnValueOnce(principalUpdateChain)

    const result = await createApiKey(
      {
        name: '  Scoped key  ',
        scopes: [PERMISSIONS.AUDIT_VIEW, PERMISSIONS.AUDIT_VIEW, PERMISSIONS.TICKET_VIEW_ALL],
        allowedTeamIds: ['team_a', 'team_a', '', ' team_b '],
        allowedInboxIds: ['inbox_1', ' inbox_1 '],
      },
      CREATOR
    )

    const inserted = insertChain.values.mock.calls[0]?.[0] as Record<string, unknown>
    expect(inserted).toEqual(
      expect.objectContaining({
        name: 'Scoped key',
        createdById: CREATOR,
        principalId: SERVICE_PRINCIPAL,
        scopes: [PERMISSIONS.AUDIT_VIEW, PERMISSIONS.TICKET_VIEW_ALL],
        allowedTeamIds: ['team_a', 'team_b'],
        allowedInboxIds: ['inbox_1'],
        compatLegacyFullAccess: false,
      })
    )
    expect(inserted.keyHash).toEqual(expect.any(String))
    expect(inserted.keyHash).not.toBe(result.plainTextKey)
    expect(result.plainTextKey).toMatch(/^qb_[0-9a-f]{48}$/)
    expect(result.apiKey.scopes).toEqual([PERMISSIONS.AUDIT_VIEW, PERMISSIONS.TICKET_VIEW_ALL])
    expect(result.apiKey.compatLegacyFullAccess).toBe(false)
    expect(mockCreateServicePrincipal).toHaveBeenCalledWith({
      role: 'admin',
      displayName: 'Scoped key',
      serviceMetadata: { kind: 'api_key', apiKeyId: '' },
    })
    expect(principalUpdateChain.set).toHaveBeenCalledWith({
      serviceMetadata: { kind: 'api_key', apiKeyId: KEY },
    })
    expect(mockDispatchApiKeyCreated).toHaveBeenCalledWith(
      { type: 'service', displayName: 'api-key-system' },
      { id: KEY, name: 'Scoped key', scopes: [PERMISSIONS.AUDIT_VIEW, PERMISSIONS.TICKET_VIEW_ALL] }
    )
  })

  it('keeps legacy full-access compatibility when no scopes are set at creation', async () => {
    mockPrincipalFindFirst.mockResolvedValue({ role: 'member' })
    mockCreateServicePrincipal.mockResolvedValue({ id: SERVICE_PRINCIPAL })

    const insertChain = makeInsertChain((values) => [
      apiKeyRow({
        ...values,
        id: KEY,
        createdById: CREATOR,
        principalId: SERVICE_PRINCIPAL,
        scopes: values.scopes as string[],
        allowedTeamIds: values.allowedTeamIds as string[],
        allowedInboxIds: values.allowedInboxIds as string[],
        compatLegacyFullAccess: values.compatLegacyFullAccess as boolean,
      }),
    ])
    mockInsert.mockReturnValueOnce(insertChain)
    mockUpdate.mockReturnValueOnce(makeUpdateChain())

    const result = await createApiKey({ name: 'Legacy key' }, CREATOR)

    expect(insertChain.values).toHaveBeenCalledWith(
      expect.objectContaining({
        scopes: [],
        allowedTeamIds: [],
        allowedInboxIds: [],
        compatLegacyFullAccess: true,
      })
    )
    expect(result.apiKey.compatLegacyFullAccess).toBe(true)
    expect(mockCreateServicePrincipal).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'member' })
    )
  })
})

describe('updateApiKey', () => {
  it('trims names, de-duplicates scopes and resource limits, and clears legacy compatibility', async () => {
    const apiKeyUpdateChain = makeUpdateChain([
      apiKeyRow({
        name: 'Scoped key',
        scopes: [PERMISSIONS.AUDIT_VIEW, PERMISSIONS.TICKET_VIEW_ALL],
        allowedTeamIds: ['team_a', 'team_b'],
        allowedInboxIds: ['inbox_1'],
        compatLegacyFullAccess: false,
      }),
    ])
    const principalUpdateChain = makeUpdateChain()
    mockUpdate.mockReturnValueOnce(apiKeyUpdateChain).mockReturnValueOnce(principalUpdateChain)

    const result = await updateApiKey(KEY, {
      name: '  Scoped key  ',
      scopes: [PERMISSIONS.AUDIT_VIEW, PERMISSIONS.AUDIT_VIEW, PERMISSIONS.TICKET_VIEW_ALL],
      allowedTeamIds: ['team_a', 'team_a', '', ' team_b '],
      allowedInboxIds: ['inbox_1', ' inbox_1 '],
    })

    expect(apiKeyUpdateChain.set).toHaveBeenCalledWith({
      name: 'Scoped key',
      scopes: [PERMISSIONS.AUDIT_VIEW, PERMISSIONS.TICKET_VIEW_ALL],
      compatLegacyFullAccess: false,
      allowedTeamIds: ['team_a', 'team_b'],
      allowedInboxIds: ['inbox_1'],
    })
    expect(principalUpdateChain.set).toHaveBeenCalledWith({ displayName: 'Scoped key' })
    expect(result.scopes).toEqual([PERMISSIONS.AUDIT_VIEW, PERMISSIONS.TICKET_VIEW_ALL])
    expect(result.compatLegacyFullAccess).toBe(false)
  })

  it('stores an explicit empty scope list without clearing legacy compatibility', async () => {
    const updateChain = makeUpdateChain([apiKeyRow({ scopes: [], compatLegacyFullAccess: true })])
    mockUpdate.mockReturnValueOnce(updateChain)

    const result = await updateApiKey(KEY, { scopes: [] })

    expect(updateChain.set).toHaveBeenCalledWith({ scopes: [] })
    expect(result.compatLegacyFullAccess).toBe(true)
  })

  it('loads the current key when the update patch is empty', async () => {
    mockApiKeysFindFirst.mockResolvedValue(apiKeyRow({ name: 'Existing key' }))

    const result = await updateApiKey(KEY, {})

    expect(result.name).toBe('Existing key')
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('rejects unknown permission scopes before touching the database', async () => {
    await expect(updateApiKey(KEY, { scopes: ['not.a.real.scope'] })).rejects.toBeInstanceOf(
      ValidationError
    )

    expect(mockUpdate).not.toHaveBeenCalled()
  })
})

describe('rotateApiKey', () => {
  it('rotates credentials, clears last-used metadata, and emits a sanitized event', async () => {
    const updateChain = makeUpdateChain([
      apiKeyRow({
        name: 'Rotated key',
        keyPrefix: 'qb_rotated',
        scopes: [PERMISSIONS.AUDIT_VIEW],
        lastUsedAt: null,
        rotatedAt: new Date('2026-02-01T00:00:00.000Z'),
      }),
    ])
    mockUpdate.mockReturnValueOnce(updateChain)

    const result = await rotateApiKey(KEY)

    const patch = updateChain.set.mock.calls[0]?.[0] as Record<string, unknown>
    expect(patch).toEqual(
      expect.objectContaining({
        keyHash: expect.any(String),
        keyPrefix: expect.stringMatching(/^qb_[0-9a-f]{9}$/),
        lastUsedAt: null,
        rotatedAt: expect.any(Date),
      })
    )
    expect(patch.keyHash).not.toBe(result.plainTextKey)
    expect(result.plainTextKey).toMatch(/^qb_[0-9a-f]{48}$/)
    expect(mockDispatchApiKeyRotated).toHaveBeenCalledWith(
      { type: 'service', displayName: 'api-key-system' },
      { id: KEY, name: 'Rotated key', scopes: [PERMISSIONS.AUDIT_VIEW] }
    )
  })

  it('throws when the key does not exist or is already revoked', async () => {
    mockUpdate.mockReturnValueOnce(makeUpdateChain([]))

    await expect(rotateApiKey(KEY)).rejects.toThrow('API key not found or already revoked')
  })
})

describe('revokeApiKey', () => {
  it('revokes the key, downgrades the service principal, and emits a sanitized event', async () => {
    mockApiKeysFindFirst.mockResolvedValue(
      apiKeyRow({ name: 'Revoked key', scopes: [PERMISSIONS.ADMIN_MANAGE_API_KEYS] })
    )
    const revokeChain = makeUpdateChain([apiKeyRow({ principalId: SERVICE_PRINCIPAL })])
    const principalUpdateChain = makeUpdateChain()
    mockUpdate.mockReturnValueOnce(revokeChain).mockReturnValueOnce(principalUpdateChain)
    mockPrincipalFindFirst.mockResolvedValue({ userId: null })

    await revokeApiKey(KEY)

    expect(revokeChain.set.mock.calls[0]?.[0]).toEqual({ revokedAt: expect.any(Date) })
    expect(principalUpdateChain.set).toHaveBeenCalledWith({ role: 'user' })
    expect(mockDispatchApiKeyRevoked).toHaveBeenCalledWith(
      { type: 'service', displayName: 'api-key-system' },
      {
        id: KEY,
        name: 'Revoked key',
        scopes: [PERMISSIONS.ADMIN_MANAGE_API_KEYS],
      }
    )
  })

  it('throws when the revoke update does not affect an active key', async () => {
    mockApiKeysFindFirst.mockResolvedValue(null)
    mockUpdate.mockReturnValueOnce(makeUpdateChain([]))

    await expect(revokeApiKey(KEY)).rejects.toThrow('API key not found or already revoked')
  })
})

describe('listApiKeys and getApiKeyById', () => {
  it('lists active keys without exposing stored hashes', async () => {
    mockApiKeysFindMany.mockResolvedValue([apiKeyRow({ keyHash: 'secret-hash' })])

    const result = await listApiKeys()

    expect(result).toHaveLength(1)
    expect(result[0]).not.toHaveProperty('keyHash')
  })

  it('throws when a requested key cannot be found', async () => {
    mockApiKeysFindFirst.mockResolvedValue(null)

    await expect(getApiKeyById(KEY)).rejects.toThrow('API key not found')
  })
})

describe('verifyApiKey', () => {
  it('requires the requested scope and records last-used only on success', async () => {
    const plainTextKey = `qb_${'a'.repeat(48)}`
    mockApiKeysFindFirst.mockResolvedValue(
      apiKeyRow({
        keyPrefix: plainTextKey.substring(0, 12),
        keyHash: keyHash(plainTextKey),
        scopes: [PERMISSIONS.AUDIT_VIEW],
      })
    )
    const updateChain = makeUpdateChain()
    mockUpdate.mockReturnValueOnce(updateChain)

    const result = await verifyApiKey(plainTextKey, PERMISSIONS.AUDIT_VIEW)

    expect(result?.id).toBe(KEY)
    expect(updateChain.set).toHaveBeenCalledWith({ lastUsedAt: expect.any(Date) })
    expect(updateChain.execute).toHaveBeenCalled()
  })

  it('supports legacy JSON-encoded scope arrays during verification', async () => {
    const plainTextKey = `qb_${'b'.repeat(48)}`
    mockApiKeysFindFirst.mockResolvedValue(
      apiKeyRow({
        keyPrefix: plainTextKey.substring(0, 12),
        keyHash: keyHash(plainTextKey),
        scopes: JSON.stringify([PERMISSIONS.TICKET_VIEW_ALL]) as unknown as string[],
      })
    )
    mockUpdate.mockReturnValueOnce(makeUpdateChain())

    const result = await verifyApiKey(plainTextKey, PERMISSIONS.TICKET_VIEW_ALL)

    expect(result?.id).toBe(KEY)
  })

  it('does not record last-used when the key is missing the requested scope', async () => {
    const plainTextKey = `qb_${'c'.repeat(48)}`
    mockApiKeysFindFirst.mockResolvedValue(
      apiKeyRow({
        keyPrefix: plainTextKey.substring(0, 12),
        keyHash: keyHash(plainTextKey),
        scopes: [PERMISSIONS.TICKET_VIEW_ALL],
      })
    )

    await expect(verifyApiKey(plainTextKey, PERMISSIONS.AUDIT_VIEW)).resolves.toBeNull()

    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('rejects malformed keys before querying by prefix', async () => {
    await expect(verifyApiKey('not-a-quackback-key')).resolves.toBeNull()

    expect(mockApiKeysFindFirst).not.toHaveBeenCalled()
  })
})

describe('acknowledgeLegacyCompat', () => {
  it('stores an acknowledgement timestamp without changing scopes', async () => {
    const acknowledgedAt = new Date('2026-02-03T04:05:06.000Z')
    const updateChain = makeUpdateChain([
      apiKeyRow({ scopes: [], compatLegacyFullAccess: true, compatAcknowledgedAt: acknowledgedAt }),
    ])
    mockUpdate.mockReturnValueOnce(updateChain)

    const result = await acknowledgeLegacyCompat(KEY)

    expect(updateChain.set.mock.calls[0]?.[0]).toEqual({
      compatAcknowledgedAt: expect.any(Date),
    })
    expect(result.compatAcknowledgedAt).toBe(acknowledgedAt)
    expect(result.scopes).toEqual([])
  })
})
