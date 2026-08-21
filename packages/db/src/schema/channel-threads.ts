/**
 * Inbound thread correlation: an external thread key on a channel account
 * maps to a conversation. Email keeps its Message-ID map as the authority;
 * other channels store their thread keys here.
 */
import { pgTable, text, timestamp, uniqueIndex, index, foreignKey } from 'drizzle-orm/pg-core'
import { typeIdWithDefault, typeIdColumn } from '@quackback/ids/drizzle'
import { channelAccounts } from './channel-accounts'
import { conversations } from './conversation'

export const channelThreads = pgTable(
  'channel_threads',
  {
    id: typeIdWithDefault('channel_thread')('id').primaryKey(),
    channelAccountId: typeIdColumn('channel_account')('channel_account_id').notNull(),
    externalThreadKey: text('external_thread_key').notNull(),
    conversationId: typeIdColumn('conversation')('conversation_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('channel_threads_account_key_uq').on(
      table.channelAccountId,
      table.externalThreadKey
    ),
    index('channel_threads_conversation_idx').on(table.conversationId),
    foreignKey({
      name: 'channel_threads_channel_account_id_fkey',
      columns: [table.channelAccountId],
      foreignColumns: [channelAccounts.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'channel_threads_conversation_id_fkey',
      columns: [table.conversationId],
      foreignColumns: [conversations.id],
    }).onDelete('cascade'),
  ]
)

export type ChannelThread = typeof channelThreads.$inferSelect
