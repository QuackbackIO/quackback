/**
 * Status page product (Status Product Spec §5): components + groups, incidents
 * and scheduled maintenance (one discriminated table), the public update
 * timeline, an append-only component status-event log that uptime bars are
 * derived from, principal-based subscriptions, and incident templates.
 *
 * Audience model: the page-level gate lives in StatusSettings (settings
 * metadata bag); per-component narrowing uses `segmentIds` — [] = everyone
 * who can see the page (the changelog-category gate pattern).
 */
import {
  pgTable,
  text,
  boolean,
  timestamp,
  integer,
  index,
  uniqueIndex,
  jsonb,
  primaryKey,
} from 'drizzle-orm/pg-core'
import { relations } from 'drizzle-orm'
import { typeIdWithDefault, typeIdColumn, typeIdColumnNullable } from '@quackback/ids/drizzle'
import { principal } from './auth'

/** Component status values (industry-standard 5-state model). */
export type StatusComponentStatus =
  | 'operational'
  | 'degraded_performance'
  | 'partial_outage'
  | 'major_outage'
  | 'under_maintenance'

/** Incident lifecycle. Maintenance rows use the maintenance lifecycle instead. */
export type StatusIncidentStatus = 'investigating' | 'identified' | 'monitoring' | 'resolved'
export type StatusMaintenanceStatus = 'scheduled' | 'in_progress' | 'verifying' | 'completed'

export type StatusIncidentKind = 'incident' | 'maintenance'
export type StatusIncidentImpact = 'none' | 'minor' | 'major' | 'critical' | 'maintenance'

/** How a component status event was produced. */
export type StatusComponentEventSource = 'incident' | 'maintenance' | 'manual' | 'api'

export type StatusSubscriptionScope = 'page' | 'components'
export type StatusSubscriptionSource = 'self_serve' | 'auto' | 'admin' | 'csv_import'

export const statusComponentGroups = pgTable('status_component_groups', {
  id: typeIdWithDefault('status_group')('id').primaryKey(),
  name: text('name').notNull(),
  position: integer('position').default(0).notNull(),
  // Render the group collapsed by default on the public page.
  collapsed: boolean('collapsed').default(false).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
})

export const statusComponents = pgTable(
  'status_components',
  {
    id: typeIdWithDefault('status_component')('id').primaryKey(),
    groupId: typeIdColumnNullable('status_group')('group_id').references(
      () => statusComponentGroups.id,
      { onDelete: 'set null' }
    ),
    name: text('name').notNull(),
    description: text('description'),
    status: text('status').$type<StatusComponentStatus>().default('operational').notNull(),
    position: integer('position').default(0).notNull(),
    showUptime: boolean('show_uptime').default(true).notNull(),
    // Segments this component is visible to; [] = everyone who can see the page.
    segmentIds: jsonb('segment_ids').$type<string[]>().notNull().default([]),
    // Soft delete keeps incident history readable.
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('status_components_group_idx').on(table.groupId),
    index('status_components_deleted_at_idx').on(table.deletedAt),
  ]
)

