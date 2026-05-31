import { pgTable, text, timestamp, index, jsonb, integer } from 'drizzle-orm/pg-core'
import { relations } from 'drizzle-orm'
import { typeIdWithDefault, typeIdColumn, typeIdColumnNullable } from '@quackback/ids/drizzle'
import { principal } from './auth'
import { CONVERSATION_STATUSES, CHAT_SENDER_TYPES } from '../types'
import type { ChatAttachment } from '../types'

/**
 * Live chat conversations — one thread between a visitor (anonymous or
 * identified) and the support team. Scoped to the tenant by the database
 * connection (database-per-tenant); no workspace column.
 */
export const conversations = pgTable(
  'conversations',
  {
    id: typeIdWithDefault('conversation')('id').primaryKey(),
    // The visitor side of the conversation. `restrict` so a principal that
    // owns chat history can never be silently orphaned — the anonymous→
    // identified merge re-points this column (see merge-anonymous.ts).
    visitorPrincipalId: typeIdColumn('principal')('visitor_principal_id')
      .notNull()
      .references(() => principal.id, { onDelete: 'restrict' }),
    // The team member currently handling the conversation (nullable: an open
    // conversation may be unassigned). `set null` mirrors other actor FKs.
    assignedAgentPrincipalId: typeIdColumnNullable('principal')(
      'assigned_agent_principal_id'
    ).references(() => principal.id, { onDelete: 'set null' }),
    status: text('status', { enum: CONVERSATION_STATUSES }).notNull().default('open'),
    // Optional human-readable subject, derived from the first message for the
    // inbox list. Plain text.
    subject: text('subject'),
    // Denormalized last-message preview + timestamp drive the inbox feed
    // (sort + at-a-glance) without a per-row subquery.
    lastMessagePreview: text('last_message_preview'),
    lastMessageAt: timestamp('last_message_at', { withTimezone: true }).defaultNow().notNull(),
    // Read receipts power unread badges on each side independently.
    visitorLastReadAt: timestamp('visitor_last_read_at', { withTimezone: true }),
    agentLastReadAt: timestamp('agent_last_read_at', { withTimezone: true }),
    // Post-conversation CSAT rating (1-5), submitted by the visitor.
    csatRating: integer('csat_rating'),
    csatComment: text('csat_comment'),
    csatSubmittedAt: timestamp('csat_submitted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }),
  },
  (table) => [
    // Inbox feed: list by status, newest activity first.
    index('conversations_status_last_message_idx').on(table.status, table.lastMessageAt),
    index('conversations_visitor_principal_idx').on(table.visitorPrincipalId),
    index('conversations_assigned_agent_idx').on(table.assignedAgentPrincipalId),
  ]
)

/**
 * Individual chat messages. Flat (no threading), plain-text content. Author is
 * always a real principal; the visitor-facing welcome message is rendered from
 * settings, not stored, so there are no author-less rows.
 */
export const chatMessages = pgTable(
  'chat_messages',
  {
    id: typeIdWithDefault('chat_msg')('id').primaryKey(),
    conversationId: typeIdColumn('conversation')('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    principalId: typeIdColumn('principal')('principal_id')
      .notNull()
      .references(() => principal.id, { onDelete: 'restrict' }),
    // Explicit sender side for rendering + authorization, independent of the
    // principal's current role (a team member could also be a visitor).
    senderType: text('sender_type', { enum: CHAT_SENDER_TYPES }).notNull(),
    content: text('content').notNull(),
    // Image/file attachments (client-safe refs); null/empty for text-only messages.
    attachments: jsonb('attachments').$type<ChatAttachment[]>(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }),
    // Soft delete support, mirroring comments.
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    deletedByPrincipalId: typeIdColumnNullable('principal')('deleted_by_principal_id').references(
      () => principal.id,
      { onDelete: 'set null' }
    ),
  },
  (table) => [
    // Live feed + keyset pagination on the composite (conversationId, createdAt, id);
    // id is the tie-break so same-microsecond siblings page deterministically.
    index('chat_messages_conversation_created_idx').on(
      table.conversationId,
      table.createdAt,
      table.id
    ),
    index('chat_messages_principal_idx').on(table.principalId),
    index('chat_messages_created_at_idx').on(table.createdAt),
  ]
)

export const conversationsRelations = relations(conversations, ({ many }) => ({
  messages: many(chatMessages),
}))

export const chatMessagesRelations = relations(chatMessages, ({ one }) => ({
  conversation: one(conversations, {
    fields: [chatMessages.conversationId],
    references: [conversations.id],
  }),
}))
