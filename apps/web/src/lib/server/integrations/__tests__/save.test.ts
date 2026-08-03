import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { IntegrationId, PrincipalId } from '@quackback/ids'

const findFirstMock = vi.fn()
const updateWhereMock = vi.fn()
const updateSetMock = vi.fn((_updates: Record<string, unknown>) => ({ where: updateWhereMock }))
const updateMock = vi.fn((_table: unknown) => ({ set: updateSetMock }))
const insertReturningMock = vi.fn()
const insertValuesMock = vi.fn((_values: Record<string, unknown>) => ({
  returning: insertReturningMock,
}))
const insertMock = vi.fn((_table: unknown) => ({ values: insertValuesMock }))
const createServicePrincipalMock = vi.fn(async (_input: unknown) => ({ id: 'principal_service' }))
const encryptSecretsMock = vi.fn((secrets: Record<string, unknown>) => JSON.stringify(secrets))
const cacheDelMock = vi.fn()

vi.mock('@/lib/server/db', () => ({
  db: {
    query: {
      integrations: {
        findFirst: (...args: unknown[]) => findFirstMock(...args),
      },
    },
    update: (table: unknown) => updateMock(table),
    insert: (table: unknown) => insertMock(table),
  },
  integrations: {
    id: 'id',
    integrationType: 'integrationType',
  },
  eq: vi.fn((field, value) => ({ op: 'eq', field, value })),
  and: vi.fn((...conditions) => ({ op: 'and', conditions })),
}))

vi.mock('@/lib/server/integrations/encryption', () => ({
  encryptSecrets: (secrets: Record<string, unknown>) => encryptSecretsMock(secrets),
}))

vi.mock('@/lib/server/domains/principals/principal.service', () => ({
  createServicePrincipal: (input: unknown) => createServicePrincipalMock(input),
}))

vi.mock('@/lib/server/integrations/index', () => ({
  getIntegration: vi.fn(() => undefined),
}))

vi.mock('@/lib/server/redis', () => ({
  cacheDel: (...args: unknown[]) => cacheDelMock(...args),
  CACHE_KEYS: {
    INTEGRATION_MAPPINGS: 'hooks:integration-mappings',
  },
}))

const { saveIntegration } = await import('../save')

describe('saveIntegration reconnect behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    insertReturningMock.mockResolvedValue([{ id: 'integration_new' }])
  })

  it('refreshes secrets while preserving existing config for a targeted reconnect', async () => {
    findFirstMock.mockResolvedValue({
      id: 'integration_1',
      principalId: 'principal_service_existing',
      config: {
        channelId: 'org/repo',
        syncDirection: 'bidirectional',
        assigneeSync: true,
        defaultInboxId: 'inbox_1',
        username: 'old-user',
      },
    })

    const id = await saveIntegration('github', {
      principalId: 'principal_admin' as PrincipalId,
      accessToken: 'new-token',
      config: {
        username: 'new-user',
        workspaceName: 'New User',
      },
      integrationId: 'integration_1' as IntegrationId,
    })

    expect(id).toBe('integration_1')
    expect(insertMock).not.toHaveBeenCalled()
    expect(createServicePrincipalMock).not.toHaveBeenCalled()
    expect(updateSetMock).toHaveBeenCalledTimes(1)

    const update = updateSetMock.mock.calls[0][0]
    expect(update.secrets).toBe(JSON.stringify({ accessToken: 'new-token' }))
    expect(update.config).toMatchObject({
      channelId: 'org/repo',
      syncDirection: 'bidirectional',
      assigneeSync: true,
      defaultInboxId: 'inbox_1',
      username: 'new-user',
      workspaceName: 'New User',
    })
    expect(update.lastError).toBeNull()
    expect(update.errorCount).toBe(0)
    expect(cacheDelMock).toHaveBeenCalledWith('hooks:integration-mappings')
  })

  it('does not create a new integration when a targeted reconnect cannot find the row', async () => {
    findFirstMock.mockResolvedValue(undefined)

    await expect(
      saveIntegration('github', {
        principalId: 'principal_admin' as PrincipalId,
        accessToken: 'new-token',
        integrationId: 'integration_missing' as IntegrationId,
      })
    ).rejects.toThrow('github integration not found')

    expect(updateMock).not.toHaveBeenCalled()
    expect(insertMock).not.toHaveBeenCalled()
    expect(createServicePrincipalMock).not.toHaveBeenCalled()
  })
})
