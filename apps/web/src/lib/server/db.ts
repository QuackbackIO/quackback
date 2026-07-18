/**
 * Core database connection for the web app.
 *
 * This module contains the actual database initialization and connection logic.
 * This is the canonical location for database imports.
 *
 * @example
 * import { db, eq, and, posts } from '@/lib/server/db'
 */

import { createDb, type Database as PostgresDatabase } from '@quackback/db/client'
import { config } from '@/lib/server/config'

// Import drizzle-orm operators explicitly to work around Nitro bundler issues
// with nested barrel exports. If we use `export { asc } from 'drizzle-orm'`,
// the bundler may create export objects that reference `asc` without importing it.
import {
  eq as _eq,
  and as _and,
  or as _or,
  ne as _ne,
  gt as _gt,
  gte as _gte,
  lt as _lt,
  lte as _lte,
  like as _like,
  ilike as _ilike,
  inArray as _inArray,
  notInArray as _notInArray,
  isNull as _isNull,
  isNotNull as _isNotNull,
  exists as _exists,
  notExists as _notExists,
  sql as _sql,
  desc as _desc,
  asc as _asc,
  count as _count,
  sum as _sum,
  avg as _avg,
  min as _min,
  max as _max,
} from 'drizzle-orm'

// Re-export with original names
export const eq = _eq
export const and = _and
export const or = _or
export const ne = _ne
export const gt = _gt
export const gte = _gte
export const lt = _lt
export const lte = _lte
export const like = _like
export const ilike = _ilike
export const inArray = _inArray
export const notInArray = _notInArray
export const isNull = _isNull
export const isNotNull = _isNotNull
export const exists = _exists
export const notExists = _notExists
export const sql = _sql
export const desc = _desc
export const asc = _asc
export const count = _count
export const sum = _sum
export const avg = _avg
export const min = _min
export const max = _max

// Database type - postgres.js for self-hosted
export type Database = PostgresDatabase
export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0]

// Use globalThis to persist database instance across hot reloads in development
declare global {
  var __db: PostgresDatabase | undefined
}

/**
 * Get the database instance.
 * Returns a singleton connection using DATABASE_URL.
 */
function getDatabase(): Database {
  if (!globalThis.__db) {
    globalThis.__db = createDb(config.databaseUrl, {
      max: config.dbPoolMax,
      idleTimeout: config.dbIdleTimeout,
    })
  }
  return globalThis.__db
}

/**
 * Database instance.
 * Uses a Proxy to lazily resolve the database on first access.
 */
export const db: Database = new Proxy({} as Database, {
  get(_, prop) {
    const database = getDatabase()
    return (database as unknown as Record<string | symbol, unknown>)[prop]
  },
})

