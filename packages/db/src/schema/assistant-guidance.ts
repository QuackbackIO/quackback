/**
 * Guidance rules — short admin-authored directives Quinn's prompt assembly
 * folds in alongside its system prompt (e.g. "always mention the refund
 * policy on billing questions"). A NULL `surfaces` list means the rule
 * applies everywhere; otherwise it is scoped to an allowlist of
 * `AssistantSurface` values. `position` orders both prompt assembly and the
 * admin reorder UI.
 */
import { pgTable, text, boolean, integer, timestamp, index, check } from 'drizzle-orm/pg-core'
import { relations, sql } from 'drizzle-orm'
import { typeIdWithDefault, typeIdColumnNullable } from '@quackback/ids/drizzle'
import { principal } from './auth'

export const assistantGuidanceRules = pgTable(
  'assistant_guidance_rules',
  {
    id: typeIdWithDefault('assistant_guidance')('id').primaryKey(),
    title: text('title').notNull(),
    body: text('body').notNull(),
    enabled: boolean('enabled').notNull().default(true),
    // NULL = every surface; otherwise an allowlist of AssistantSurface values.
    surfaces: text('surfaces').array(),
    position: integer('position').notNull().default(0),
    // Nulled on the author's deletion — the rule outlives them.
    createdById: typeIdColumnNullable('principal')('created_by_id').references(() => principal.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('assistant_guidance_rules_enabled_position_idx').on(table.enabled, table.position),
    check('assistant_guidance_rules_title_length_check', sql`char_length(${table.title}) <= 80`),
    check('assistant_guidance_rules_body_length_check', sql`char_length(${table.body}) <= 1000`),
  ]
)

export const assistantGuidanceRulesRelations = relations(assistantGuidanceRules, ({ one }) => ({
  createdBy: one(principal, {
    fields: [assistantGuidanceRules.createdById],
    references: [principal.id],
  }),
}))
