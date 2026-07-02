/**
 * Inboxes, channels, and memberships — Phase 4 of the ticketing rollout.
 *
 *   - `inboxes`             named queue owned by a team; defines defaults
 *                           applied to incoming tickets.
 *   - `inbox_channels`      per-inbox channel records (portal/email/api/widget/
 *                           webhook) — config blob is opaque per kind.
 *   - `inbox_memberships`   N:M between principals and inboxes (cross-team
 *                           staffing); distinct from team_memberships.
 */
import { pgTable, text, timestamp, jsonb, boolean, index, uniqueIndex } from 'drizzle-orm/pg-core'
import { relations, sql } from 'drizzle-orm'
import { typeIdWithDefault, typeIdColumn, typeIdColumnNullable } from '@quackback/ids/drizzle'
import { principal } from './auth'
import { teams } from './teams'
import { ticketStatuses } from './ticket-statuses'
import { TICKET_PRIORITIES, TICKET_VISIBILITY_SCOPES } from './tickets'
import type { AuditJsonValue } from './audit-events'

export const INBOX_CHANNEL_KINDS = ['portal', 'email', 'api', 'widget', 'webhook'] as const
export type InboxChannelKind = (typeof INBOX_CHANNEL_KINDS)[number]

export const INBOX_MEMBERSHIP_ROLES = ['owner', 'agent', 'viewer'] as const
export type InboxMembershipRole = (typeof INBOX_MEMBERSHIP_ROLES)[number]

// ---------------------------------------------------------------------------
// inboxes
// ---------------------------------------------------------------------------

export const inboxes = pgTable(
  'inboxes',
  {
    id: typeIdWithDefault('inbox')('id').primaryKey(),
    name: text('name').notNull(),
    /** Stable URL/lookup identifier (lowercase, kebab). */
    slug: text('slug').notNull(),
    description: text('description'),
    /** Team that owns this inbox. NULL = workspace-wide. */
    primaryTeamId: typeIdColumnNullable('team')('primary_team_id').references(() => teams.id, {
      onDelete: 'set null',
    }),
    /** Default visibility scope applied to incoming tickets. */
    defaultVisibilityScope: text('default_visibility_scope', { enum: TICKET_VISIBILITY_SCOPES })
      .notNull()
      .default('team'),
    /** Default priority applied to incoming tickets. */
    defaultPriority: text('default_priority', { enum: TICKET_PRIORITIES })
      .notNull()
      .default('normal'),
    /** Default status assigned to a fresh ticket; NULL = use the global default status. */
    defaultStatusId: typeIdColumnNullable('ticket_status')('default_status_id').references(
      () => ticketStatuses.id,
      { onDelete: 'set null' }
    ),
    color: text('color'),
    icon: text('icon'),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (t) => [
    uniqueIndex('inboxes_slug_idx').on(t.slug),
    index('inboxes_primary_team_idx').on(t.primaryTeamId),
    index('inboxes_archived_at_idx').on(t.archivedAt),
    uniqueIndex('inboxes_active_name_idx')
      .on(sql`lower(${t.name})`)
      .where(sql`archived_at IS NULL`),
  ]
)

// ---------------------------------------------------------------------------
// inbox_channels
// ---------------------------------------------------------------------------

export const inboxChannels = pgTable(
  'inbox_channels',
  {
    id: typeIdWithDefault('inbox_ch')('id').primaryKey(),
    inboxId: typeIdColumn('inbox')('inbox_id')
      .notNull()
      .references(() => inboxes.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: INBOX_CHANNEL_KINDS }).notNull(),
    label: text('label').notNull(),
    /** Per-kind opaque configuration (e.g. mailbox address, webhook secret). */
    config: jsonb('config').$type<{ [k: string]: AuditJsonValue }>().notNull().default({}),
    /** External provider identifier (mailbox address, webhook id, etc.). */
    externalId: text('external_id'),
    enabled: boolean('enabled').notNull().default(true),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (t) => [
    index('inbox_channels_inbox_idx').on(t.inboxId),
    uniqueIndex('inbox_channels_kind_external_id_idx')
      .on(t.kind, t.externalId)
      .where(sql`external_id IS NOT NULL AND archived_at IS NULL`),
  ]
)

// ---------------------------------------------------------------------------
// inbox_memberships
// ---------------------------------------------------------------------------

export const inboxMemberships = pgTable(
  'inbox_memberships',
  {
    id: typeIdWithDefault('inbox_mem')('id').primaryKey(),
    inboxId: typeIdColumn('inbox')('inbox_id')
      .notNull()
      .references(() => inboxes.id, { onDelete: 'cascade' }),
    principalId: typeIdColumn('principal')('principal_id')
      .notNull()
      .references(() => principal.id, { onDelete: 'cascade' }),
    role: text('role', { enum: INBOX_MEMBERSHIP_ROLES }).notNull().default('agent'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex('inbox_memberships_inbox_principal_idx').on(t.inboxId, t.principalId),
    index('inbox_memberships_principal_idx').on(t.principalId),
  ]
)

// ---------------------------------------------------------------------------
// Relations
// ---------------------------------------------------------------------------

export const inboxesRelations = relations(inboxes, ({ one, many }) => ({
  primaryTeam: one(teams, {
    fields: [inboxes.primaryTeamId],
    references: [teams.id],
  }),
  defaultStatus: one(ticketStatuses, {
    fields: [inboxes.defaultStatusId],
    references: [ticketStatuses.id],
  }),
  channels: many(inboxChannels),
  memberships: many(inboxMemberships),
}))

export const inboxChannelsRelations = relations(inboxChannels, ({ one }) => ({
  inbox: one(inboxes, {
    fields: [inboxChannels.inboxId],
    references: [inboxes.id],
  }),
}))

export const inboxMembershipsRelations = relations(inboxMemberships, ({ one }) => ({
  inbox: one(inboxes, {
    fields: [inboxMemberships.inboxId],
    references: [inboxes.id],
  }),
  principal: one(principal, {
    fields: [inboxMemberships.principalId],
    references: [principal.id],
  }),
}))
