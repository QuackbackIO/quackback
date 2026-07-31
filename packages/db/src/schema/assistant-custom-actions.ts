/**
 * Custom-action definitions — Quinn's shared action library
 * (QUINN-TWO-AGENT-SPEC D6). One row per definition: a named HTTP request the
 * model can invoke, its model-facing routing text (`when_to_use`), the
 * variables the model fills, and the response-field allowlist that scopes which
 * parts of the response ever reach the model. Assignment is per agent (a
 * boolean each in `assignments`), with no run-mode dial (D14). Enabled +
 * assigned + the `assistantCustomActions` flag together decide registration.
 *
 * Secret header values are encrypted at rest (AES-256-GCM via the shared
 * `encrypt()` helper, purpose `assistant-custom-action-headers`); the stored
 * `value` on a `secret: true` header is ciphertext. The service is the only
 * place that decrypts, at request time.
 */
import {
  pgTable,
  text,
  boolean,
  integer,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
  check,
} from 'drizzle-orm/pg-core'
import { relations, sql } from 'drizzle-orm'
import { typeIdWithDefault, typeIdColumnNullable } from '@quackback/ids/drizzle'
import { principal } from './auth'

export const ASSISTANT_CUSTOM_ACTION_METHODS = ['GET', 'POST'] as const
export type AssistantCustomActionMethod = (typeof ASSISTANT_CUSTOM_ACTION_METHODS)[number]

/** A stored header. `value` is ciphertext when `secret`, plaintext otherwise. */
export interface StoredAssistantActionHeader {
  name: string
  value: string
  secret: boolean
}

/** A stored model-filled variable (name + model-facing description). */
export interface StoredAssistantActionVariable {
  name: string
  description: string
}

/** Per-agent assignment (D6): a boolean each, no run-mode dial (D14). */
export interface StoredAssistantActionAssignments {
  agent: boolean
  copilot: boolean
}

export const assistantActions = pgTable(
  'assistant_actions',
  {
    id: typeIdWithDefault('assistant_custom_action')('id').primaryKey(),
    name: text('name').notNull(),
    /** Model-facing routing text (§9 C5): "when should I call this action". */
    whenToUse: text('when_to_use').notNull(),
    method: text('method', { enum: ASSISTANT_CUSTOM_ACTION_METHODS }).notNull(),
    /** URL template; may contain `{{variable}}` placeholders. */
    url: text('url').notNull(),
    headers: jsonb('headers').$type<StoredAssistantActionHeader[]>().notNull().default([]),
    /** Body template (POST only); may contain `{{variable}}` placeholders. */
    body: text('body'),
    variables: jsonb('variables').$type<StoredAssistantActionVariable[]>().notNull().default([]),
    /** Dot-path allowlist: ONLY these response fields reach the model (D6). */
    responseAllowlist: jsonb('response_allowlist').$type<string[]>().notNull().default([]),
    responseCharLimit: integer('response_char_limit').notNull().default(4000),
    assignments: jsonb('assignments')
      .$type<StoredAssistantActionAssignments>()
      .notNull()
      .default({ agent: false, copilot: false }),
    enabled: boolean('enabled').notNull().default(true),
    // Nulled on the author's deletion — the definition outlives them.
    createdById: typeIdColumnNullable('principal')('created_by_id').references(() => principal.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('assistant_actions_enabled_idx').on(table.enabled),
    // Case-insensitive name uniqueness: backstops the service's slug-collision
    // check so the persisted `action_<slug>` tool name stays a stable 1:1 key.
    uniqueIndex('assistant_actions_name_lower_unique').on(sql`lower(${table.name})`),
    check('assistant_actions_name_length_check', sql`char_length(${table.name}) BETWEEN 1 AND 80`),
    check(
      'assistant_actions_when_to_use_length_check',
      sql`char_length(${table.whenToUse}) BETWEEN 1 AND 500`
    ),
    check('assistant_actions_method_check', sql`${table.method} IN ('GET', 'POST')`),
    check(
      'assistant_actions_response_char_limit_check',
      sql`${table.responseCharLimit} BETWEEN 100 AND 20000`
    ),
  ]
)

export const assistantActionsRelations = relations(assistantActions, ({ one }) => ({
  createdBy: one(principal, {
    fields: [assistantActions.createdById],
    references: [principal.id],
  }),
}))
