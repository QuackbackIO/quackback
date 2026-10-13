import {
  pgTable,
  text,
  timestamp,
  integer,
  index,
  uniqueIndex,
  check,
  foreignKey,
} from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { typeIdWithDefault, typeIdColumn, typeIdColumnNullable } from '@quackback/ids/drizzle'
import { conversations, conversationMessages } from './conversation'
import { principal } from './auth'

/**
 * Who can answer customers. The built-in Quackback AI is seeded as one row; a
 * workspace's own AI agent is a second row of kind `external`, reached by a
 * signed webhook and answering over the REST API with its own credential.
 */
export const SUPPORT_AGENT_KINDS = ['quackback_ai', 'external'] as const
export const SUPPORT_AGENT_STATUSES = ['active', 'paused'] as const
/** Where a conversation goes when the agent does not answer in time. */
export const SUPPORT_AGENT_FALLBACKS = ['quackback_ai', 'team'] as const

export type SupportAgentKind = (typeof SUPPORT_AGENT_KINDS)[number]
export type SupportAgentStatus = (typeof SUPPORT_AGENT_STATUSES)[number]
export type SupportAgentFallback = (typeof SUPPORT_AGENT_FALLBACKS)[number]

export const supportAgents = pgTable(
  'support_agents',
  {
    id: typeIdWithDefault('support_agent')('id').primaryKey(),
    kind: text('kind', { enum: SUPPORT_AGENT_KINDS }).notNull(),
    name: text('name').notNull(),
    status: text('status', { enum: SUPPORT_AGENT_STATUSES }).notNull().default('active'),
    // Where turn requests are delivered. Null for the built-in AI.
    endpointUrl: text('endpoint_url'),
    // Encrypted secret that signs outbound deliveries to the agent.
    signingSecretEnc: text('signing_secret_enc'),
    // SHA-256 of the agent's own `qba_` credential, and its first characters
    // for display. The credential itself is shown once.
    credentialHash: text('credential_hash'),
    credentialPrefix: text('credential_prefix'),
    // The service principal that authors the agent's replies.
    principalId: typeIdColumnNullable('principal')('principal_id').references(() => principal.id, {
      onDelete: 'set null',
    }),
    replyDeadlineSeconds: integer('reply_deadline_seconds').notNull().default(20),
    fallback: text('fallback', { enum: SUPPORT_AGENT_FALLBACKS }).notNull().default('team'),
    lastDeliveredAt: timestamp('last_delivered_at', { withTimezone: true }),
    lastError: text('last_error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    // One built-in row and at most one live external agent.
    uniqueIndex('support_agents_kind_live_idx')
      .on(t.kind)
      .where(sql`${t.deletedAt} IS NULL`),
    uniqueIndex('support_agents_credential_hash_idx')
      .on(t.credentialHash)
      .where(sql`${t.credentialHash} IS NOT NULL`),
    check('support_agents_deadline_check', sql`${t.replyDeadlineSeconds} BETWEEN 5 AND 120`),
  ]
)

export const SUPPORT_AGENT_TURN_STATUSES = [
  'requested',
  'replied',
  'handed_off',
  'resolved',
  'expired',
  'superseded',
] as const
export type SupportAgentTurnStatus = (typeof SUPPORT_AGENT_TURN_STATUSES)[number]

/**
 * One request for an agent to answer a customer message. The row is the lease:
 * only the turn still `requested` can be answered, a newer customer message
 * supersedes it, and the deadline sweep expires it.
 */
export const supportAgentTurns = pgTable(
  'support_agent_turns',
  {
    id: typeIdWithDefault('support_agent_turn')('id').primaryKey(),
    conversationId: typeIdColumn('conversation')('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    agentId: typeIdColumn('support_agent')('agent_id')
      .notNull()
      .references(() => supportAgents.id, { onDelete: 'cascade' }),
    triggerMessageId: typeIdColumnNullable('conversation_msg')('trigger_message_id'),
    status: text('status', { enum: SUPPORT_AGENT_TURN_STATUSES }).notNull().default('requested'),
    deadlineAt: timestamp('deadline_at', { withTimezone: true }).notNull(),
    // The idempotency key of the reply that answered the turn, and the message
    // it posted, so a retried reply returns the same message.
    replyKey: text('reply_key'),
    replyMessageId: typeIdColumnNullable('conversation_msg')('reply_message_id'),
    // Set once the fallback has handled an expired turn, so the sweep acts once.
    fallbackAppliedAt: timestamp('fallback_applied_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (t) => [
    // The constraint name is spelled out: the generated one is longer than
    // Postgres keeps.
    foreignKey({
      name: 'support_agent_turns_trigger_message_fk',
      columns: [t.triggerMessageId],
      foreignColumns: [conversationMessages.id],
    }).onDelete('set null'),
    index('support_agent_turns_conversation_idx').on(t.conversationId, t.createdAt),
    uniqueIndex('support_agent_turns_one_open_idx')
      .on(t.conversationId)
      .where(sql`${t.status} = 'requested'`),
    uniqueIndex('support_agent_turns_trigger_idx')
      .on(t.conversationId, t.triggerMessageId)
      .where(sql`${t.triggerMessageId} IS NOT NULL`),
    // The deadline sweep reads only turns still waiting for an answer.
    index('support_agent_turns_open_deadline_idx')
      .on(t.deadlineAt)
      .where(sql`${t.status} = 'requested'`),
  ]
)
