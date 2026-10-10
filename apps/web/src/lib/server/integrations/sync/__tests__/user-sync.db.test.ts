import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHmac, randomUUID } from 'node:crypto'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import {
  eq,
  sql,
  user,
  principal,
  segments,
  userSegments,
  userAttributeDefinitions,
  integrations,
  integrationSyncOperations as operations,
} from '@/lib/server/db'
import { encryptSecrets } from '../../encryption'
import { handleInboundIdentify } from '../../user-sync-handler'
import { notifyUserSyncIntegrations } from '../../user-sync-notify'
import { runIntegrationSync } from '../worker'
import { syncTestJob } from './job'
import { readSyncPayload } from '../ledger'
vi.mock('@/lib/server/db', async (original) => ({
  ...(await original<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))
vi.mock('@/lib/server/secret-key', () => ({
  activeSecretKey: () => 'integration-sync-test-key-32-characters-only',
}))
const fault = vi.hoisted(() => ({ failCompletionOnce: false }))
vi.mock('../ledger', async (original) => {
  const actual = await original<typeof import('../ledger')>()
  return {
    ...actual,
    finishSyncOperation: (
      claim: Parameters<typeof actual.finishSyncOperation>[0],
      outcome: Parameters<typeof actual.finishSyncOperation>[1],
      persist: Parameters<typeof actual.finishSyncOperation>[2]
    ) =>
      actual.finishSyncOperation(
        claim,
        outcome,
        persist
          ? async (tx) => {
              const result = await persist(tx)
              if (
                fault.failCompletionOnce &&
                claim.operation.kind === 'identify' &&
                outcome.state === 'succeeded'
              ) {
                fault.failCompletionOnce = false
                throw new Error('Simulated completion failure after the real local writes')
              }
              return result
            }
          : undefined
      ),
  }
})
const olderRevision = new Date(Date.now() + 60_000).toISOString()
const newerRevision = new Date(Date.now() + 120_000).toISOString()
const fixture = await createDbTestFixture()
beforeEach(fixture.begin)
afterEach(async () => {
  fault.failCompletionOnce = false
  vi.restoreAllMocks()
  await fixture.rollback()
})
afterAll(fixture.close)
const secret = 'segment-inbound-test'
async function seed() {
  const [person] = await testDb
    .insert(user)
    .values({
      name: 'Sync person',
      email: `${randomUUID()}@example.com`,
      metadata: '{"retained":"yes"}',
    })
    .returning()
  const [actor] = await testDb
    .insert(principal)
    .values({ userId: person.id, role: 'user', type: 'user', createdAt: new Date() })
    .returning()
  const [segment] = await testDb
    .insert(segments)
    .values({ name: 'Paid customers', slug: `paid-${randomUUID()}`, type: 'dynamic' })
    .returning()
  const [integration] = await testDb
    .insert(integrations)
    .values({
      integrationType: 'segment',
      status: 'active',
      secrets: encryptSecrets({ incomingSecret: secret, writeKey: 'test-key' }),
      config: { outgoingEnabled: true },
    })
    .returning()
  await testDb
    .insert(userAttributeDefinitions)
    .values({ key: 'sync_plan', label: 'Plan', type: 'string' })
  return { person, actor, segment, integration }
}
function request(email: string, messageId: string, timestamp: string, value: string) {
  const body = JSON.stringify({
    type: 'identify',
    messageId,
    timestamp,
    userId: 'external-person',
    traits: { email, sync_plan: value, undeclared: 'ignored' },
  })
  return new Request('http://localhost/api/integrations/segment/identify', {
    method: 'POST',
    body,
    headers: { 'x-signature': createHmac('sha1', secret).update(body).digest('base64') },
  })
}
async function record(id: string) {
  return testDb.query.integrationSyncOperations.findFirst({ where: eq(operations.id, id) })
}
describe('user sync durability (PostgreSQL)', () => {
  it('acknowledges only durable identify work, applies declared attributes once, and rejects older changes', async () => {
    const { person } = await seed()
    const message = randomUUID()
    expect(
      (
        await handleInboundIdentify(
          request(person.email!, message, newerRevision, 'paid'),
          'segment'
        )
      ).status
    ).toBe(200)
    await handleInboundIdentify(request(person.email!, message, newerRevision, 'paid'), 'segment')
    const queued = await testDb.query.integrationSyncOperations.findMany({
      where: eq(operations.sourceId, person.id),
    })
    expect(queued).toHaveLength(1)
    expect(
      (await testDb.query.user.findFirst({ where: eq(user.id, person.id) }))?.metadata
    ).not.toContain('paid')
    await runIntegrationSync(syncTestJob(queued[0].id))
    expect(
      JSON.parse((await testDb.query.user.findFirst({ where: eq(user.id, person.id) }))!.metadata!)
    ).toEqual({ retained: 'yes', sync_plan: 'paid', _externalUserId: 'external-person' })
    await handleInboundIdentify(
      request(person.email!, randomUUID(), olderRevision, 'free'),
      'segment'
    )
    const older = (
      await testDb.query.integrationSyncOperations.findMany({
        where: eq(operations.sourceId, person.id),
      })
    ).find((op) => op.id !== queued[0].id)!
    await runIntegrationSync(syncTestJob(older.id))
    expect((await record(older.id))?.state).toBe('superseded')
    expect(
      (await testDb.query.user.findFirst({ where: eq(user.id, person.id) }))?.metadata
    ).toContain('paid')
  })
  it('rolls back the attribute merge when completion fails, then safely retries the local transaction', async () => {
    const { person } = await seed()
    await handleInboundIdentify(
      request(person.email!, randomUUID(), newerRevision, 'paid'),
      'segment'
    )
    const queued = (await testDb.query.integrationSyncOperations.findFirst({
      where: eq(operations.sourceId, person.id),
    }))!
    fault.failCompletionOnce = true
    await expect(runIntegrationSync(syncTestJob(queued.id))).rejects.toThrow(
      'Local sync transaction'
    )
    expect((await record(queued.id))?.state).toBe('retry_wait')
    expect(
      (await testDb.query.user.findFirst({ where: eq(user.id, person.id) }))?.metadata
    ).not.toContain('paid')
    await runIntegrationSync(syncTestJob(queued.id))
    expect((await record(queued.id))?.state).toBe('succeeded')
    expect(
      (await testDb.query.user.findFirst({ where: eq(user.id, person.id) }))?.metadata
    ).toContain('paid')
  })
  it('returns 503 if the durable receipt cannot be committed', async () => {
    const { person } = await seed()
    await testDb.execute(sql`DELETE FROM integration_sync_start WHERE id = 1`)
    expect(
      (
        await handleInboundIdentify(
          request(person.email!, randomUUID(), newerRevision, 'paid'),
          'segment'
        )
      ).status
    ).toBe(503)
    expect(
      await testDb.query.integrationSyncOperations.findMany({
        where: eq(operations.sourceId, person.id),
      })
    ).toHaveLength(0)
  })
  it('commits membership and outbound intent together, uses current identity and a stable provider delivery ID', async () => {
    const { person, actor, segment } = await seed()
    const change = async (fail: boolean) =>
      testDb.transaction(async (tx) => {
        await tx.insert(userSegments).values({ principalId: actor.id, segmentId: segment.id })
        await notifyUserSyncIntegrations(segment.name, [actor.id], [], {
          executor: tx,
          segmentId: segment.id,
        })
        if (fail) throw new Error('rollback membership')
      })
    await expect(change(true)).rejects.toThrow('rollback membership')
    expect(
      await testDb.query.integrationSyncOperations.findMany({
        where: eq(operations.sourceId, person.id),
      })
    ).toHaveLength(0)
    expect(
      await testDb.query.userSegments.findMany({ where: eq(userSegments.principalId, actor.id) })
    ).toHaveLength(0)
    await change(false)
    const queued = (await testDb.query.integrationSyncOperations.findFirst({
      where: eq(operations.sourceId, person.id),
    }))!
    expect(JSON.stringify(readSyncPayload(queued))).not.toContain(person.email)
    await testDb.update(user).set({ email: 'current@example.com' }).where(eq(user.id, person.id))
    const network = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{}', { status: 200 }))
    await runIntegrationSync(syncTestJob(queued.id))
    await runIntegrationSync(syncTestJob(queued.id))
    expect(network).toHaveBeenCalledTimes(1)
    expect(JSON.parse(String(network.mock.calls[0][1]?.body))).toMatchObject({
      userId: 'current@example.com',
      messageId: queued.operationKey,
      traits: { paid_customers: true },
    })
  })
  it('does not send a stale membership after the person has left', async () => {
    const { person, actor, segment } = await seed()
    await testDb.transaction((tx) =>
      notifyUserSyncIntegrations(segment.name, [actor.id], [], {
        executor: tx,
        segmentId: segment.id,
      })
    )
    const queued = (await testDb.query.integrationSyncOperations.findFirst({
      where: eq(operations.sourceId, person.id),
    }))!
    const network = vi.spyOn(globalThis, 'fetch')
    await runIntegrationSync(syncTestJob(queued.id))
    expect((await record(queued.id))?.state).toBe('superseded')
    expect(network).not.toHaveBeenCalled()
  })
})
