/**
 * Routing rules — Phase 4 of the ticketing rollout.
 *
 * A routing rule is a JSON-encoded predicate plus a list of actions, evaluated
 * against incoming tickets at create time. Rules are first-match-wins ordered
 * by `(priority asc, createdAt asc)`.
 *
 * The conditions/actions JSON shape is enforced at the application layer
 * (`domains/inboxes/routing.types.ts` Zod schemas) — keeping them as opaque
 * jsonb at the database layer lets us evolve the rule grammar without
 * destructive migrations.
 */
import { pgTable, text, timestamp, jsonb, boolean, integer, index } from 'drizzle-orm/pg-core'
import type { AuditJsonValue } from './audit-events'
import { relations } from 'drizzle-orm'
import { typeIdWithDefault, typeIdColumnNullable } from '@quackback/ids/drizzle'
import { inboxes } from './inboxes'

export const routingRules = pgTable(
  'routing_rules',
  {
    id: typeIdWithDefault('route_rule')('id').primaryKey(),
    name: text('name').notNull(),
    description: text('description'),
    /** Lower priority value runs first. */
    priority: integer('priority').notNull().default(100),
    enabled: boolean('enabled').notNull().default(true),
    /** `{ match: 'all' | 'any', conditions: RoutingCondition[] }` */
    conditions: jsonb('conditions').$type<AuditJsonValue>().notNull(),
    /** `RoutingAction[]` */
    actions: jsonb('actions').$type<AuditJsonValue>().notNull(),
    /** Optional inbox scope: when set, the rule is only evaluated for tickets
     *  bound to this inbox. NULL = workspace-wide. */
    inboxIdScope: typeIdColumnNullable('inbox')('inbox_id_scope').references(() => inboxes.id, {
      onDelete: 'set null',
    }),
    lastMatchedAt: timestamp('last_matched_at', { withTimezone: true }),
    matchCount: integer('match_count').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (t) => [
    index('routing_rules_priority_idx').on(t.priority),
    index('routing_rules_inbox_scope_idx').on(t.inboxIdScope),
    index('routing_rules_enabled_idx').on(t.enabled),
  ]
)

export const routingRulesRelations = relations(routingRules, ({ one }) => ({
  inboxScope: one(inboxes, {
    fields: [routingRules.inboxIdScope],
    references: [inboxes.id],
  }),
}))
