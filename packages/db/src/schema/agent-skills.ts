/**
 * Agent skills — packaged procedures the agents pull on demand.
 *
 * Skills are instructions, not capabilities: loading one never grants a tool.
 * The compiled catalogue (name + when-to-use) is always in the prompt; the
 * markdown body is fetched via the built-in `use_skill` tool.
 */
import {
  pgTable,
  text,
  boolean,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
  check,
} from 'drizzle-orm/pg-core'
import { relations, sql } from 'drizzle-orm'
import { typeIdWithDefault, typeIdColumnNullable } from '@quackback/ids/drizzle'
import { principal } from './auth'

export interface SkillAssignments {
  agent: boolean
  copilot: boolean
}

export const DEFAULT_SKILL_ASSIGNMENTS: SkillAssignments = {
  agent: false,
  copilot: false,
}

export const agentSkills = pgTable(
  'agent_skills',
  {
    id: typeIdWithDefault('skill')('id').primaryKey(),
    name: text('name').notNull(),
    whenToUse: text('when_to_use').notNull(),
    instructions: text('instructions').notNull(),
    assignments: jsonb('assignments')
      .$type<SkillAssignments>()
      .notNull()
      .default(DEFAULT_SKILL_ASSIGNMENTS),
    enabled: boolean('enabled').notNull().default(true),
    createdByPrincipalId: typeIdColumnNullable('principal')('created_by_principal_id').references(
      () => principal.id,
      { onDelete: 'set null' }
    ),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('agent_skills_name_lower_unique').on(sql`lower(${table.name})`),
    index('agent_skills_enabled_idx').on(table.enabled),
    check('agent_skills_name_length_check', sql`char_length(${table.name}) BETWEEN 1 AND 80`),
    check(
      'agent_skills_when_to_use_length_check',
      sql`char_length(${table.whenToUse}) BETWEEN 1 AND 240`
    ),
    check(
      'agent_skills_instructions_length_check',
      sql`char_length(${table.instructions}) BETWEEN 1 AND 8000`
    ),
  ]
)

export const agentSkillsRelations = relations(agentSkills, ({ one }) => ({
  createdBy: one(principal, {
    fields: [agentSkills.createdByPrincipalId],
    references: [principal.id],
  }),
}))
