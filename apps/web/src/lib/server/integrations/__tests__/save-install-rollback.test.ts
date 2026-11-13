import { beforeEach, afterEach, afterAll, describe, expect, it, vi } from 'vitest'
vi.mock('../encryption', () => ({ encryptSecrets: () => 'encrypted-test-token' }))
const register = vi.hoisted(() => vi.fn())
const cleanup = vi.hoisted(() => vi.fn())
const enqueue = vi.hoisted(() => vi.fn())
vi.mock('@/lib/server/jobs/job-queue', () => ({ enqueueJob: enqueue }))
vi.mock('../install-registry', () => ({
  registerInstall: register,
  cleanupPreviousInstall: cleanup,
}))
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
import { principal, integrations, integrationEventMappings, eq } from '@/lib/server/db'
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
  it('reconnects a revoked Slack install in place and preserves notification routing', async () => {
    const [person] = await testDb
      .insert(principal)
      .values({ type: 'anonymous', role: 'user', createdAt: new Date() })
      .returning()
    const id = await saveIntegration('slack', {
      principalId: person.id,
      accessToken: 'old-token',
      config: { workspaceId: 'T1', channelId: 'C1' },
    })
    const [before] = await testDb.select().from(integrations).where(eq(integrations.id, id))
    const [mapping] = await testDb
      .insert(integrationEventMappings)
      .values({
        integrationId: id,
        eventType: 'message.created',
        actionType: 'notification',
        actionConfig: { channelId: 'C1' },
      })
      .returning()
    await testDb
      .update(integrations)
      .set({ status: 'disconnected', lastError: 'token_revoked', errorCount: 1 })
      .where(eq(integrations.id, id))
    await expect(
      saveIntegration('slack', {
        principalId: person.id,
        accessToken: 'new-token',
        config: { workspaceId: 'T1', workspaceName: 'Acme' },
      })
    ).resolves.toBe(id)
    const [after] = await testDb.select().from(integrations).where(eq(integrations.id, id))
    expect(after).toMatchObject({
      status: 'active',
      principalId: before.principalId,
      lastError: null,
      errorCount: 0,
      config: { workspaceId: 'T1', workspaceName: 'Acme', channelId: 'C1' },
    })
    expect(
      await testDb
        .select()
        .from(integrationEventMappings)
        .where(eq(integrationEventMappings.integrationId, id))
    ).toEqual([mapping])
  })

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
  it('compensates a new CP binding when cleanup enqueue rolls back the local reconnect', async () => {
    const [person] = await testDb
      .insert(principal)
      .values({ type: 'anonymous', role: 'user', createdAt: new Date() })
      .returning()
    await saveIntegration('slack', {
      principalId: person.id,
      accessToken: 'old',
      config: { workspaceId: 'T1' },
    })
    enqueue.mockRejectedValueOnce(new Error('queue unavailable'))
    await expect(
      saveIntegration('slack', {
        principalId: person.id,
        accessToken: 'new',
        config: { workspaceId: 'T2' },
      })
    ).rejects.toThrow('queue unavailable')
    expect(cleanup).toHaveBeenCalledWith('slack', { workspaceId: 'T2' })
    const row = await testDb.query.integrations.findFirst({
      where: eq(integrations.integrationType, 'slack'),
    })
    expect(row?.config).toMatchObject({ workspaceId: 'T1' })
  })
})
