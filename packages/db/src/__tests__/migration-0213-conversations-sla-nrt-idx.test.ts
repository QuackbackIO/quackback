import { describe, it, expect } from 'vitest'
import { getTableConfig } from 'drizzle-orm/pg-core'
import { conversations } from '../schema/conversation'

// 0213 is pure DDL: it widens the conversations_sla_unsettled_idx partial
// predicate (0187) with the armed-but-unsettled next-response arm, so the SLA
// sweeps' literal top-level clause keeps proving the partial index applies now
// that rearmNextResponse can arm an NRT cycle on an otherwise fully-settled
// stamp (e.g. a customer re-pinging a reopened, resolved thread). Guarded at
// the drizzle-shape level (same style as migration-0212-ticket-sla.test.ts) —
// nothing to exercise against a live DB for an index predicate.
describe('migration 0213 conversations SLA NRT unsettled index', () => {
  it('the unsettled-sweep partial index covers an armed next-response cycle', () => {
    const cfg = getTableConfig(conversations)
    const idx = cfg.indexes.find((i) => i.config.name === 'conversations_sla_unsettled_idx')
    expect(idx).toBeDefined()
    // drizzle keeps the `.where(sql`...`)` template as queryChunks — flatten
    // them back to the raw predicate text.
    const chunks = (idx!.config.where as unknown as { queryChunks: { value: unknown }[] })
      .queryChunks
    const where = chunks
      .map((c) => (Array.isArray(c.value) ? c.value.join('') : String(c.value)))
      .join('')
    // The 0187 arms stay, and the NRT arm tests due-set AND unsettled (not a
    // bare nextResponseAt IS NULL, which is absent-until-settled and would
    // match nearly every stamp, gutting the partial index's selectivity).
    expect(where).toContain(`(sla_applied ->> 'firstResponseAt') IS NULL`)
    expect(where).toContain(`(sla_applied ->> 'resolvedAt') IS NULL`)
    expect(where).toContain(`(sla_applied ->> 'nextResponseDueAt') IS NOT NULL`)
    expect(where).toContain(`(sla_applied ->> 'nextResponseAt') IS NULL`)
  })
})
