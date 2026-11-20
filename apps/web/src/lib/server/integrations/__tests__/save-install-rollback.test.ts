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
import { principal, integrations, eq, sql } from '@/lib/server/db'
import { saveIntegration } from '../save'
const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select().from(integrations).limit(0)
  },
})

// Other test files commit rows to the same database while this one runs, so
// every read is scoped to an integration type that only this case uses.
let kind = ''
const integrationsOfKind = () =>
  testDb.select().from(integrations).where(eq(integrations.integrationType, kind))
const principalsOfKind = () =>
  testDb
    .select({ id: principal.id })
    .from(principal)
    .where(sql`${principal.serviceMetadata}->>'integrationType' = ${kind}`)

describe.skipIf(!fixture.available)('install registration transaction', () => {
  beforeEach(async () => {
    vi.resetAllMocks()
    kind = `slack-${crypto.randomUUID()}`
    await fixture.begin()
  })
  afterEach(fixture.rollback)
  afterAll(fixture.close)
  it('rolls back the install and new principal when Cloud rejects ownership', async () => {
    const [person] = await testDb
      .insert(principal)
      .values({ type: 'anonymous', role: 'user', createdAt: new Date() })
      .returning()
    let principalsWhileRegistering: unknown[] = []
    register.mockImplementation(async () => {
      // Cloud is asked inside the transaction, after the service principal exists.
      principalsWhileRegistering = await principalsOfKind()
      throw new Error('already_connected_elsewhere')
    })
    await expect(
      saveIntegration(kind, {
        principalId: person.id,
        accessToken: 'test-token',
        config: { workspaceId: 'T1' },
      })
    ).rejects.toThrow('already_connected_elsewhere')
    expect(principalsWhileRegistering).toHaveLength(1)
    expect(await integrationsOfKind()).toEqual([])
    expect(await principalsOfKind()).toEqual([])
  })
  it('queues cleanup of a replaced external identity in the same transaction', async () => {
    const [person] = await testDb
      .insert(principal)
      .values({ type: 'anonymous', role: 'user', createdAt: new Date() })
      .returning()
    await saveIntegration(kind, {
      principalId: person.id,
      accessToken: 'old-token',
      config: { workspaceId: 'T1' },
    })
    await saveIntegration(kind, {
      principalId: person.id,
      accessToken: 'new-token',
      config: { workspaceId: 'T2' },
    })
    expect(register).toHaveBeenLastCalledWith(
      kind,
      expect.objectContaining({ workspaceId: 'T2' }),
      'new-token'
    )
    expect(enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        queue: 'integration-install-cleanup',
        payload: { type: kind, config: { workspaceId: 'T1' } },
        executor: expect.anything(),
      })
    )
  })
  it('compensates a new CP binding when cleanup enqueue rolls back the local reconnect', async () => {
    const [person] = await testDb
      .insert(principal)
      .values({ type: 'anonymous', role: 'user', createdAt: new Date() })
      .returning()
    await saveIntegration(kind, {
      principalId: person.id,
      accessToken: 'old',
      config: { workspaceId: 'T1' },
    })
    enqueue.mockRejectedValueOnce(new Error('queue unavailable'))
    await expect(
      saveIntegration(kind, {
        principalId: person.id,
        accessToken: 'new',
        config: { workspaceId: 'T2' },
      })
    ).rejects.toThrow('queue unavailable')
    expect(cleanup).toHaveBeenCalledWith(kind, { workspaceId: 'T2' })
    const rows = await integrationsOfKind()
    expect(rows).toHaveLength(1)
    expect(rows[0].config).toMatchObject({ workspaceId: 'T1' })
  })
})
