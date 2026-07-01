import {
  pgTable,
  text,
  timestamp,
  index,
  uniqueIndex,
  jsonb,
  integer,
  boolean,
  primaryKey,
} from 'drizzle-orm/pg-core'
import { relations } from 'drizzle-orm'
import { typeIdWithDefault, typeIdColumn, typeIdColumnNullable } from '@quackback/ids/drizzle'
import { principal } from './auth'
import {
  CONVERSATION_STATUSES,
  MESSAGE_SENDER_TYPES,
  CHANNELS,
  CONVERSATION_PRIORITIES,
} from '../types'
import type { ChatAttachment, ConversationMessageMetadata, TiptapContent } from '../types'

/**
 * Support-inbox conversations — one thread between a visitor (anonymous or
 * identified) and the team, arriving via any channel (live chat, email, ...).
 * Scoped to the tenant by the database connection (database-per-tenant); no
 * workspace column.
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
    // The inbound channel this conversation arrived on. Required and set
    // explicitly by every create path; no default, so a conversation on a new
    // channel ('email' / 'web_form' / ...) can never be silently labeled
    // messenger by an omitted insert (the NOT NULL makes an omission fail loud).
    channel: text('channel', { enum: CHANNELS }).notNull(),
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
    // Why the conversation was ended + an optional free-text note. The taxonomy
    // is enforced at the app layer (CONVERSATION_END_REASONS). Stored to power
    // resolution-rate reporting: resolved-rate = count(end_reason IN
    // ('resolved','tracked_as_feedback')) / count(all ended EXCLUDING 'spam').
    endReason: text('end_reason'),
    endNote: text('end_note'),
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
 * Individual chat messages. Flat (no threading), plain-text content. Author is
 * always a real principal; the visitor-facing welcome message is rendered from
 * settings, not stored, so there are no author-less rows.
 */