// Re-export everything from the db package
// Note: We explicitly import and re-export drizzle-orm operators here
// because Nitro's bundler has issues with nested barrel exports (export *)
// that can cause "X is not defined" errors at runtime.
export {
  // Schema tables - auth
  account,
  accountRelations,
  invitation,
  invitationRelations,
  jwks,
  oauthAccessToken,
  oauthAccessTokenRelations,
  oauthClient,
  oauthClientRelations,
  oauthConsent,
  oauthConsentRelations,
  oauthRefreshToken,
  oauthRefreshTokenRelations,
  principal,
  principalRelations,
  oneTimeToken,
  session,
  sessionRelations,
  settings,
  settingsRelations,
  identityProvider,
  ssoVerifiedDomain,
  twoFactor,
  user,
  userRelations,
  verification,
  widgetOriginSession,
  widgetIdentifiedSession,
  // Schema tables - boards
  boards,
  boardsRelations,
  roadmaps,
  roadmapsRelations,
  roadmapColumns,
  roadmapColumnsRelations,
  postTags,
  postTagsRelations,
  // Schema tables - statuses
  DEFAULT_STATUSES,
  postStatuses,
  postStatusesRelations,
  STATUS_CATEGORIES,
  // Schema tables - posts
  postCommentEditHistory,
  commentEditHistoryRelations,
  postCommentReactions,
  commentReactionsRelations,
  postComments,
  postCommentsRelations,
  postEditHistory,
  postEditHistoryRelations,
  postMentions,
  postMentionsRelations,
  postNotes,
  postNotesRelations,
  posts,
  postsRelations,
  postTagAssignments,
  postTagAssignmentsRelations,
  postVotes,
  postVotesRelations,
  // Schema tables - companies
  companies,
  companiesRelations,
  // Schema tables - teams
  teams,
  teamsRelations,
  teamMembers,
  teamMembersRelations,
  // Schema tables - tickets (support platform §4.2)
  tickets,
  ticketsRelations,
  ticketStatuses,
  ticketStatusesRelations,
  ticketConversations,
  ticketConversationsRelations,
  ticketLinks,
  ticketLinksRelations,
  ticketActivity,
  ticketActivityRelations,
  ticketSubscriptions,
  ticketSubscriptionsRelations,
  DEFAULT_TICKET_STATUSES,
  // Schema tables - email channel (support platform §4.8)
  channelAccounts,
  emailSendingDomains,
  // Schema tables - office hours + SLA (support platform §4.6)
  officeHoursSchedules,
  slaPolicies,
  slaEvents,
  // Schema tables - workflows engine (support platform §4.6)
  workflows,
  workflowRuns,
  workflowRunEvents,
  workflowVersions,
  // Schema tables - integrations
  integrationEventMappings,
  integrationEventMappingsRelations,
  integrationPlatformCredentials,
  integrationPlatformCredentialsRelations,
  integrations,
  integrationsRelations,
  slackChannelMonitors,
  slackChannelMonitorsRelations,
  // Schema tables - external links
  postExternalLinks,
  postExternalLinksRelations,
  ticketExternalLinks,
  ticketExternalLinksRelations,
  // Schema tables - import runs (imports & exports hub)
  importRuns,
  importRunsRelations,
  // Schema tables - export runs (workspace data export)
  exportRuns,
  exportRunsRelations,
  // Schema tables - changelog
  changelogEntries,
  changelogEntriesRelations,
  changelogEntryPosts,
  changelogEntryPostsRelations,
  changelogCategories,
  changelogCategoriesRelations,
  changelogEntryCategories,
  changelogEntryCategoriesRelations,
  changelogSubscriptions,
  changelogSubscriptionsRelations,
  // Schema tables - conversations
  conversations,
  conversationsRelations,
  conversationMessages,
  conversationMessagesRelations,
  conversationTags,
  conversationTagsRelations,
  conversationTagAssignments,
  conversationTagAssignmentsRelations,
  conversationMessageMentions,
  conversationMessageMentionsRelations,
  conversationMessageReactions,
  conversationMessageReactionsRelations,
  conversationMessageFlags,
  conversationMessageFlagsRelations,
  conversationMessageTranslations,
  conversationMessageTranslationsRelations,
  // Schema tables - past-conversation summaries (Quinn grounding, P2-A.4)
  conversationSummaries,
  conversationSummariesRelations,
  // Schema tables - closed-ticket resolution summaries (Quinn grounding, Phase 4)
  ticketSummaries,
  ticketSummariesRelations,
  // Schema tables - custom saved inbox views + per-user pins
  conversationViews,
  conversationViewPins,
  // Schema tables - conversation attribute definitions
  conversationAttributeDefinitions,
  type ConversationAttributeFieldType,
  type ConversationAttributeOption,
  type ConversationAttributeSourceHint,
  // Schema tables - channel identities + outbound-email threading
  channelIdentities,
  conversationOutboundEmails,
  // Schema tables - macros (canned replies + bundled actions)
  macros,
  // Schema tables - notifications
  inAppNotifications,
  inAppNotificationsRelations,
  notificationPreferences,
  notificationPreferencesRelations,
  postSubscriptions,
  postSubscriptionsRelations,
  unsubscribeTokens,
  unsubscribeTokensRelations,
  // Schema tables - sentiment
  postSentiment,
  postSentimentRelations,
  // Schema tables - api keys
  apiKeys,
  apiKeysRelations,
  // Schema tables - webhooks
  webhooks,
  webhooksRelations,
  // Schema tables - hook delivery idempotency
  hookDeliveries,
  // Schema tables - durable event outbox (EVENTING-V2 spine)
  events,
  // Schema tables - third-party app platform
  apps,
  // Schema tables - audit log
  auditLog,
  // Schema tables - sso recovery codes
  ssoRecoveryCode,
  // Schema tables - segments
  segments,
  segmentsRelations,
  userSegments,
  userSegmentsRelations,
  type SegmentRules,
  type SegmentCondition,
  type SegmentRuleOperator,
  type SegmentRuleAttribute,
  type EvaluationSchedule,
  type SegmentWeightConfig,
  type UserAttributeDefinition,
  type UserAttributeType,
  type CurrencyCode,
  // Schema tables - user attributes
  userAttributeDefinitions,
  // Schema tables - company attributes
  companyAttributeDefinitions,
  // Schema tables - feedback aggregation
  feedbackSources,
  feedbackSourcesRelations,
  rawFeedbackItems,
  rawFeedbackItemsRelations,
  feedbackSignals,
  feedbackSignalsRelations,
  feedbackSuggestions,
  feedbackSuggestionsRelations,
  externalUserMappings,
  externalUserMappingsRelations,
  // Schema tables - merge suggestions
  mergeSuggestions,
  mergeSuggestionsRelations,
  // Schema tables - activity
  postActivity,
  postActivityRelations,
  // Schema tables - ai usage log
  aiUsageLog,
  // Schema tables - pipeline log
  pipelineLog,
  // Schema tables - analytics
  analyticsDailyStats,
  analyticsTopPosts,
  // Schema tables - visitor analytics
  pageViews,
  visitorStatsDaily,
  visitorTopStats,
  visitorDevices,
  VISITOR_SURFACES,
  VISITOR_TOP_DIMENSIONS,
  ensurePageViewPartitions,
  dropExpiredPageViewPartitions,
  refreshVisitorAnalytics,
  VISITOR_PERIODS,
  // Schema tables - help center
  helpCenterCategories,
  helpCenterCategoriesRelations,
  helpCenterArticles,
  helpCenterArticlesRelations,
  helpCenterArticleFeedback,
  helpCenterArticleFeedbackRelations,
  helpCenterRedirectRules,
  helpCenterArticleTranslations,
  helpCenterArticleTranslationsRelations,
  helpCenterCategoryTranslations,
  helpCenterCategoryTranslationsRelations,
  LOCALE_TO_REGCONFIG,
  regconfigForLocale,
  // Schema tables - status page
  statusComponentGroups,
  statusComponentGroupsRelations,
  statusComponents,
  statusComponentsRelations,
  statusComponentEvents,
  statusComponentEventsRelations,
  statusIncidents,
  statusIncidentsRelations,
  statusIncidentUpdates,
  statusIncidentUpdatesRelations,
  statusIncidentComponents,
  statusIncidentComponentsRelations,
  statusSubscriptions,
  statusSubscriptionsRelations,
  statusIncidentTemplates,
  // Schema tables - push devices
  pushDevices,
  // Schema tables - assistant (Quinn) involvement record
  assistantInvolvements,
  ASSISTANT_INVOLVEMENT_TRIGGERS,
  ASSISTANT_INVOLVEMENT_STATUSES,
  ASSISTANT_HANDOFF_REASONS,
  // Schema tables - assistant guidance rules
  assistantGuidanceRules,
  // Schema tables - assistant custom actions (Phase 5 library)
  assistantActions,
  assistantActionsRelations,
  type StoredAssistantActionHeader,
  type StoredAssistantActionVariable,
  // Schema tables - assistant snippets
  assistantSnippets,
  assistantSnippetsRelations,
  // Schema tables - assistant pending actions
  assistantPendingActions,
  ASSISTANT_PENDING_ACTION_STATUSES,
  // Schema tables - assistant tool-call audit log
  assistantToolCalls,
  ASSISTANT_TOOL_CALL_STATUSES,
  // Schema tables - assistant usage events (Copilot outcome loop)
  assistantEvents,
  // Schema tables - RBAC
  roles,
  permissions,
  rolePermissions,
  principalRoleAssignments,
  // RBAC permission catalogue (the code-authoritative contract)
  PERMISSIONS,
  ALL_PERMISSIONS,
  PERMISSION_CATALOGUE,
  PERMISSION_CATEGORIES,
  WORKSPACE_ADMIN_PERMISSIONS,
  SYSTEM_ROLES,
  SYSTEM_ROLE_DEFS,
  SYSTEM_ROLE_PERMISSIONS,
  presetForLegacyRole,
  // Migration ledger status (readiness probe)
  getMigrationStatus,
  // System-data reconcile (integration tests exercise the assignment heal)
  seedSystemData,
  // Types/constants
  REACTION_EMOJIS,
  USE_CASE_TYPES,
} from '@quackback/db'

