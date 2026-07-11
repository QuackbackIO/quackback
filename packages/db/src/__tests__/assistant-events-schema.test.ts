import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { getTableName, getTableColumns } from 'drizzle-orm'
import { getTableConfig } from 'drizzle-orm/pg-core'
import { assistantEvents } from '../schema/assistant-events'

/**
 * Pins the assistant_events usage-event log (migration 0180, the Quinn
 * Copilot outcome loop) to the shape its writers and readers assume:
 * append-only rows keyed by an open-text event_type, both item FKs nullable
 * (an event is telemetry, not a child of the item), and the
 * (event_type, created_at) index the Copilot usage report's bounded
 * date-range scan rides.
 */
describe('assistant events schema (migration 0180)', () => {
  it('has the correct table name', () => {
    expect(getTableName(assistantEvents)).toBe('assistant_events')
  })

  it('carries exactly the outcome-loop columns', () => {
    const columns = Object.keys(getTableColumns(assistantEvents))
    expect(columns.sort()).toEqual(
      [
        'id',
        'eventType',
        'principalId',
        'conversationId',
        'ticketId',
        'metadata',
        'createdAt',
      ].sort()
    )
  })

  it('keeps event_type open text (no enum) so new surfaces need no migration', () => {
    expect(assistantEvents.eventType.notNull).toBe(true)
    expect(assistantEvents.eventType.enumValues ?? []).toEqual([])
  })

  it('leaves every attribution column nullable — an event always lands', () => {
    expect(assistantEvents.principalId.notNull).toBe(false)
    expect(assistantEvents.conversationId.notNull).toBe(false)
    expect(assistantEvents.ticketId.notNull).toBe(false)
  })

  it('defaults metadata to an empty object', () => {
    expect(assistantEvents.metadata.notNull).toBe(true)
    expect(assistantEvents.metadata.default).toEqual({})
  })

  it('has the (event_type, created_at) index the usage report scans ride', () => {
    const cfg = getTableConfig(assistantEvents)
    const idx = cfg.indexes.find(
      (i) => i.config.name === 'assistant_events_event_type_created_at_idx'
    )
    expect(idx).toBeDefined()
    const cols = (idx?.config.columns ?? []).map((c) =>
      typeof c === 'object' && c !== null && 'name' in c ? (c as { name: string }).name : ''
    )
    expect(cols).toEqual(['event_type', 'created_at'])
  })

  it('0180 migration pins the load-bearing constraints', () => {
    const sql = readFileSync(join(__dirname, '../../drizzle/0180_assistant_events.sql'), 'utf8')
    // Teammate attribution survives teammate deletion; the count still tallies.
    expect(sql).toMatch(
      /FOREIGN KEY \("principal_id"\) REFERENCES "public"\."principal"\("id"\) ON DELETE set null/
    )
    // Item-scoped events go with their item.
    expect(sql).toMatch(
      /FOREIGN KEY \("conversation_id"\) REFERENCES "public"\."conversations"\("id"\) ON DELETE cascade/
    )
    expect(sql).toMatch(
      /FOREIGN KEY \("ticket_id"\) REFERENCES "public"\."tickets"\("id"\) ON DELETE cascade/
    )
    expect(sql).toMatch(
      /CREATE INDEX "assistant_events_event_type_created_at_idx"\s+ON "assistant_events" USING btree \("event_type","created_at"\)/
    )
  })
})
