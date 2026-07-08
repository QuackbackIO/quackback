/**
 * Ticket core schema — Phase 3 of the ticketing rollout.
 *
 * Six tables in one module to keep the relations import graph tight:
 *   - `tickets`              header / state / assignment / visibility
 *   - `ticket_threads`       messages on a ticket (public/internal/shared)
 *   - `ticket_attachments`   metadata for files attached to a thread
 *   - `ticket_participants`  watchers / collaborators / cc'd contacts
 *   - `ticket_shares`        cross-team share grants with access level
 *   - `ticket_activity`      per-ticket timeline (mirror of post_activity)
 *
 * `inboxId` and `slaPolicyId` are reserved as nullable text columns now to
 * avoid a destructive ALTER later when Phases 4 (inboxes) and 5 (SLA) add
 * the foreign keys.
 *
 * Search vector + embedding columns are intentionally deferred to Phase 7
 * to avoid having to backfill them twice.
 */
import {
  pgTable,
  text,
  timestamp,
  integer,
  jsonb,
  index,
  uniqueIndex,
  check,
} from 'drizzle-orm/pg-core'
import { relations, sql } from 'drizzle-orm'
import { typeIdWithDefault, typeIdColumn, typeIdColumnNullable } from '@quackback/ids/drizzle'
import { principal } from './auth'
import { teams } from './teams'
import { contacts, organizations } from './organizations'
import { ticketStatuses } from './ticket-statuses'
import { widgetEnvironmentProfiles } from './widget-profiles'
import type { TiptapContent } from '../types'

export const TICKET_PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const
export type TicketPriority = (typeof TICKET_PRIORITIES)[number]

export const TICKET_CHANNELS = ['portal', 'email', 'api', 'widget'] as const
export type TicketChannel = (typeof TICKET_CHANNELS)[number]

export const TICKET_VISIBILITY_SCOPES = ['team', 'org', 'shared', 'private'] as const
export type TicketVisibilityScope = (typeof TICKET_VISIBILITY_SCOPES)[number]

export const TICKET_THREAD_AUDIENCES = ['public', 'internal', 'shared_team'] as const
export type TicketThreadAudience = (typeof TICKET_THREAD_AUDIENCES)[number]

export const TICKET_PARTICIPANT_ROLES = ['watcher', 'collaborator', 'cc'] as const
export type TicketParticipantRole = (typeof TICKET_PARTICIPANT_ROLES)[number]

export const TICKET_SHARE_LEVELS = ['read', 'comment', 'full'] as const
export type TicketShareLevel = (typeof TICKET_SHARE_LEVELS)[number]

// ---------------------------------------------------------------------------
// tickets
// ---------------------------------------------------------------------------

