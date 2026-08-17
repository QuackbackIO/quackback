/**
 * Inbound thread correlation: an external thread key on a channel account
 * maps to a conversation. Email keeps its Message-ID map as the authority;
 * other channels store their thread keys here.
 */
import { pgTable, text, timestamp, uniqueIndex, index } from 'drizzle-orm/pg-core'
import { typeIdWithDefault, typeIdColumn } from '@quackback/ids/drizzle'

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
  ]
)

export type ChannelThread = typeof channelThreads.$inferSelect
