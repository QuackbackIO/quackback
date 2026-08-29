/**
 * Email channel accounts (support platform §4.8 Layer 2). `channelAccounts` holds
 * two row roles for email — one `inbound` route per workspace (the front door,
 * config in JSONB) that a conversation's `channel_account_id` points at, and N
 * `sending` addresses (the verified From identities per module). `emailSendingDomains`
 * are the SPF/DKIM-verified domains a sending address belongs to. Per-workspace DB
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

/**
 * What a published record proves.
 *
 * `ownership` is ours and the other two are the mail provider's, which is the
 * whole reason the purposes are enumerated rather than left as prose. A provider
 * that can sign for a domain it does not host will report that domain verified
 * to anyone who asks, including a workspace that does not own it — so a record
 * only this workspace could have published is the one thing that ties the domain
 * to the workspace. See the sending-identity module for the split.
 */
export type SendingDomainRecordPurpose = 'ownership' | 'dkim' | 'mail-from'

/**
 * A DNS record the domain's owner must publish before we can send as it.
 *
 * A union rather than one shape with optional fields, because an MX record
 * carries a preference number and the other two carry nothing of the sort:
 * making `priority` optional everywhere would let a CNAME be written with one
 * and an MX be written without, and the renderer would have no way to know
 * which of those it was looking at. Discriminating on `type` means the compiler
 * answers that question instead.
 *
 * `host` is RELATIVE to the domain, with `@` meaning the apex — the form a DNS
 * provider's form field expects, and the form the record checker resolves
 * against.
 */
export type SendingDomainDnsRecord =
  | SendingDomainOwnershipRecord
  | {
      type: 'TXT' | 'CNAME'
      host: string
      value: string
      purpose: SendingDomainRecordPurpose
    }
  | {
      type: 'MX'
      host: string
      value: string
      /** RFC 5321 preference. Lower is preferred; a single MX is conventionally 10. */
      priority: number
      purpose: SendingDomainRecordPurpose
    }

/**
 * The one record in the set whose value is unique to a single row.
 *
 * Separated from the union so the checker that answers "does this workspace own
 * this zone" can demand it by type. Every other record in the set is a value we
 * publish in our instructions and therefore identical for every workspace that
 * follows them, so accepting one as proof would verify a domain for whoever
 * published our records rather than for whoever owns the domain.
 */
export interface SendingDomainOwnershipRecord {
  type: 'TXT'
  host: string
  value: string
  purpose: 'ownership'
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
  /** Which front door delivers this route's mail. `cloudflare` is the shared
   *  inbound domain a fleet answers behind one edge mail bridge; the other two
   *  are a per-workspace provider webhook and a polled mailbox. Free to grow: a
   *  jsonb column with no CHECK on it, so the union is the only thing enforcing
   *  the vocabulary and widening it is a type change, not a migration. */
  provider?: 'imap' | 'resend' | 'cloudflare'
  imap?: { host: string; port: number; secure: boolean; user: string }
  cursor?: { uidValidity: number; lastUid: number }
  // sending role
  smtp?: { host: string; port: number; secure: boolean; user: string }
  // connection role: reference to an integration-framework credential.
  // Secrets stay on the integration row, never in this JSONB.
  integrationId?: string
}

export const channelAccounts = pgTable(
  'channel_accounts',
  {
    id: typeIdWithDefault('channel_account')('id').primaryKey(),
    owningTeamId: typeIdColumn('team')('owning_team_id').notNull(),
    channel: text('channel').notNull().default('email'),
    role: text('role', { enum: ['inbound', 'sending', 'connection'] }).notNull(),
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
    check('channel_accounts_role_check', sql`${table.role} IN ('inbound','sending','connection')`),
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
    // One live GitHub inbox connection per workspace (v1, one repo).
    uniqueIndex('channel_accounts_one_github_connection_uq')
      .on(table.owningTeamId)
      .where(sql`role = 'connection' AND channel = 'github' AND deleted_at IS NULL`),
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