export const tickets = pgTable(
  'tickets',
  {
    id: typeIdWithDefault('ticket')('id').primaryKey(),
    subject: text('subject').notNull(),
    /** Rich-text body of the original request (TipTap JSON). */
    descriptionJson: jsonb('description_json').$type<TiptapContent>(),
    /** Plain-text mirror of the rich body for search and previews. */
    descriptionText: text('description_text'),
    priority: text('priority', { enum: TICKET_PRIORITIES }).notNull().default('normal'),
    channel: text('channel', { enum: TICKET_CHANNELS }).notNull().default('api'),
    sourceWidgetProfileId: typeIdColumnNullable('widget_profile')(
      'source_widget_profile_id'
    ).references(() => widgetEnvironmentProfiles.id, { onDelete: 'set null' }),
    visibilityScope: text('visibility_scope', { enum: TICKET_VISIBILITY_SCOPES })
      .notNull()
      .default('team'),
    statusId: typeIdColumnNullable('ticket_status')('status_id').references(
      () => ticketStatuses.id,
      { onDelete: 'set null' }
    ),
    /** Authenticated portal user who filed the ticket (null for unauthenticated/api intake). */
    requesterPrincipalId: typeIdColumnNullable('principal')('requester_principal_id').references(
      () => principal.id,
      { onDelete: 'set null' }
    ),
    /** CRM contact representing the customer (preferred identifier for B2B context). */
    requesterContactId: typeIdColumnNullable('contact')('requester_contact_id').references(
      () => contacts.id,
      { onDelete: 'set null' }
    ),
    organizationId: typeIdColumnNullable('org')('organization_id').references(
      () => organizations.id,
      { onDelete: 'set null' }
    ),
    /** Currently-assigned individual agent (nullable when only a team owns it). */
    assigneePrincipalId: typeIdColumnNullable('principal')('assignee_principal_id').references(
      () => principal.id,
      { onDelete: 'set null' }
    ),
    assigneeTeamId: typeIdColumnNullable('team')('assignee_team_id').references(() => teams.id, {
      onDelete: 'set null',
    }),
    /** Team that owns this ticket's queue (used for `view_team` scope). */
    primaryTeamId: typeIdColumnNullable('team')('primary_team_id').references(() => teams.id, {
      onDelete: 'set null',
    }),
    /** Inbox the ticket belongs to (Phase 4). FK is added by migration 0051. */
    inboxId: typeIdColumnNullable('inbox')('inbox_id'),
    /** SLA policy bound at creation time (Phase 5). FK added by migration 0052. */
    slaPolicyId: typeIdColumnNullable('sla_pol')('sla_policy_id'),
    /** Lifecycle timestamps. */
    firstResponseAt: timestamp('first_response_at', { withTimezone: true }),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    reopenedAt: timestamp('reopened_at', { withTimezone: true }),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    createdByPrincipalId: typeIdColumnNullable('principal')('created_by_principal_id').references(
      () => principal.id,
      { onDelete: 'set null' }
    ),
    /** Bumped on every meaningful change; powers queue ordering. */
    lastActivityAt: timestamp('last_activity_at', { withTimezone: true }).defaultNow().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    deletedByPrincipalId: typeIdColumnNullable('principal')('deleted_by_principal_id').references(
      () => principal.id,
      { onDelete: 'set null' }
    ),
  },
  (t) => [
    index('tickets_status_id_idx').on(t.statusId),
    index('tickets_assignee_principal_idx').on(t.assigneePrincipalId),
    index('tickets_primary_team_idx').on(t.primaryTeamId),
    index('tickets_organization_idx').on(t.organizationId),
    index('tickets_requester_contact_idx').on(t.requesterContactId),
    index('tickets_source_widget_profile_idx').on(t.sourceWidgetProfileId),
    index('tickets_created_at_idx').on(t.createdAt),
    index('tickets_last_activity_at_idx').on(t.lastActivityAt),
    index('tickets_deleted_at_idx').on(t.deletedAt),
    // Composite for queue queries ("my team's open tickets, newest first")
    index('tickets_team_status_idx').on(t.primaryTeamId, t.statusId),
    // Active-only partial index — most queue queries exclude soft-deleted rows
    index('tickets_active_last_activity_idx')
      .on(t.lastActivityAt)
      .where(sql`deleted_at IS NULL`),
    // SLA policy lookup (Phase 5)
    index('tickets_sla_policy_idx').on(t.slaPolicyId),
  ]
)

// ---------------------------------------------------------------------------
// ticket_threads
// ---------------------------------------------------------------------------

export const ticketThreads = pgTable(
  'ticket_threads',
  {
    id: typeIdWithDefault('ticket_thread')('id').primaryKey(),
    ticketId: typeIdColumn('ticket')('ticket_id')
      .notNull()
      .references(() => tickets.id, { onDelete: 'cascade' }),
    /** Author principal; NULL = system-generated (e.g. status change message). */
    principalId: typeIdColumnNullable('principal')('principal_id').references(() => principal.id, {
      onDelete: 'set null',
    }),
    audience: text('audience', { enum: TICKET_THREAD_AUDIENCES }).notNull(),
    bodyJson: jsonb('body_json').$type<TiptapContent>(),
    bodyText: text('body_text').notNull(),
    /** Required when audience='shared_team', null otherwise. */
    sharedWithTeamId: typeIdColumnNullable('team')('shared_with_team_id').references(
      () => teams.id,
      { onDelete: 'set null' }
    ),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    editedAt: timestamp('edited_at', { withTimezone: true }),
    editedByPrincipalId: typeIdColumnNullable('principal')('edited_by_principal_id').references(
      () => principal.id,
      { onDelete: 'set null' }
    ),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    index('ticket_threads_ticket_id_created_at_idx').on(t.ticketId, t.createdAt),
    index('ticket_threads_audience_idx').on(t.audience),
    check(
      'ticket_threads_shared_team_required',
      sql`(audience <> 'shared_team') OR (shared_with_team_id IS NOT NULL)`
    ),
  ]
)