/** Append-only status history; uptime bars are a step function over this log. */
export const statusComponentEvents = pgTable(
  'status_component_events',
  {
    id: typeIdWithDefault('status_update')('id').primaryKey(),
    componentId: typeIdColumn('status_component')('component_id')
      .notNull()
      .references(() => statusComponents.id, { onDelete: 'cascade' }),
    status: text('status').$type<StatusComponentStatus>().notNull(),
    source: text('source').$type<StatusComponentEventSource>().notNull(),
    incidentId: typeIdColumnNullable('status_incident')('incident_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('status_component_events_component_idx').on(table.componentId, table.createdAt)]
)

export const statusIncidents = pgTable(
  'status_incidents',
  {
    id: typeIdWithDefault('status_incident')('id').primaryKey(),
    kind: text('kind').$type<StatusIncidentKind>().notNull(),
    title: text('title').notNull(),
    // Incident lifecycle or maintenance lifecycle depending on `kind`.
    status: text('status').$type<StatusIncidentStatus | StatusMaintenanceStatus>().notNull(),
    impact: text('impact').$type<StatusIncidentImpact>().default('none').notNull(),
    // True when an admin pinned impact manually (stops auto-derivation).
    impactOverride: boolean('impact_override').default(false).notNull(),
    // Maintenance window bounds + automation switches.
    scheduledStartAt: timestamp('scheduled_start_at', { withTimezone: true }),
    scheduledEndAt: timestamp('scheduled_end_at', { withTimezone: true }),
    autoStart: boolean('auto_start').default(true).notNull(),
    autoComplete: boolean('auto_complete').default(true).notNull(),
    // Backfilled incidents set this in the past and never notify.
    startedAt: timestamp('started_at', { withTimezone: true }).defaultNow().notNull(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    backfilled: boolean('backfilled').default(false).notNull(),
    // Publish-email claim column (changelog notify pattern); null until sent.
    notifiedAt: timestamp('notified_at', { withTimezone: true }),
    createdBy: typeIdColumnNullable('principal')('created_by').references(() => principal.id, {
      onDelete: 'set null',
    }),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('status_incidents_kind_status_idx').on(table.kind, table.status),
    index('status_incidents_started_at_idx').on(table.startedAt),
    index('status_incidents_deleted_at_idx').on(table.deletedAt),
  ]
)

/** The public timeline: one row per posted update (the first is the publish body). */
export const statusIncidentUpdates = pgTable(
  'status_incident_updates',
  {
    id: typeIdWithDefault('status_update')('id').primaryKey(),
    incidentId: typeIdColumn('status_incident')('incident_id')
      .notNull()
      .references(() => statusIncidents.id, { onDelete: 'cascade' }),
    // Lifecycle status at the time of this update.
    status: text('status').$type<StatusIncidentStatus | StatusMaintenanceStatus>().notNull(),
    body: text('body').notNull(),
    createdBy: typeIdColumnNullable('principal')('created_by').references(() => principal.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('status_incident_updates_incident_idx').on(table.incidentId, table.createdAt)]
)

/** M:N incident <-> component, plus the status applied to each while open. */
export const statusIncidentComponents = pgTable(
  'status_incident_components',
  {
    incidentId: typeIdColumn('status_incident')('incident_id')
      .notNull()
      .references(() => statusIncidents.id, { onDelete: 'cascade' }),
    componentId: typeIdColumn('status_component')('component_id')
      .notNull()
      .references(() => statusComponents.id, { onDelete: 'cascade' }),
    componentStatus: text('component_status').$type<StatusComponentStatus>().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.incidentId, table.componentId] }),
    index('status_incident_components_component_idx').on(table.componentId),
  ]
)

export const statusSubscriptions = pgTable(
  'status_subscriptions',
  {
    id: typeIdWithDefault('status_sub')('id').primaryKey(),
    principalId: typeIdColumn('principal')('principal_id')
      .notNull()
      .references(() => principal.id, { onDelete: 'cascade' }),
    scope: text('scope').$type<StatusSubscriptionScope>().default('page').notNull(),
    // Component IDs when scope = 'components'; [] with scope 'page' = whole page.
    componentIds: jsonb('component_ids').$type<string[]>().notNull().default([]),
    source: text('source').$type<StatusSubscriptionSource>().notNull(),
    // Soft opt-out so the audit trail survives an unsubscribe.
    unsubscribedAt: timestamp('unsubscribed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex('status_subscriptions_principal_idx').on(table.principalId)]
)

export const statusIncidentTemplates = pgTable('status_incident_templates', {
  id: typeIdWithDefault('status_tmpl')('id').primaryKey(),
  name: text('name').notNull(),
  title: text('title').notNull(),
  body: text('body').notNull(),
  impact: text('impact').$type<StatusIncidentImpact>().default('minor').notNull(),
  componentIds: jsonb('component_ids').$type<string[]>().notNull().default([]),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
})

export const statusComponentGroupsRelations = relations(statusComponentGroups, ({ many }) => ({
  components: many(statusComponents),
}))

export const statusComponentsRelations = relations(statusComponents, ({ one, many }) => ({
  group: one(statusComponentGroups, {
    fields: [statusComponents.groupId],
    references: [statusComponentGroups.id],
  }),
  incidentLinks: many(statusIncidentComponents),
  events: many(statusComponentEvents),
}))

export const statusComponentEventsRelations = relations(statusComponentEvents, ({ one }) => ({
  component: one(statusComponents, {
    fields: [statusComponentEvents.componentId],
    references: [statusComponents.id],
  }),
}))

export const statusIncidentsRelations = relations(statusIncidents, ({ one, many }) => ({
  author: one(principal, {
    fields: [statusIncidents.createdBy],
    references: [principal.id],
  }),
  updates: many(statusIncidentUpdates),
  componentLinks: many(statusIncidentComponents),
}))

export const statusIncidentUpdatesRelations = relations(statusIncidentUpdates, ({ one }) => ({
  incident: one(statusIncidents, {
    fields: [statusIncidentUpdates.incidentId],
    references: [statusIncidents.id],
  }),
  author: one(principal, {
    fields: [statusIncidentUpdates.createdBy],
    references: [principal.id],
  }),
}))

export const statusIncidentComponentsRelations = relations(statusIncidentComponents, ({ one }) => ({
  incident: one(statusIncidents, {
    fields: [statusIncidentComponents.incidentId],
    references: [statusIncidents.id],
  }),
  component: one(statusComponents, {
    fields: [statusIncidentComponents.componentId],
    references: [statusComponents.id],
  }),
}))

export const statusSubscriptionsRelations = relations(statusSubscriptions, ({ one }) => ({
  principal: one(principal, {
    fields: [statusSubscriptions.principalId],
    references: [principal.id],
  }),
}))
