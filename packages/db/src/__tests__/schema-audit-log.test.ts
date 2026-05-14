import { describe, it, expect } from 'vitest'
import { getTableName, getTableColumns } from 'drizzle-orm'
import { auditLog } from '../schema/audit-log'

describe('audit_log schema', () => {
  it('has correct table name', () => {
    expect(getTableName(auditLog)).toBe('audit_log')
  })

  it('exposes actor, event, target, and value columns', () => {
    const columns = Object.keys(getTableColumns(auditLog))
    expect(columns).toEqual(
      expect.arrayContaining([
        'id',
        'occurredAt',
        'actorUserId',
        'actorEmail',
        'actorRole',
        'actorIp',
        'actorUserAgent',
        'eventType',
        'eventOutcome',
        'targetType',
        'targetId',
        'beforeValue',
        'afterValue',
        'metadata',
      ])
    )
  })

  it('outcome and event type are not null', () => {
    const cols = getTableColumns(auditLog)
    expect(cols.eventType.notNull).toBe(true)
    expect(cols.eventOutcome.notNull).toBe(true)
    expect(cols.occurredAt.notNull).toBe(true)
  })

  it('actor user is nullable so we keep rows when admins are removed', () => {
    const cols = getTableColumns(auditLog)
    expect(cols.actorUserId.notNull).toBe(false)
  })
})
