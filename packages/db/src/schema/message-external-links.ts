/**
 * A ticket message mirrored with a comment on a linked issue: one row per
 * message and linked issue (`ticket_external_links`), naming the comment that
 * stands for it there. An outbound row is a comment the connection posted and
 * so owns: an edit, a file change or a deletion of the reply follows onto
 * that comment, and onto nothing else. An inbound row is a comment brought in
 * from the issue as a note or reply, which its edits and deletion follow.
 *
 * A table rather than a comment id in the message's metadata: the inbox edit
 * path reads `metadata.githubCommentId` as a channel thread's comment, which a
 * tracker-linked ticket does not have.
 */
import { pgTable, text, timestamp, index, uniqueIndex, foreignKey } from 'drizzle-orm/pg-core'
import { relations } from 'drizzle-orm'
import { typeIdWithDefault, typeIdColumn } from '@quackback/ids/drizzle'
import { conversationMessages } from './conversation'
import { ticketExternalLinks } from './external-links'
import { integrations } from './integrations'

export const MESSAGE_EXTERNAL_LINK_DIRECTIONS = ['outbound', 'inbound'] as const
export const MESSAGE_EXTERNAL_LINK_STATUSES = ['active', 'deleted'] as const

export const messageExternalLinks = pgTable(
  'message_external_links',
  {
    id: typeIdWithDefault('message_external_link')('id').primaryKey(),
    messageId: typeIdColumn('conversation_msg')('message_id').notNull(),
    ticketExternalLinkId: typeIdColumn('ticket_external_link')('ticket_external_link_id').notNull(),
    integrationId: typeIdColumn('integration')('integration_id').notNull(),
    /** The linked issue's scope (`ticket_external_links.sync_scope`) when the comment was made. */
    syncScope: text('sync_scope').notNull(),
    /** The provider's comment id (GitHub's numeric issue-comment id). */
    externalId: text('external_id').notNull(),
    externalUrl: text('external_url'),
    /** `outbound`: posted from the reply, so ours to edit and delete. `inbound`: brought in from the issue. */
    direction: text('direction', { enum: MESSAGE_EXTERNAL_LINK_DIRECTIONS })
      .notNull()
      .default('outbound'),
    /** `deleted` once the comment was removed with its reply; the row stays as the record. */
    status: text('status', { enum: MESSAGE_EXTERNAL_LINK_STATUSES }).notNull().default('active'),
    /** The comment's version as last written or seen (GitHub: its `updated_at`). */
    remoteVersion: text('remote_version'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      name: 'message_external_links_message_id_fkey',
      columns: [table.messageId],
      foreignColumns: [conversationMessages.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'message_external_links_ticket_external_link_id_fkey',
      columns: [table.ticketExternalLinkId],
      foreignColumns: [ticketExternalLinks.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'message_external_links_integration_id_fkey',
      columns: [table.integrationId],
      foreignColumns: [integrations.id],
    }).onDelete('cascade'),
    // One comment per reply and linked issue.
    uniqueIndex('message_external_links_link_message_uq').on(
      table.ticketExternalLinkId,
      table.messageId
    ),
    // A comment stands for one message per linked issue (comment ids are
    // unique on the provider, so a posted comment stands for one reply).
    uniqueIndex('message_external_links_link_external_uq').on(
      table.ticketExternalLinkId,
      table.externalId
    ),
    index('message_external_links_message_idx').on(table.messageId),
  ]
)

export const messageExternalLinksRelations = relations(messageExternalLinks, ({ one }) => ({
  message: one(conversationMessages, {
    fields: [messageExternalLinks.messageId],
    references: [conversationMessages.id],
  }),
  ticketExternalLink: one(ticketExternalLinks, {
    fields: [messageExternalLinks.ticketExternalLinkId],
    references: [ticketExternalLinks.id],
  }),
  integration: one(integrations, {
    fields: [messageExternalLinks.integrationId],
    references: [integrations.id],
  }),
}))
