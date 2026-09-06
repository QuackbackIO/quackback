import { beforeEach, afterEach, afterAll, describe, expect, it, vi } from 'vitest'
vi.mock('../encryption', () => ({ encryptSecrets: () => 'encrypted-test-token' }))
const register = vi.hoisted(() => vi.fn())
const enqueue = vi.hoisted(() => vi.fn())
vi.mock('@/lib/server/jobs/job-queue', () => ({ enqueueJob: enqueue }))
vi.mock('../install-registry', () => ({ registerInstall: register }))
vi.mock('../index', () => ({
  getIntegration: () => ({
    install: { externalId: (config: Record<string, unknown>) => config.workspaceId },
  }),
}))
vi.mock('@/lib/server/db', async (original) => ({
  ...(await original<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { principal, integrations, eq } from '@/lib/server/db'
import { saveIntegration } from '../save'
const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select().from(integrations).limit(0)
  },
})
describe.skipIf(!fixture.available)('install registration transaction', () => {
  beforeEach(async () => {
    vi.resetAllMocks()
    await fixture.begin()
  })
  afterEach(fixture.rollback)
  afterAll(fixture.close)
  it('rolls back the install and new principal when Cloud rejects ownership', async () => {
    const [person] = await testDb
      .insert(principal)
      .values({ type: 'anonymous', role: 'user', createdAt: new Date() })
      .returning()
    const before = await testDb.select({ id: principal.id }).from(principal)
    register.mockRejectedValue(new Error('already_connected_elsewhere'))
    await expect(
      saveIntegration('slack', {
        principalId: person.id,
        accessToken: 'test-token',
        config: { workspaceId: 'T1' },
      })
    ).rejects.toThrow('already_connected_elsewhere')
    expect(
      await testDb.select().from(integrations).where(eq(integrations.integrationType, 'slack'))
    ).toEqual([])
    expect(await testDb.select({ id: principal.id }).from(principal)).toEqual(before)
  })
  it('queues cleanup of a replaced external identity in the same transaction', async () => {
    const [person] = await testDb
      .insert(principal)
      .values({ type: 'anonymous', role: 'user', createdAt: new Date() })
      .returning()
    await saveIntegration('slack', {
      principalId: person.id,
      accessToken: 'old-token',
      config: { workspaceId: 'T1' },
    })
    await saveIntegration('slack', {
      principalId: person.id,
      accessToken: 'new-token',
      config: { workspaceId: 'T2' },
    })
    expect(register).toHaveBeenLastCalledWith(
      'slack',
      expect.objectContaining({ workspaceId: 'T2' }),
      'new-token'
    )
    expect(enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        queue: 'integration-install-cleanup',
        payload: { type: 'slack', config: { workspaceId: 'T1' } },
        executor: expect.anything(),
      })
    )
  })
})