// ---------------------------------------------------------------------------
// ticket_attachments
// ---------------------------------------------------------------------------

export const ticketAttachments = pgTable(
  'ticket_attachments',
  {
    id: typeIdWithDefault('ticket_att')('id').primaryKey(),
    threadId: typeIdColumn('ticket_thread')('thread_id')
      .notNull()
      .references(() => ticketThreads.id, { onDelete: 'cascade' }),
    uploadedByPrincipalId: typeIdColumnNullable('principal')('uploaded_by_principal_id').references(
      () => principal.id,
      { onDelete: 'set null' }
    ),
    filename: text('filename').notNull(),
    mimeType: text('mime_type').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    /** S3-style storage key (set by the existing upload pipeline). */
    storageKey: text('storage_key').notNull(),
    publicUrl: text('public_url'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index('ticket_attachments_thread_idx').on(t.threadId)]
)

// ---------------------------------------------------------------------------
// ticket_participants  (watcher / collaborator / cc — principal OR contact)
// ---------------------------------------------------------------------------

export const ticketParticipants = pgTable(
  'ticket_participants',
  {
    id: typeIdWithDefault('ticket_part')('id').primaryKey(),
    ticketId: typeIdColumn('ticket')('ticket_id')
      .notNull()
      .references(() => tickets.id, { onDelete: 'cascade' }),
    principalId: typeIdColumnNullable('principal')('principal_id').references(() => principal.id, {
      onDelete: 'cascade',
    }),
    contactId: typeIdColumnNullable('contact')('contact_id').references(() => contacts.id, {
      onDelete: 'cascade',
    }),
    role: text('role', { enum: TICKET_PARTICIPANT_ROLES }).notNull(),
    addedByPrincipalId: typeIdColumnNullable('principal')('added_by_principal_id').references(
      () => principal.id,
      { onDelete: 'set null' }
    ),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex('ticket_participants_ticket_principal_idx')
      .on(t.ticketId, t.principalId)
      .where(sql`principal_id IS NOT NULL`),
    uniqueIndex('ticket_participants_ticket_contact_idx')
      .on(t.ticketId, t.contactId)
      .where(sql`contact_id IS NOT NULL`),
    check(
      'ticket_participants_one_subject',
      sql`(principal_id IS NOT NULL)::int + (contact_id IS NOT NULL)::int = 1`
    ),
  ]
)

// ---------------------------------------------------------------------------
// ticket_shares  (cross-team grants)
// ---------------------------------------------------------------------------

export const ticketShares = pgTable(
  'ticket_shares',
  {
    id: typeIdWithDefault('ticket_share')('id').primaryKey(),
    ticketId: typeIdColumn('ticket')('ticket_id')
      .notNull()
      .references(() => tickets.id, { onDelete: 'cascade' }),
    teamId: typeIdColumn('team')('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    accessLevel: text('access_level', { enum: TICKET_SHARE_LEVELS }).notNull().default('read'),
    grantedByPrincipalId: typeIdColumnNullable('principal')('granted_by_principal_id').references(
      () => principal.id,
      { onDelete: 'set null' }
    ),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    revokedByPrincipalId: typeIdColumnNullable('principal')('revoked_by_principal_id').references(
      () => principal.id,
      { onDelete: 'set null' }
    ),
  },
  (t) => [
    uniqueIndex('ticket_shares_ticket_team_active_idx')
      .on(t.ticketId, t.teamId)
      .where(sql`revoked_at IS NULL`),
    index('ticket_shares_team_idx').on(t.teamId),
  ]
)

// ---------------------------------------------------------------------------
// ticket_activity (per-ticket timeline mirror of post_activity)
// ---------------------------------------------------------------------------

export const ticketActivity = pgTable(
  'ticket_activity',
  {
    id: typeIdWithDefault('ticket_act')('id').primaryKey(),
    ticketId: typeIdColumn('ticket')('ticket_id')
      .notNull()
      .references(() => tickets.id, { onDelete: 'cascade' }),
    principalId: typeIdColumnNullable('principal')('principal_id').references(() => principal.id, {
      onDelete: 'set null',
    }),
    type: text('type').notNull(),
    metadata: jsonb('metadata').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index('ticket_activity_ticket_id_created_idx').on(t.ticketId, t.createdAt),
    index('ticket_activity_type_idx').on(t.type),
  ]
)

// ---------------------------------------------------------------------------
// Relations
// ---------------------------------------------------------------------------

export const ticketsRelations = relations(tickets, ({ one, many }) => ({
  status: one(ticketStatuses, {
    fields: [tickets.statusId],
    references: [ticketStatuses.id],
  }),
  requesterContact: one(contacts, {
    fields: [tickets.requesterContactId],
    references: [contacts.id],
  }),
  organization: one(organizations, {
    fields: [tickets.organizationId],
    references: [organizations.id],
  }),
  assigneePrincipal: one(principal, {
    fields: [tickets.assigneePrincipalId],
    references: [principal.id],
    relationName: 'ticketAssignee',
  }),
  assigneeTeam: one(teams, {
    fields: [tickets.assigneeTeamId],
    references: [teams.id],
    relationName: 'ticketAssigneeTeam',
  }),
  primaryTeam: one(teams, {
    fields: [tickets.primaryTeamId],
    references: [teams.id],
    relationName: 'ticketPrimaryTeam',
  }),
  sourceWidgetProfile: one(widgetEnvironmentProfiles, {
    fields: [tickets.sourceWidgetProfileId],
    references: [widgetEnvironmentProfiles.id],
  }),
  threads: many(ticketThreads),
  participants: many(ticketParticipants),
  shares: many(ticketShares),
  activity: many(ticketActivity),
}))

export const ticketThreadsRelations = relations(ticketThreads, ({ one, many }) => ({
  ticket: one(tickets, {
    fields: [ticketThreads.ticketId],
    references: [tickets.id],
  }),
  author: one(principal, {
    fields: [ticketThreads.principalId],
    references: [principal.id],
  }),
  sharedWithTeam: one(teams, {
    fields: [ticketThreads.sharedWithTeamId],
    references: [teams.id],
  }),
  attachments: many(ticketAttachments),
}))

export const ticketAttachmentsRelations = relations(ticketAttachments, ({ one }) => ({
  thread: one(ticketThreads, {
    fields: [ticketAttachments.threadId],
    references: [ticketThreads.id],
  }),
}))

export const ticketParticipantsRelations = relations(ticketParticipants, ({ one }) => ({
  ticket: one(tickets, {
    fields: [ticketParticipants.ticketId],
    references: [tickets.id],
  }),
  principal: one(principal, {
    fields: [ticketParticipants.principalId],
    references: [principal.id],
  }),
  contact: one(contacts, {
    fields: [ticketParticipants.contactId],
    references: [contacts.id],
  }),
}))

export const ticketSharesRelations = relations(ticketShares, ({ one }) => ({
  ticket: one(tickets, {
    fields: [ticketShares.ticketId],
    references: [tickets.id],
  }),
  team: one(teams, {
    fields: [ticketShares.teamId],
    references: [teams.id],
  }),
}))

export const ticketActivityRelations = relations(ticketActivity, ({ one }) => ({
  ticket: one(tickets, {
    fields: [ticketActivity.ticketId],
    references: [tickets.id],
  }),
  actor: one(principal, {
    fields: [ticketActivity.principalId],
    references: [principal.id],
  }),
}))
