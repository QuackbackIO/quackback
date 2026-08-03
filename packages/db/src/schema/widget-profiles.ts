/**
 * Environment-specific widget profiles.
 *
 * A widget application is a stable public integration key for an external app.
 * Each application can have one profile per environment (local, development,
 * staging, production, or a tenant-defined value). Profiles scope embedded
 * widget configuration, content filters, and inbox-backed support categories.
 */
import { pgTable, text, timestamp, boolean, jsonb, index, uniqueIndex } from 'drizzle-orm/pg-core'
import { relations, sql } from 'drizzle-orm'
import { typeIdWithDefault, typeIdColumn } from '@quackback/ids/drizzle'
import type {
  BoardId,
  ChangelogCategoryId,
  ChangelogId,
  ChangelogProductId,
  HelpCenterArticleId,
  HelpCenterCategoryId,
  InboxId,
  StatusId,
  TagId,
} from '@quackback/ids'

export const WIDGET_PROFILE_ENVIRONMENTS = [
  'default',
  'local',
  'development',
  'staging',
  'production',
] as const
export type WidgetProfileKnownEnvironment = (typeof WIDGET_PROFILE_ENVIRONMENTS)[number]

export const WIDGET_PROFILE_CHANGELOG_MODES = [
  'all_published',
  'linked_to_allowed_feedback',
  'selected_entries',
] as const
export type WidgetProfileChangelogMode = (typeof WIDGET_PROFILE_CHANGELOG_MODES)[number]

export const WIDGET_PROFILE_TICKET_LIST_SCOPES = [
  'same_profile_allowed_inboxes',
  'allowed_inboxes',
  'requester_owned',
] as const
export type WidgetProfileTicketListScope = (typeof WIDGET_PROFILE_TICKET_LIST_SCOPES)[number]

export type WidgetProfileTicketPriority = 'low' | 'normal' | 'high' | 'urgent'

export interface WidgetProfileConfigOverrides {
  enabled?: boolean
  defaultBoard?: string | null
  position?: 'bottom-right' | 'bottom-left'
  identifyVerification?: boolean
  tabs?: {
    home?: boolean
    feedback?: boolean
    changelog?: boolean
    help?: boolean
    chat?: boolean
  }
  imageUploadsInWidget?: boolean
  ticketing?: {
    enabled?: boolean
  }
  chat?: Record<string, unknown>
}

export interface WidgetProfileContentFilters {
  feedback?: {
    boardIds?: BoardId[]
    boardSlugs?: string[]
    statusIds?: StatusId[]
    tagIds?: TagId[]
    tagSlugs?: string[]
  }
  changelog?: {
    mode?: WidgetProfileChangelogMode
    entryIds?: ChangelogId[]
    categoryIds?: ChangelogCategoryId[]
    categorySlugs?: string[]
    productIds?: ChangelogProductId[]
    productSlugs?: string[]
  }
  help?: {
    categoryIds?: HelpCenterCategoryId[]
    articleIds?: HelpCenterArticleId[]
  }
}

export interface WidgetProfileSupportDisplayRules {
  showPrioritySelector?: boolean
  showAttachments?: boolean
  showResolveAction?: boolean
  showReopenAction?: boolean
  emptyStateTitle?: string
  emptyStateDescription?: string
}

export interface WidgetProfileSupportCategory {
  categoryKey: string
  label: string
  description?: string
  icon?: string
  inboxId: InboxId
  defaultPriority?: WidgetProfileTicketPriority
  allowedPriorities?: WidgetProfileTicketPriority[]
  visible?: boolean
  display?: WidgetProfileSupportDisplayRules
}

export interface WidgetProfileSupportConfig {
  categories?: WidgetProfileSupportCategory[]
  ticketListScope?: WidgetProfileTicketListScope
  defaultDisplay?: WidgetProfileSupportDisplayRules
}

export const widgetApplications = pgTable(
  'widget_applications',
  {
    id: typeIdWithDefault('widget_app')('id').primaryKey(),
    /** Stable public key passed by host apps, e.g. "customer-dashboard". */
    key: text('key').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (t) => [
    uniqueIndex('widget_applications_key_idx').on(t.key),
    index('widget_applications_archived_at_idx').on(t.archivedAt),
  ]
)

export const widgetEnvironmentProfiles = pgTable(
  'widget_environment_profiles',
  {
    id: typeIdWithDefault('widget_profile')('id').primaryKey(),
    applicationId: typeIdColumn('widget_app')('application_id')
      .notNull()
      .references(() => widgetApplications.id, { onDelete: 'cascade' }),
    /** Environment name passed by host apps; stored normalized lowercase. */
    environment: text('environment').notNull(),
    displayName: text('display_name').notNull(),
    enabled: boolean('enabled').notNull().default(true),
    /** Exact origins, wildcard subdomains, and local patterns like http://localhost:*. */
    allowedOrigins: jsonb('allowed_origins').$type<string[]>().notNull().default([]),
    configOverrides: jsonb('config_overrides')
      .$type<WidgetProfileConfigOverrides>()
      .notNull()
      .default({}),
    contentFilters: jsonb('content_filters')
      .$type<WidgetProfileContentFilters>()
      .notNull()
      .default({}),
    supportConfig: jsonb('support_config')
      .$type<WidgetProfileSupportConfig>()
      .notNull()
      .default({}),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (t) => [
    index('widget_profiles_application_idx').on(t.applicationId),
    index('widget_profiles_environment_idx').on(t.environment),
    index('widget_profiles_enabled_idx').on(t.enabled),
    index('widget_profiles_archived_at_idx').on(t.archivedAt),
    uniqueIndex('widget_profiles_application_environment_active_idx')
      .on(t.applicationId, t.environment)
      .where(sql`archived_at IS NULL`),
  ]
)

export const widgetApplicationsRelations = relations(widgetApplications, ({ many }) => ({
  profiles: many(widgetEnvironmentProfiles),
}))

export const widgetEnvironmentProfilesRelations = relations(
  widgetEnvironmentProfiles,
  ({ one }) => ({
    application: one(widgetApplications, {
      fields: [widgetEnvironmentProfiles.applicationId],
      references: [widgetApplications.id],
    }),
  })
)
