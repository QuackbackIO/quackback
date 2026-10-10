import { afterEach, describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
vi.mock('@/lib/server/secret-key', () => ({
  activeSecretKey: () => 'integration-sync-test-key-32-characters-only',
}))
vi.mock('@/lib/server/db', async (original) => {
  // oxlint-disable-next-line no-restricted-imports
  const { createDb } = await import('@quackback/db/client')
  return {
    ...(await original<typeof import('@/lib/server/db')>()),
    db: createDb(process.env.DATABASE_URL!, { max: 8, prepare: false }),
  }
})
import {
  db,
  eq,
  sql,
  integrationSyncOperations as operations,
  integrationSyncAttempts as attempts,
  user,
} from '@/lib/server/db'
import {
  queueSyncOperation,
  claimSyncOperation,
  markSyncDispatched,
  finishSyncOperation,
  recoverExpiredSyncs,
} from '../ledger'
import { actOnSync } from '../history'
import { syncHash, canonicalJson, syncOperationKey } from '../identity'
import { deliveryError, syncErrorOutcome } from '../outcomes'
import type { SyncIntent } from '../types'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { createId } from '@quackback/ids'

const fixtures: string[] = []
function intent(): SyncIntent {
  return {
    operationKey: `review:${randomUUID()}`,
    integrationId: createId('integration'),
    installation: randomUUID(),
    provider: 'linear',
    direction: 'outbound',
    kind: 'create',
    sourceType: 'event',
    sourceId: randomUUID(),
    destination: { team: 'team-a' },
    payload: { executor: 'hook', data: { event: { body: 'private test body' } } },
  }
}
async function enqueue(data = intent()) {
  const op = await queueSyncOperation(data)
  if (!op) throw new Error('Expected a new sync operation')
  fixtures.push(op.id)
  return op
}
afterEach(async () => {
  for (const id of new Set(fixtures.splice(0))) {
    await db.execute(
      sql`DELETE FROM job_queue WHERE queue = 'integration-sync' AND payload->>'operationId' = ${id}`
    )
    await db.delete(operations).where(eq(operations.id, id))
  }
})

describe('sync identity and error policy', () => {
  it('canonicalizes object keys without changing arrays or destination isolation', () => {
    expect(syncHash({ a: 1, b: 2 })).toBe(syncHash({ b: 2, a: 1 }))
    expect(canonicalJson([2, 1])).not.toBe(canonicalJson([1, 2]))
    const key = {
      installation: 'install',
      kind: 'create',
      sourceType: 'post',
      sourceId: 'post',
      destination: { repo: 'a' },
    }
    expect(syncOperationKey(key)).not.toBe(syncOperationKey({ ...key, destination: { repo: 'b' } }))
    expect(syncOperationKey(key)).not.toBe(
      syncOperationKey({ ...key, installation: 'reconnected' })
    )
  })
  it('requires rejection evidence and treats compound failures after dispatch as uncertain', () => {
    expect(syncErrorOutcome(new Error('timeout'), true).state).toBe('uncertain')
    expect(deliveryError({ shouldRetry: true }).state).toBe('uncertain')
    expect(deliveryError({ status: 429 }).state).toBe('retry_wait')
    expect(deliveryError({ status: 401 }).state).toBe('auth_required')
    expect(syncErrorOutcome({ status: 429 }, true).state).toBe('uncertain')
  })
})

describe('durable sync ledger (PostgreSQL)', () => {
  it('deduplicates concurrent producers and claims exactly one remote execution', async () => {
    const input = intent()
    const created = await Promise.all(Array.from({ length: 5 }, () => enqueue(input)))
    expect(new Set(created.map((o) => o.id)).size).toBe(1)
    const claims = await Promise.all(created.map((o) => claimSyncOperation(o.id)))
    expect(claims.filter(Boolean)).toHaveLength(1)
    const claim = claims.find(Boolean)!
    expect(await markSyncDispatched(claim)).toBe(true)
    await finishSyncOperation(claim, { state: 'succeeded', result: { externalId: 'remote-1' } })
    expect(await claimSyncOperation(claim.operation.id)).toBeNull()
  })
  it('keeps completed identity after deleting its queue row and never stores plaintext payload', async () => {
    const input = intent()
    const op = await enqueue(input)
    const claim = (await claimSyncOperation(op.id))!
    expect(claim.operation.payload).not.toContain('private test body')
    await finishSyncOperation(claim, { state: 'succeeded' })
    await db.execute(sql`DELETE FROM job_queue WHERE payload->>'operationId' = ${op.id}`)
    expect((await enqueue(input)).state).toBe('succeeded')
  })
  it('does not mark completion when the link transaction fails', async () => {
    const op = await enqueue()
    const claim = (await claimSyncOperation(op.id))!
    await markSyncDispatched(claim)
    await expect(
      finishSyncOperation(
        claim,
        { state: 'succeeded', result: { externalId: 'remote-1' } },
        async () => {
          throw new Error('link failed')
        }
      )
    ).rejects.toThrow('link failed')
    const current = await db.query.integrationSyncOperations.findFirst({
      where: eq(operations.id, op.id),
    })
    expect(current?.state).toBe('running')
    expect(await claimSyncOperation(op.id)).toBeNull()
  })
  it('keeps the remote write barrier while reconciliation is queued', async () => {
    const first = intent()
    first.remoteId = 'shared-remote'
    const op = await enqueue(first)
    const claim = (await claimSyncOperation(op.id))!
    await markSyncDispatched(claim)
    await finishSyncOperation(claim, { state: 'uncertain', errorCode: 'outcome_unknown' })
    // Reconciliation can be queued behind other work; it must not release the barrier.
    await db.update(operations).set({ state: 'queued' }).where(eq(operations.id, op.id))
    const next = await enqueue({ ...first, operationKey: `review:${randomUUID()}` })
    await expect(claimSyncOperation(next.id)).rejects.toThrow('unfinished sync')
  })
  it('accepts concurrent repeats of the same recovery action exactly once', async () => {
    const op = await enqueue()
    const actor = {
      principalId: createId('principal'),
      role: 'admin' as const,
      principalType: 'user' as const,
      permissions: new Set([PERMISSIONS.INTEGRATION_MANAGE]),
      segmentIds: new Set<never>(),
    }
    const action = { id: op.id, version: 1, actionId: randomUUID(), action: 'cancel' as const }
    const results = await Promise.allSettled(
      Array.from({ length: 4 }, () => actOnSync(action, actor))
    )
    expect(results.every((r) => r.status === 'fulfilled')).toBe(true)
    const current = await db.query.integrationSyncOperations.findFirst({
      where: eq(operations.id, op.id),
    })
    expect(current?.version).toBe(2)
  })
  it('erases private payload on source deletion, including a late remote response', async () => {
    const [person] = await db
      .insert(user)
      .values({ name: 'Sync privacy test', email: `sync-${randomUUID()}@test.invalid` })
      .returning()
    const op = await enqueue({ ...intent(), sourceType: 'user', sourceId: person.id })
    const claim = (await claimSyncOperation(op.id))!
    await markSyncDispatched(claim)
    await db.delete(user).where(eq(user.id, person.id))
    await finishSyncOperation(claim, {
      state: 'succeeded',
      result: { externalId: 'evidence-id', externalUrl: 'https://provider.test/private-person' },
    })
    const current = await db.query.integrationSyncOperations.findFirst({
      where: eq(operations.id, op.id),
    })
    expect(current?.payload).toBeNull()
    expect(JSON.stringify(current?.result)).not.toContain('private-person')
    const history = await db.query.integrationSyncAttempts.findMany({
      where: eq(attempts.operationId, op.id),
    })
    expect(JSON.stringify(history)).not.toContain('private-person')
  })
  it.each([false, true])(
    'recovers expired ownership according to dispatch evidence: %s',
    async (dispatched) => {
      const op = await enqueue()
      const claim = (await claimSyncOperation(op.id))!
      if (dispatched) await markSyncDispatched(claim)
      await db
        .update(operations)
        .set({ leaseExpiresAt: new Date(0) })
        .where(eq(operations.id, op.id))
      await recoverExpiredSyncs()
      const current = await db.query.integrationSyncOperations.findFirst({
        where: eq(operations.id, op.id),
      })
      expect(current?.state).toBe(dispatched ? 'uncertain' : 'queued')
      expect(
        await finishSyncOperation(claim, { state: 'succeeded', result: { externalId: 'late' } })
      ).toBe(false)
      expect(
        (await db.query.integrationSyncOperations.findFirst({ where: eq(operations.id, op.id) }))
          ?.state
      ).toBe(current?.state)
      expect(
        (
          await db.query.integrationSyncAttempts.findFirst({
            where: eq(attempts.token, claim.token),
          })
        )?.result
      ).toEqual({ externalId: 'late' })
    }
  )
  it('cancel before dispatch prevents a remote call, while cancel after dispatch preserves the result', async () => {
    const actor = {
      principalId: createId('principal'),
      role: 'admin' as const,
      principalType: 'user' as const,
      permissions: new Set([PERMISSIONS.INTEGRATION_MANAGE]),
      segmentIds: new Set<never>(),
    }
    for (const dispatched of [false, true]) {
      const op = await enqueue()
      const claim = (await claimSyncOperation(op.id))!
      if (dispatched) await markSyncDispatched(claim)
      const action = {
        id: op.id,
        version: claim.operation.version,
        actionId: randomUUID(),
        action: 'cancel' as const,
      }
      await actOnSync(action, actor)
      await expect(actOnSync(action, actor)).resolves.toEqual({ success: true })
      expect(await markSyncDispatched(claim)).toBe(false)
      await finishSyncOperation(
        claim,
        dispatched
          ? { state: 'succeeded', result: { externalId: 'already-created' } }
          : { state: 'cancelled' }
      )
      expect(
        (await db.query.integrationSyncOperations.findFirst({ where: eq(operations.id, op.id) }))
          ?.state
      ).toBe(dispatched ? 'succeeded' : 'cancelled')
    }
  })
})