export const conversationMessages = pgTable(
  'conversation_messages',
  {
    id: typeIdWithDefault('chat_msg')('id').primaryKey(),
    conversationId: typeIdColumn('conversation')('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    // Nullable: system events (e.g. assignment notices) have no human author.
    principalId: typeIdColumnNullable('principal')('principal_id').references(() => principal.id, {
      onDelete: 'restrict',
    }),
    // Explicit sender side for rendering + authorization, independent of the
    // principal's current role (a team member could also be a visitor).
    senderType: text('sender_type', { enum: MESSAGE_SENDER_TYPES }).notNull(),
    content: text('content').notNull(),
    // Rich TipTap doc for messages that carry structured content (agent notes
    // with @-mentions). Null for plain live-chat/email messages, which render
    // from `content`. Mirrors comments/posts `content_json`.
    contentJson: jsonb('content_json').$type<TiptapContent>(),
    // Agent-only internal note — never sent to or visible to the visitor.
    isInternal: boolean('is_internal').notNull().default(false),
    // Image/file attachments (client-safe refs); null/empty for text-only messages.
    attachments: jsonb('attachments').$type<ChatAttachment[]>(),
    // Channel provenance (e.g. inbound email message-id for retry dedupe); null
    // for ordinary in-app live-chat messages.
    metadata: jsonb('metadata').$type<ConversationMessageMetadata>(),
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
    index('conversation_messages_conversation_created_idx').on(
      table.conversationId,
      table.createdAt,
      table.id
    ),
    index('conversation_messages_principal_idx').on(table.principalId),
    index('conversation_messages_created_at_idx').on(table.createdAt),
  ]
)

/**
 * Conversation tags — agent-managed, org-wide, created on the fly from a
 * conversation and used to filter the inbox. Same shape as the feedback tag
 * catalog (type ConversationTag mirrors PostTag) but intentionally SEPARATE: the two
 * share no rows, ids, or lifecycle, so a tag here never leaks into feedback
 * boards and vice-versa. Applied to conversations via `conversation_tag_assignments`.
 */
export const conversationTags = pgTable(
  'conversation_tags',
  {
    id: typeIdWithDefault('chat_tag')('id').primaryKey(),
    name: text('name').notNull().unique(),
    color: text('color').default('#6b7280').notNull(),
    description: text('description'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    // Soft delete: a removed tag detaches from conversations but keeps history.
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [index('conversation_tags_deleted_at_idx').on(table.deletedAt)]
)

/**
 * Join table: which conversation tags are applied to which conversation. Both FKs
 * cascade, so removing a conversation or hard-deleting a tag row cleans up.
 */
export const conversationTagAssignments = pgTable(
  'conversation_tag_assignments',
  {
    conversationId: typeIdColumn('conversation')('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    conversationTagId: typeIdColumn('chat_tag')('conversation_tag_id')
      .notNull()
      .references(() => conversationTags.id, { onDelete: 'cascade' }),
  },
  (table) => [
    uniqueIndex('conversation_tag_assignments_pk').on(
      table.conversationId,
      table.conversationTagId
    ),
    index('conversation_tag_assignments_tag_idx').on(table.conversationTagId),
  ]
)

/**
 * Join table: every @-mention of a team member inside a chat message (internal
 * notes only — mentions stay team-internal). Mirrors post_mentions: one row per
 * (message, principal), `notifiedAt` watermarks delivery so re-edits don't
 * re-notify, and (principal_id, created_at DESC) serves the "mentions of me"
 * inbox view straight from the index.
 */
export const conversationMessageMentions = pgTable(
  'conversation_message_mentions',
  {
    id: typeIdWithDefault('chat_msg_mention')('id').primaryKey(),
    conversationMessageId: typeIdColumn('chat_msg')('conversation_message_id')
      .notNull()
      .references(() => conversationMessages.id, { onDelete: 'cascade' }),
    principalId: typeIdColumn('principal')('principal_id')
      .notNull()
      .references(() => principal.id, { onDelete: 'cascade' }),
    notifiedAt: timestamp('notified_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('conversation_message_mentions_message_principal_uq').on(
      table.conversationMessageId,
      table.principalId
    ),
    index('conversation_message_mentions_principal_idx').on(
      table.principalId,
      table.createdAt.desc()
    ),
  ]
)

/**
 * Emoji reactions on a chat message — agent-only, mirroring comment_reactions.
 * One row per (message, principal, emoji); the unique index makes a repeat
 * reaction idempotent. Both FKs cascade. Never exposed to the visitor: loaded
 * only on the agent enrichment path and broadcast only on the inbox channel.
 */
export const conversationMessageReactions = pgTable(
  'conversation_message_reactions',
  {
    id: typeIdWithDefault('reaction')('id').primaryKey(),
    conversationMessageId: typeIdColumn('chat_msg')('conversation_message_id')
      .notNull()
      .references(() => conversationMessages.id, { onDelete: 'cascade' }),
    // Required — only authenticated team members can react.
    principalId: typeIdColumn('principal')('principal_id')
      .notNull()
      .references(() => principal.id, { onDelete: 'cascade' }),
    emoji: text('emoji').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('conversation_message_reactions_message_idx').on(table.conversationMessageId),
    index('conversation_message_reactions_principal_idx').on(table.principalId),
    uniqueIndex('conversation_message_reactions_unique_idx').on(
      table.conversationMessageId,
      table.principalId,
      table.emoji
    ),
  ]
)

/**
 * Per-agent "Saved for later" flag on a chat message. The composite (message,
 * principal) primary key means each agent flags messages independently — a flag
 * is a personal triage marker, not a shared team signal. Both FKs cascade.
 * Agent-only. The (principal, flagged_at DESC) index serves the per-agent feed.
 */
export const conversationMessageFlags = pgTable(
  'conversation_message_flags',
  {
    conversationMessageId: typeIdColumn('chat_msg')('conversation_message_id')
      .notNull()
      .references(() => conversationMessages.id, { onDelete: 'cascade' }),
    principalId: typeIdColumn('principal')('principal_id')
      .notNull()
      .references(() => principal.id, { onDelete: 'cascade' }),
    flaggedAt: timestamp('flagged_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.conversationMessageId, table.principalId] }),
    index('conversation_message_flags_principal_idx').on(table.principalId, table.flaggedAt.desc()),
  ]
)

export const conversationsRelations = relations(conversations, ({ many }) => ({
  messages: many(conversationMessages),
  tags: many(conversationTagAssignments),
}))

export const conversationTagsRelations = relations(conversationTags, ({ many }) => ({
  conversationTagAssignments: many(conversationTagAssignments),
}))

export const conversationTagAssignmentsRelations = relations(
  conversationTagAssignments,
  ({ one }) => ({
    conversation: one(conversations, {
      fields: [conversationTagAssignments.conversationId],
      references: [conversations.id],
    }),
    tag: one(conversationTags, {
      fields: [conversationTagAssignments.conversationTagId],
      references: [conversationTags.id],
    }),
  })
)

export const conversationMessageMentionsRelations = relations(
  conversationMessageMentions,
  ({ one }) => ({
    message: one(conversationMessages, {
      fields: [conversationMessageMentions.conversationMessageId],
      references: [conversationMessages.id],
    }),
    principal: one(principal, {
      fields: [conversationMessageMentions.principalId],
      references: [principal.id],
    }),
  })
)

export const conversationMessageReactionsRelations = relations(
  conversationMessageReactions,
  ({ one }) => ({
    message: one(conversationMessages, {
      fields: [conversationMessageReactions.conversationMessageId],
      references: [conversationMessages.id],
    }),
    principal: one(principal, {
      fields: [conversationMessageReactions.principalId],
      references: [principal.id],
    }),
  })
)

export const conversationMessageFlagsRelations = relations(conversationMessageFlags, ({ one }) => ({
  message: one(conversationMessages, {
    fields: [conversationMessageFlags.conversationMessageId],
    references: [conversationMessages.id],
  }),
  principal: one(principal, {
    fields: [conversationMessageFlags.principalId],
    references: [principal.id],
  }),
}))

export const conversationMessagesRelations = relations(conversationMessages, ({ one, many }) => ({
  conversation: one(conversations, {
    fields: [conversationMessages.conversationId],
    references: [conversations.id],
  }),
  mentions: many(conversationMessageMentions),
  reactions: many(conversationMessageReactions),
  flags: many(conversationMessageFlags),
}))
