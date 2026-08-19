/**
 * The restore settlement marker is written by the database package, which
 * cannot import this app, so its event literal is declared twice: once as the
 * constant the writer uses and once in the taxonomy the reader filters by. A
 * rename on either side compiles clean and surfaces only as an audit row the
 * admin filter cannot find, so pin the literal to the type here.
 *
 * Deliberately its own file. The main audit suite mocks the database module,
 * and asserting against a mocked constant would prove nothing.
 *
 * The admin filter list in audit-log-page.tsx carries the same literal a third
 * time. It is not asserted here because reaching a component module from a
 * server test would pull React in for one string, and the failure mode is
 * milder: the event is still recorded and still readable, just not offered as
 * a filter option.
 */
import { describe, it, expect } from 'vitest'
import { RESTORE_SETTLEMENT_AUDIT_EVENT } from '@/lib/server/db'
import type { AuditEventType } from '../log'

describe('restore settlement marker stays in the audit taxonomy', () => {
  it('is a member of AuditEventType', () => {
    const asEventType: AuditEventType = RESTORE_SETTLEMENT_AUDIT_EVENT
    expect(asEventType).toBe('restore.side_effects_settled')
  })
})
