import {
  pgTable,
  text,
  timestamp,
  index,
  uniqueIndex,
  jsonb,
  integer,
  boolean,
} from 'drizzle-orm/pg-core'
import { relations } from 'drizzle-orm'
import { typeIdWithDefault, typeIdColumn, typeIdColumnNullable } from '@quackback/ids/drizzle'
import { principal } from './auth'
import { tags } from './boards'
import {
  CONVERSATION_STATUSES,
  CHAT_SENDER_TYPES,
  CHANNELS,
  CONVERSATION_PRIORITIES,
} from '../types'
import type { ChatAttachment, ChatMessageMetadata } from '../types'

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
    // The inbound channel this conversation arrived on. Existing widget threads
    // are 'live_chat'; 'email' / 'web_form' are added in later phases so the
    // inbox is one polymorphic conversation type rather than separate objects.
    channel: text('channel', { enum: CHANNELS }).notNull().default('live_chat'),
    // Agent-set triage priority. 'none' = unset (the default for every row).
    priority: text('priority', { enum: CONVERSATION_PRIORITIES }).notNull().default('none'),
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
    // When the conversation was resolved/closed (set on close, cleared on
    // reopen). Drives resolution reporting and the resolved-vs-active split.
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    // Optional contact email captured from an anonymous visitor for offline
    // follow-up. Agent-only; the principal itself stays anonymous.
    visitorEmail: text('visitor_email'),
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
 * Conversation labels — reuses the shared `tags` vocabulary so the inbox and
 * feedback posts draw from one set of labels (powering the feedback<->support
 * loop). Agent-only; never exposed to the visitor. Both FKs cascade so deleting
 * a tag or a conversation cleans up here.
 */
export const conversationTags = pgTable(
  'conversation_tags',
  {
    conversationId: typeIdColumn('conversation')('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    tagId: typeIdColumn('tag')('tag_id')
      .notNull()
      .references(() => tags.id, { onDelete: 'cascade' }),
  },
  (table) => [
    uniqueIndex('conversation_tags_pk').on(table.conversationId, table.tagId),
    index('conversation_tags_conversation_id_idx').on(table.conversationId),
    index('conversation_tags_tag_id_idx').on(table.tagId),
  ]
)

/**
 * Conversation watchers — team members who follow a conversation and get
 * notified of new visitor messages even when they aren't the assignee. Both FKs
 * cascade: deleting a conversation or a principal removes the watch.
 */
export const conversationWatchers = pgTable(
  'conversation_watchers',
  {
    conversationId: typeIdColumn('conversation')('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    principalId: typeIdColumn('principal')('principal_id')
      .notNull()
      .references(() => principal.id, { onDelete: 'cascade' }),
  },
  (table) => [
    uniqueIndex('conversation_watchers_pk').on(table.conversationId, table.principalId),
    index('conversation_watchers_conversation_id_idx').on(table.conversationId),
    index('conversation_watchers_principal_id_idx').on(table.principalId),
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
    // Agent-only internal note — never sent to or visible to the visitor.
    isInternal: boolean('is_internal').notNull().default(false),
    // Image/file attachments (client-safe refs); null/empty for text-only messages.
    attachments: jsonb('attachments').$type<ChatAttachment[]>(),
    // Channel provenance (e.g. inbound email message-id for retry dedupe); null
    // for ordinary in-app live-chat messages.
    metadata: jsonb('metadata').$type<ChatMessageMetadata>(),
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
