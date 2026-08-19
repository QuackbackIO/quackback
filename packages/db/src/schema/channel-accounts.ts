/**
 * Email channel accounts (support platform §4.8 Layer 2). `channelAccounts` holds
 * two row roles for email — one `inbound` route per workspace (the front door,
 * config in JSONB) that a conversation's `channel_account_id` points at, and N
 * `sending` addresses (the verified From identities per module). `emailSendingDomains`
 * are the SPF/DKIM-verified domains a sending address belongs to. Per-tenant DB
 * connection, so no workspace column. Inert until the cold-inbound/outbound slices.
 */
import {
  pgTable,
  text,
  jsonb,
  timestamp,
  index,
  uniqueIndex,
  foreignKey,
  check,
} from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { typeIdWithDefault, typeIdColumn, typeIdColumnNullable } from '@quackback/ids/drizzle'
import { teams } from './teams'

/** A DNS record the operator must publish to verify a sending domain. */
export interface SendingDomainDnsRecord {
  type: 'TXT' | 'CNAME'
  host: string
  value: string
  purpose: 'spf' | 'dkim' | 'return-path'
}

export const emailSendingDomains = pgTable(
  'email_sending_domains',
  {
    id: typeIdWithDefault('sending_domain')('id').primaryKey(),
    owningTeamId: typeIdColumn('team')('owning_team_id').notNull(),
    domain: text('domain').notNull(),
    status: text('status', { enum: ['pending', 'verified', 'failed'] })
      .notNull()
      .default('pending'),
    dnsRecords: jsonb('dns_records')
      .$type<SendingDomainDnsRecord[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    lastCheckedAt: timestamp('last_checked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('email_sending_domains_team_domain_unique').on(table.owningTeamId, table.domain),
    foreignKey({
      name: 'email_sending_domains_owning_team_id_fkey',
      columns: [table.owningTeamId],
      foreignColumns: [teams.id],
    }).onDelete('cascade'),
  ]
)

/** JSONB config, role-shaped: inbound routes carry the transport + poll cursor;
 *  sending addresses carry their optional per-address SMTP override. */
export interface ChannelAccountConfig {
  // inbound role
  forwardingTarget?: string
  provider?: 'imap' | 'resend'
  imap?: { host: string; port: number; secure: boolean; user: string }
  cursor?: { uidValidity: number; lastUid: number }
  // sending role
  smtp?: { host: string; port: number; secure: boolean; user: string }
}

export const channelAccounts = pgTable(
  'channel_accounts',
  {
    id: typeIdWithDefault('channel_account')('id').primaryKey(),
    owningTeamId: typeIdColumn('team')('owning_team_id').notNull(),
    channel: text('channel').notNull().default('email'),
    role: text('role', { enum: ['inbound', 'sending'] }).notNull(),
    address: text('address'),
    module: text('module', { enum: ['support', 'feedback', 'changelog'] }),
    sendingDomainId: typeIdColumnNullable('sending_domain')('sending_domain_id'),
    config: jsonb('config')
      .$type<ChannelAccountConfig>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    inboundTrust: text('inbound_trust', { enum: ['strict', 'lenient'] })
      .notNull()
      .default('strict'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [
    check('channel_accounts_role_check', sql`${table.role} IN ('inbound','sending')`),
    check('channel_accounts_channel_check', sql`${table.channel} = 'email'`),
    foreignKey({
      name: 'channel_accounts_owning_team_id_fkey',
      columns: [table.owningTeamId],
      foreignColumns: [teams.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'channel_accounts_sending_domain_id_fkey',
      columns: [table.sendingDomainId],
      foreignColumns: [emailSendingDomains.id],
    }).onDelete('restrict'),
    // One inbound route per workspace (v1); relax when multi-inbox lands.
    uniqueIndex('channel_accounts_one_inbound_uq')
      .on(table.owningTeamId)
      .where(sql`role = 'inbound' AND channel = 'email' AND deleted_at IS NULL`),
    // A sending address is unique per team + channel.
    uniqueIndex('channel_accounts_sending_address_uq')
      .on(table.owningTeamId, table.channel, table.address)
      .where(sql`address IS NOT NULL AND deleted_at IS NULL`),
    index('channel_accounts_team_role_idx')
      .on(table.owningTeamId, table.role)
      .where(sql`deleted_at IS NULL`),
  ]
)

export type ChannelAccount = typeof channelAccounts.$inferSelect
export type EmailSendingDomain = typeof emailSendingDomains.$inferSelect
