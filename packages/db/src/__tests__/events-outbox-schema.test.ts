import { describe, it, expect } from 'vitest'
import { getTableName, getTableColumns } from 'drizzle-orm'
import { events } from '../schema/events'

/**
 * WO-1 — the `events` outbox table shape. Verified via Drizzle metadata (the
 * house convention, see schema-audit-log.test.ts) plus a text assertion on the
 * migration for the partial-index predicates that metadata can't express.
 */
describe('events outbox schema', () => {
  it('has the correct table name', () => {
    expect(getTableName(events)).toBe('events')
  })

  it('exposes every envelope column', () => {
    const columns = Object.keys(getTableColumns(events))
    expect(columns).toEqual(
      expect.arrayContaining([
        'id',
        'eventId',
        'type',
        'entityType',
        'entityId',
        'actorType',
        'actorId',
        'payload',
        'context',
        'schemaVersion',
        'dedupeKey',
        'occurredAt',
        'publishedAt',
      ])
    )
  })

  it('marks the required envelope fields NOT NULL', () => {
    const cols = getTableColumns(events)
    for (const key of [
      'eventId',
      'type',
      'entityType',
      'entityId',
      'actorType',
      'payload',
      'context',
      'schemaVersion',
      'occurredAt',
    ] as const) {
      expect(cols[key].notNull).toBe(true)
    }
  })

  it('keeps publishedAt / actorId / dedupeKey nullable (outbox-pending, service actor, no dedupe)', () => {
    const cols = getTableColumns(events)
    expect(cols.publishedAt.notNull).toBe(false)
    expect(cols.actorId.notNull).toBe(false)
    expect(cols.dedupeKey.notNull).toBe(false)
  })
})
