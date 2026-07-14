import { pgTable, text, timestamp, index, customType } from 'drizzle-orm/pg-core'
import { relations, sql } from 'drizzle-orm'
import { typeIdWithDefault, typeIdColumn, typeIdColumnNullable } from '@quackback/ids/drizzle'
import { tickets } from './tickets'
import { principal } from './auth'

/** pgvector column, 1536 dims (OpenAI text-embedding-3-small). Local to this
 *  file, mirroring the per-schema-file `vector` customType convention (see
 *  conversation-summary.ts / posts.ts / kb.ts) rather than a shared export. */
const vector = customType<{ data: number[] }>({
  dataType() {
    return 'vector(1536)'
  },
})

/**
 * One AI-generated resolution summary per closed ticket (Quinn Phase 4:
 * ticket grounding), produced by `ticket-summary.service.ts` on close from the
 * ticket's customer-visible thread — `listTicketMessages({ includeInternal:
 * false })` excludes internal notes, so a note never enters a summary — and
 * embedded for semantic retrieval, mirroring `conversation_summaries`.
 *
 * UNLIKE conversation summaries, ticket summaries are NOT customer-scoped at
 * retrieval time: a closed ticket is team knowledge (a copilot-only,
 * team-ceiling source — see `tickets-retrieval.ts`), never surfaced to a
 * customer. `requester_principal_id` is denormalized from the parent ticket
 * for provenance / FK integrity, not as a scoping predicate — retrieval spans
 * every ticket within the recency window regardless of requester.
 */
export const ticketSummaries = pgTable(
  'ticket_summaries',
  {
    id: typeIdWithDefault('ticket_summary')('id').primaryKey(),
    ticketId: typeIdColumn('ticket')('ticket_id')
      .notNull()
      .unique()
      .references(() => tickets.id, { onDelete: 'cascade' }),
    // Denormalized from tickets.requesterPrincipalId (nullable there too — a
    // ticket need not have a portal requester). `set null` so a deleted
    // principal drops the provenance link without deleting the summary itself.
    requesterPrincipalId: typeIdColumnNullable('principal')('requester_principal_id').references(
      () => principal.id,
      { onDelete: 'set null' }
    ),
    summary: text('summary').notNull(),
    embedding: vector('embedding'),
    embeddingModel: text('embedding_model'),
    embeddingUpdatedAt: timestamp('embedding_updated_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('ticket_summaries_requester_principal_id_idx').on(table.requesterPrincipalId),
    index('ticket_summaries_embedding_hnsw_idx')
      .using('hnsw', sql`${table.embedding} vector_cosine_ops`)
      .where(sql`${table.embedding} IS NOT NULL`),
  ]
)

export type TicketSummary = typeof ticketSummaries.$inferSelect

export const ticketSummariesRelations = relations(ticketSummaries, ({ one }) => ({
  ticket: one(tickets, {
    fields: [ticketSummaries.ticketId],
    references: [tickets.id],
  }),
  requesterPrincipal: one(principal, {
    fields: [ticketSummaries.requesterPrincipalId],
    references: [principal.id],
  }),
}))