// Re-export schema types not covered by @quackback/db/types
export type {
  AssistantInvolvementSource,
  AssistantInvolvementStatus,
  AssistantInvolvementTrigger,
  AssistantHandoffReason,
  AssistantPendingActionStatus,
  AssistantToolCallStatus,
  AssistantSnippet,
  ConversationSummary,
  MacroScope,
  MacroPriority,
  MacroSnoozePreset,
  MacroAction,
} from '@quackback/db'
export type { ServiceMetadata } from '@quackback/db'
export type { IdentityProviderAttributeMapping } from '@quackback/db'
export type { PermissionKey, PermissionCategory, SystemRoleKey } from '@quackback/db'
export type {
  ChannelAccount,
  EmailSendingDomain,
  ChannelAccountConfig,
  SendingDomainDnsRecord,
} from '@quackback/db'
export type { OfficeHoursSchedule, OfficeHoursInterval } from '@quackback/db'
export type { ChangelogSubscriptionSource } from '@quackback/db'
export type { TicketSubscriptionReason } from '@quackback/db'
export type {
  StatusComponentStatus,
  StatusIncidentStatus,
  StatusMaintenanceStatus,
  StatusIncidentKind,
  StatusIncidentImpact,
  StatusComponentEventSource,
  StatusSubscriptionScope,
  StatusSubscriptionSource,
} from '@quackback/db'
export type { SlaPolicy, SlaEvent } from '@quackback/db'
export type {
  ImportRunSource,
  ImportRunStatus,
  ImportRunTotals,
  ImportRunErrorEntry,
} from '@quackback/db'
export type { ExportRunStatus, ExportRunEntityCounts } from '@quackback/db'
export type {
  Workflow,
  WorkflowRun,
  WorkflowRunEvent,
  WorkflowVersion,
  WorkflowClass,
  WorkflowStatus,
  WorkflowRunState,
} from '@quackback/db'

// Re-export types (for client components that need types without side effects)
export * from '@quackback/db/types'
