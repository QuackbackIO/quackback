import { beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({
  read: vi.fn(),
  lockedRead: vi.fn(),
  lock: vi.fn(),
  update: vi.fn(),
  unregister: vi.fn(),
  runtime: vi.fn(),
}))
vi.mock('@/lib/server/db', async (original) => ({
  ...(await original<typeof import('@/lib/server/db')>()),
  db: {
    query: { integrations: { findFirst: mocks.read } },
    transaction: async (fn: (tx: unknown) => unknown) =>
      fn({
        execute: mocks.lock,
        query: { integrations: { findFirst: mocks.lockedRead } },
        update: () => ({ set: mocks.update }),
      }),
  },
}))
vi.mock('@/lib/server/integrations/encryption', async (original) => ({
  ...(await original<typeof import('@/lib/server/integrations/encryption')>()),
  decryptSecrets: JSON.parse,
}))
vi.mock('@/lib/server/integrations/install-registry', () => ({
  unregisterInstall: mocks.unregister,
}))
vi.mock('@/lib/server/domains/settings/settings.assistant', async (original) => ({
  ...(await original<typeof import('@/lib/server/domains/settings/settings.assistant')>()),
  getAssistantRuntimeConfig: mocks.runtime,
}))
import { handleSlackHookJob } from '../handler'
const installed = {
  id: 'install',
  config: { workspaceId: 'T1', botUserId: 'Ubot' },
  secrets: 'old-token',
  connectedAt: new Date(100_000),
}
const job = {
  payload: {
    kind: 'events',
    encryptedPayload: JSON.stringify({
      team_id: 'T1',
      event_time: 200,
      event: { type: 'app_uninstalled' },
    }),
  },
} as any
beforeEach(() => {
  vi.resetAllMocks()
  mocks.read.mockResolvedValue(installed)
  mocks.lockedRead.mockResolvedValue(installed)
  mocks.update.mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) })
  mocks.runtime.mockResolvedValue({
    config: { agents: { workspace: { slack: { enabled: false } } } },
  })
})
it('locks before re-reading and disconnecting the current install', async () => {
  await handleSlackHookJob(job)
  expect(mocks.lock).toHaveBeenCalledOnce()
  expect(mocks.lock.mock.invocationCallOrder[0]).toBeLessThan(
    mocks.lockedRead.mock.invocationCallOrder[0]
  )
  expect(mocks.unregister).toHaveBeenCalledWith('slack', installed.config)
  expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ status: 'disconnected' }))
})
it('does not unregister or disconnect a reconnect that won the advisory lock', async () => {
  mocks.lockedRead.mockResolvedValue({
    ...installed,
    secrets: 'new-token',
    connectedAt: new Date(300_000),
  })
  await handleSlackHookJob(job)
  expect(mocks.unregister).not.toHaveBeenCalled()
  expect(mocks.update).not.toHaveBeenCalled()
})
it('ignores an old revocation delivered after a same-team reinstall', async () => {
  const reinstalled = { ...installed, connectedAt: new Date(300_000) }
  mocks.read.mockResolvedValue(reinstalled)
  mocks.lockedRead.mockResolvedValue(reinstalled)
  await handleSlackHookJob(job)
  expect(mocks.unregister).not.toHaveBeenCalled()
})
it('preserves retry when unregister fails, without changing local state', async () => {
  mocks.unregister.mockRejectedValue(new Error('CP unavailable'))
  await expect(handleSlackHookJob(job)).rejects.toThrow('CP unavailable')
  expect(mocks.update).not.toHaveBeenCalled()
})
