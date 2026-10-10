import { beforeEach, expect, it, vi } from 'vitest'
import { PERMISSIONS } from '@/lib/shared/permissions'

vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => {
    let _schema: { parse: (v: unknown) => unknown } | null = null
    let _handler: ((args: { data: unknown }) => Promise<unknown>) | null = null
    const fn = async (args?: { data: unknown }) => {
      if (!_handler) throw new Error('handler not registered')
      return _handler({ data: _schema ? _schema.parse(args?.data) : args?.data })
    }
    fn.validator = (schema: { parse: (v: unknown) => unknown }) => {
      _schema = schema
      return fn
    }
    fn.handler = (h: (args: { data: unknown }) => Promise<unknown>) => {
      _handler = h
      return fn
    }
    return fn
  },
}))

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  read: vi.fn(),
  lock: vi.fn(),
  lockedRead: vi.fn(),
  del: vi.fn(),
  getIntegration: vi.fn(),
  getPlatformCredentials: vi.fn(),
  decryptSecrets: vi.fn(),
  unregister: vi.fn(),
  cacheDel: vi.fn(),
}))

vi.mock('@/lib/server/functions/auth-helpers', () => ({ requireAuth: mocks.requireAuth }))
vi.mock('@/lib/server/db', async (original) => ({
  ...(await original<typeof import('@/lib/server/db')>()),
  db: {
    query: { integrations: { findFirst: mocks.read } },
    transaction: async (fn: (tx: unknown) => unknown) =>
      fn({
        execute: mocks.lock,
        query: { integrations: { findFirst: mocks.lockedRead } },
        delete: () => ({ where: mocks.del }),
      }),
  },
}))
vi.mock('@/lib/server/integrations', () => ({ getIntegration: mocks.getIntegration }))
vi.mock('@/lib/server/integrations/encryption', () => ({ decryptSecrets: mocks.decryptSecrets }))
vi.mock('@/lib/server/domains/platform-credentials/platform-credential.service', () => ({
  getPlatformCredentials: mocks.getPlatformCredentials,
}))
vi.mock('@/lib/server/integrations/install-registry', () => ({
  unregisterInstall: mocks.unregister,
}))
vi.mock('@/lib/server/cache', () => ({
  cacheDel: mocks.cacheDel,
  CACHE_KEYS: { INTEGRATION_MAPPINGS: 'mappings' },
}))

import { deleteIntegrationFn } from '../integrations'

const connectedAt = new Date(100_000)
const row = {
  id: 'int_1',
  integrationType: 'slack',
  secrets: 'token',
  config: { workspaceId: 'T1' },
  connectedAt,
}

beforeEach(() => {
  vi.resetAllMocks()
  mocks.requireAuth.mockResolvedValue({})
  mocks.read.mockResolvedValue(row)
  mocks.lockedRead.mockResolvedValue(row)
  mocks.del.mockResolvedValue(undefined)
  mocks.getIntegration.mockReturnValue({ onDisconnect: vi.fn() })
  mocks.getPlatformCredentials.mockResolvedValue({ clientId: 'id' })
  mocks.decryptSecrets.mockReturnValue({ accessToken: 'token' })
})

it('locks and re-reads before unregistering a disconnect', async () => {
  await deleteIntegrationFn({ data: { id: 'int_1' } })
  expect(mocks.requireAuth).toHaveBeenCalledWith({ permission: PERMISSIONS.INTEGRATION_MANAGE })
  expect(mocks.lock.mock.invocationCallOrder[0]).toBeLessThan(
    mocks.lockedRead.mock.invocationCallOrder[0]
  )
  expect(mocks.unregister).toHaveBeenCalledWith('slack', row.config)
  expect(mocks.del).toHaveBeenCalled()
})

it('refuses to disconnect a reconnect that won the advisory lock', async () => {
  mocks.lockedRead.mockResolvedValue({ ...row, secrets: 'new-token', connectedAt: new Date(300_000) })
  await expect(deleteIntegrationFn({ data: { id: 'int_1' } })).rejects.toThrow('reconnected')
  expect(mocks.unregister).not.toHaveBeenCalled()
  expect(mocks.del).not.toHaveBeenCalled()
})
