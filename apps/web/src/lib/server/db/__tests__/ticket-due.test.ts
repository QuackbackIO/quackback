/**
 * Renders `ticketDueConditionSql` through a real `PgDialect` (no live database
 * needed) and asserts the SQL text + bound params for each Due date filter.
 * The fragment references the unaliased `tickets` columns, so both callers
 * (the ticket list and the conversation list's pair-edge EXISTS) must keep
 * `tickets` unaliased; the qualified column names below are that contract.
 * "Overdue" and "due soon" both exclude resolved tickets, and the window is
 * the shared 24 hours.
 */
import { describe, expect, it } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import { ticketDueConditionSql } from '../ticket-due'
import {
  linkedCustomerTicketDueAtSql,
  linkedCustomerTicketDueSql,
} from '@/lib/server/messages/pair-link'

const dialect = new PgDialect()
const NOW = new Date('2026-10-14T12:00:00.000Z')
const squash = (s: string) => s.replace(/\s+/g, ' ').trim()

describe('ticketDueConditionSql', () => {
  it('overdue: dated, unresolved and at or past now', () => {
    const { sql, params } = dialect.sqlToQuery(ticketDueConditionSql('overdue', NOW))
    expect(sql).toBe(
      '("tickets"."due_at" IS NOT NULL AND "tickets"."resolved_at" IS NULL AND "tickets"."due_at" <= $1::timestamptz)'
    )
    expect(params).toEqual(['2026-10-14T12:00:00.000Z'])
  })

  it('due soon: unresolved, after now and within the next 24 hours', () => {
    const { sql, params } = dialect.sqlToQuery(ticketDueConditionSql('due_soon', NOW))
    expect(sql).toBe(
      '("tickets"."resolved_at" IS NULL AND "tickets"."due_at" > $1::timestamptz AND "tickets"."due_at" <= $2::timestamptz)'
    )
    expect(params).toEqual(['2026-10-14T12:00:00.000Z', '2026-10-15T12:00:00.000Z'])
  })

  it('none: no due date', () => {
    const { sql, params } = dialect.sqlToQuery(ticketDueConditionSql('none', NOW))
    expect(sql).toBe('"tickets"."due_at" IS NULL')
    expect(params).toEqual([])
  })
})

describe('pair-link due fragments', () => {
  it('filters through the live customer pair edge with the shared condition', () => {
    const { sql, params } = dialect.sqlToQuery(linkedCustomerTicketDueSql('none', NOW))
    expect(squash(sql)).toBe(
      `EXISTS ( SELECT 1 FROM "ticket_conversations" tc INNER JOIN "tickets" ON "tickets"."id" = tc.ticket_id AND "tickets"."deleted_at" IS NULL WHERE tc.conversation_id = "conversations"."id" AND tc.ticket_type = 'customer' AND "tickets"."due_at" IS NULL )`
    )
    expect(params).toEqual([])
  })

  it("reads the live customer ticket's due date for the sort", () => {
    const { sql } = dialect.sqlToQuery(linkedCustomerTicketDueAtSql())
    expect(squash(sql)).toBe(
      `( SELECT "tickets"."due_at" FROM "ticket_conversations" tc INNER JOIN "tickets" ON "tickets"."id" = tc.ticket_id AND "tickets"."deleted_at" IS NULL WHERE tc.conversation_id = "conversations"."id" AND tc.ticket_type = 'customer' LIMIT 1 )`
    )
  })
})
