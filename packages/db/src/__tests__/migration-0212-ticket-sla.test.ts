import { describe, it, expect } from 'vitest'
import { getTableColumns } from 'drizzle-orm'
import { slaPolicies, slaEvents } from '../schema/sla'
import { tickets } from '../schema/tickets'
import { officeHoursSchedules } from '../schema/office-hours'

// 0212 is pure DDL: ticket-anchored SLA columns (TTR target, pending pause,
// tickets.sla_applied stamp, polymorphic sla_events subject) + the holiday
// calendar on office_hours_schedules. Guarded here at the drizzle-shape level
// (same style as schema.test.ts) — no data reshaping to exercise against a DB.
describe('migration 0212 ticket SLA + holidays schema', () => {
  it('sla_policies carries the ticket-side clock config', () => {
    const columns = Object.keys(getTableColumns(slaPolicies))
    expect(columns).toContain('timeToResolveTargetSecs')
    expect(columns).toContain('pauseOnPending')
    expect(getTableColumns(slaPolicies).pauseOnPending.notNull).toBe(true)
  })

  it('tickets carries the sla_applied stamp column', () => {
    const columns = Object.keys(getTableColumns(tickets))
    expect(columns).toContain('slaApplied')
    // NULL = no SLA applied (mirrors conversations.sla_applied).
    expect(getTableColumns(tickets).slaApplied.notNull).toBe(false)
  })

  it('sla_events has a polymorphic subject: nullable conversation + ticket', () => {
    const columns = getTableColumns(slaEvents)
    expect(columns.conversationId.notNull).toBe(false)
    expect(columns.ticketId.notNull).toBe(false)
    expect(columns.policyId.notNull).toBe(true)
  })

  it('office_hours_schedules carries the holiday calendar', () => {
    const columns = Object.keys(getTableColumns(officeHoursSchedules))
    expect(columns).toContain('holidays')
    expect(getTableColumns(officeHoursSchedules).holidays.notNull).toBe(true)
  })
})
