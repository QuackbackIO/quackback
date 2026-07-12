import { describe, it, expect, vi } from 'vitest'
import { z } from 'zod'

// A real, non-transactional pool that bypasses config.ts's full env validation
// (which the app's `db` singleton requires) — the same pattern
// frequency-cap-race.test.ts and db-test-fixture.ts use for DB-backed tests.
// emit.ts itself only imports table objects + `sql` from here (it takes the tx
// as a parameter), so those still come through from the original module.
vi.mock('@/lib/server/db', async (importOriginal) => {
  const { createDb } = await import('@quackback/db/client')
  const url =
    process.env.DATABASE_URL ?? 'postgresql://postgres:password@localhost:5432/quackback_test'
  return {
    ...(await importOriginal<typeof import('@/lib/server/db')>()),
    db: createDb(url, { max: 5, prepare: false }),
  }
})

import { db, events, auditLog, eq, and } from '@/lib/server/db'
import { createId } from '@quackback/ids'
import { emit, inherit } from '../emit'
import type { EventDefinition } from '../catalogue/define'
import type { DomainEvent } from '../envelope'

/**
 * WO-1 — `emit()` writes the outbox row in the caller's transaction, rolls back
 * with an aborted tx, rejects bad payloads, and only writes an audit row when
 * the definition opts in. Runs against the shared quackback_test DB (0192
 * applied).
 */

const auditedDef: EventDefinition<{ postId: string; note: string }> = {
  type: 'test.emit_audited',
  entity: 'post',
  version: 1,
  payload: z.object({ postId: z.string(), note: z.string() }),
  exposure: { webhook: false, workflow: false, notification: null, activity: null, audit: true },
  requiredScope: 'posts:read',
  emits: 'always',
}

const plainDef: EventDefinition<{ postId: string }> = {
  type: 'test.emit_plain',
  entity: 'post',
  version: 2,
  payload: z.object({ postId: z.string() }),
  exposure: { webhook: true, workflow: false, notification: null, activity: null, audit: false },
  requiredScope: 'posts:read',
  emits: 'always',
}

describe('emit()', () => {
  it('inserts exactly one events row with the envelope fields', async () => {
    const entityId = createId('post')
    const eventId = await db.transaction((tx) =>
      emit(tx, plainDef, {
        payload: { postId: entityId },
        actor: { type: 'user', id: createId('principal') },
        entityId,
        context: { source: 'api', correlationId: 'corr-1' },
      })
    )

    const rows = await db.select().from(events).where(eq(events.eventId, eventId))
    expect(rows).toHaveLength(1)
    const row = rows[0]
    expect(row.type).toBe('test.emit_plain')
    expect(row.entityType).toBe('post')
    expect(row.entityId).toBe(entityId)
    expect(row.actorType).toBe('user')
    expect(row.schemaVersion).toBe(2)
    expect(row.payload).toEqual({ postId: entityId })
    expect((row.context as { depth: number; source: string }).depth).toBe(0)
    expect((row.context as { source: string }).source).toBe('api')
    expect(row.publishedAt).toBeNull()
  })

  it('rolls back the event when the surrounding transaction aborts', async () => {
    const entityId = createId('post')
    await expect(
      db.transaction(async (tx) => {
        await emit(tx, plainDef, {
          payload: { postId: entityId },
          actor: { type: 'service' },
          entityId,
        })
        throw new Error('abort the tx')
      })
    ).rejects.toThrow('abort the tx')

    const rows = await db.select().from(events).where(eq(events.entityId, entityId))
    expect(rows).toHaveLength(0)
  })

  it('rejects a payload that fails the catalogue zod schema', async () => {
    const entityId = createId('post')
    await expect(
      db.transaction((tx) =>
        emit(tx, plainDef, {
          // @ts-expect-error — deliberately wrong payload shape
          payload: { wrong: 1 },
          actor: { type: 'system' },
          entityId,
        })
      )
    ).rejects.toBeInstanceOf(z.ZodError)

    const rows = await db.select().from(events).where(eq(events.entityId, entityId))
    expect(rows).toHaveLength(0)
  })

  it('writes an audit_log row in the same tx iff exposure.audit is true', async () => {
    const auditedEntity = createId('post')
    await db.transaction((tx) =>
      emit(tx, auditedDef, {
        payload: { postId: auditedEntity, note: 'hi' },
        actor: { type: 'user', id: createId('principal') },
        entityId: auditedEntity,
      })
    )
    const auditRows = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.eventType, 'test.emit_audited'), eq(auditLog.targetId, auditedEntity)))
    expect(auditRows).toHaveLength(1)
    expect(auditRows[0].afterValue).toEqual({ postId: auditedEntity, note: 'hi' })

    const plainEntity = createId('post')
    await db.transaction((tx) =>
      emit(tx, plainDef, {
        payload: { postId: plainEntity },
        actor: { type: 'user' },
        entityId: plainEntity,
      })
    )
    const noAudit = await db.select().from(auditLog).where(eq(auditLog.targetId, plainEntity))
    expect(noAudit).toHaveLength(0)
  })

  it('inherit() bumps depth and threads causation from a parent event', () => {
    const parent: DomainEvent = {
      eventId: createId('event'),
      seq: 1n,
      type: 'post.created',
      entityType: 'post',
      entityId: createId('post'),
      actorType: 'user',
      payload: {},
      context: { depth: 0, correlationId: 'corr-9', source: 'api' },
      schemaVersion: 1,
      occurredAt: new Date(),
    }
    const child = inherit(parent, 'workflow')
    expect(child.depth).toBe(1)
    expect(child.causationId).toBe(parent.eventId)
    expect(child.correlationId).toBe('corr-9')
    expect(child.source).toBe('workflow')
  })
})
