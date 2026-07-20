import { describe, it, expect } from 'vitest'
import { getTableConfig } from 'drizzle-orm/pg-core'
import { ticketConversations } from '../schema/tickets'

// 0214 is pure DDL: a partial unique index on ticket_conversations(ticket_id)
// WHERE ticket_type = 'customer' — the mirror image of 0150's
// ticket_conversations_customer_uq (one customer ticket per conversation).
// Together they make the conversation<->ticket pair 1:1 on the customer side,
// so the convergence Phase 0 pair-thread union loader
// (scratchpad/convergence-design.md, mechanics appendix) can resolve "the
// pair" from either direction. Guarded at the drizzle-shape level (same style
// as migration-0213-conversations-sla-nrt-idx.test.ts) — nothing to exercise
// against a live DB for an index predicate.
describe('migration 0214 ticket_conversations customer-ticket unique index', () => {
  it('enforces at most one conversation per CUSTOMER ticket, partially', () => {
    const cfg = getTableConfig(ticketConversations)
    const idx = cfg.indexes.find((i) => i.config.name === 'ticket_conversations_customer_ticket_uq')
    expect(idx).toBeDefined()
    expect(idx!.config.unique).toBe(true)
    expect(idx!.config.columns.map((c) => c.name)).toEqual(['ticket_id'])
    // Partial on the denormalized link type — back-office/tracker links never
    // collide (same predicate shape as the conversation-side 0150 index).
    const chunks = (idx!.config.where as unknown as { queryChunks: { value: unknown }[] })
      .queryChunks
    const where = chunks
      .map((c) => (Array.isArray(c.value) ? c.value.join('') : String(c.value)))
      .join('')
    expect(where).toBe(`ticket_type = 'customer'`)
  })

  it('keeps the 0150 conversation-side index (the pair rule needs both halves)', () => {
    const cfg = getTableConfig(ticketConversations)
    const idx = cfg.indexes.find((i) => i.config.name === 'ticket_conversations_customer_uq')
    expect(idx).toBeDefined()
    expect(idx!.config.unique).toBe(true)
    expect(idx!.config.columns.map((c) => c.name)).toEqual(['conversation_id'])
  })
})
