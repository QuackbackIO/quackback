/**
 * Remote MCP connectors — the Agent Connectors catalog.
 *
 * One row per remote server: identity, auth, a cached tool catalog with
 * annotations, per-tool policies, and per-agent availability. Secret material
 * (bearer tokens / oauth tokens) is encrypted at rest (purpose
 * `connector-secrets`) and never round-trips to the client.
 */
import {
  pgTable,
  text,
  boolean,
  integer,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
  check,
} from 'drizzle-orm/pg-core'
import { relations, sql } from 'drizzle-orm'
import { typeIdWithDefault, typeIdColumnNullable } from '@quackback/ids/drizzle'
import { principal } from './auth'

export const CONNECTOR_AUTH_MODES = ['none', 'bearer', 'oauth'] as const
export type ConnectorAuthMode = (typeof CONNECTOR_AUTH_MODES)[number]

export const CONNECTOR_STATUSES = ['connected', 'error', 'disabled'] as const
export type ConnectorStatus = (typeof CONNECTOR_STATUSES)[number]

export const CONNECTOR_TOOL_POLICIES = ['always', 'approval', 'never'] as const
export type ConnectorToolPolicy = (typeof CONNECTOR_TOOL_POLICIES)[number]

export interface ConnectorToolAnnotations {
  readOnlyHint?: boolean
  destructiveHint?: boolean
}

export interface CachedConnectorTool {
  name: string
  title?: string
  description?: string
  annotations: ConnectorToolAnnotations
  /** JSON Schema for the tool's input, cached at discovery time. */
  inputSchema?: Record<string, unknown>
  inputSchemaHash?: string
  firstSeenAt: string
}

export interface ConnectorToolPolicies {
  groupDefaults: { read: ConnectorToolPolicy; write: ConnectorToolPolicy }
  tools: Record<string, ConnectorToolPolicy>
}

/** The uses a connector's tools can be authorized for, one policy record each. */
export const CONNECTOR_POLICY_PROFILES = ['agent', 'copilot', 'workspace'] as const
export type ConnectorPolicyProfile = (typeof CONNECTOR_POLICY_PROFILES)[number]

/**
 * One use's policy. `origin` records how the record came to exist: a record
 * projected from the pre-profile shared map says so, so an operator can tell a
 * migrated default from a decision somebody made.
 */
export interface ConnectorProfilePolicy {
  groupDefaults: { read: ConnectorToolPolicy; write: ConnectorToolPolicy }
  tools: Record<string, ConnectorToolPolicy>
  origin?: 'migrated_from_shared' | 'explicit'
}

/**
 * Policies keyed by use. A MISSING key is a denial, never a fallback to
 * another use: an unassigned use has no policy and resolves to never.
 */
export type ConnectorProfilePolicies = Partial<
  Record<ConnectorPolicyProfile, ConnectorProfilePolicy>
>

/**
 * The reviewed contract of one discovered tool.
 *
 * A tool is available only while its live contract still matches the reviewed
 * one, so this records the contract itself (the cached input-schema hash plus
 * the annotation hints that decide its group and destructiveness) rather than
 * a bare "reviewed" flag. `grandfathered` marks the tools carried over when
 * the review gate was introduced: they were already callable under the shared
 * policy map, so the migration records their contract as reviewed rather than
 * revoking working connectors.
 */
export interface ConnectorToolReview {
  schemaHash: string | null
  readOnlyHint: boolean
  destructiveHint: boolean
  catalogRevision: number
  reviewedAt: string
  reviewedByPrincipalId: string | null
  origin: 'grandfathered' | 'reviewed'
}

export type ConnectorToolReviews = Record<string, ConnectorToolReview>

export interface ConnectorAssignments {
  agent: boolean
  copilot: boolean
  workspace?: boolean
}

// Key order is jsonb-canonical (length, then bytewise) so the serialized
// column default matches what postgres stores for the migration's default;
// the drift check compares the two strings byte for byte.
export const DEFAULT_CONNECTOR_TOOL_POLICIES: ConnectorToolPolicies = {
  tools: {},
  groupDefaults: { read: 'always', write: 'approval' },
}

export const DEFAULT_CONNECTOR_ASSIGNMENTS: ConnectorAssignments = {
  agent: false,
  copilot: false,
}

export const connectors = pgTable(
  'connectors',
  {
    id: typeIdWithDefault('connector')('id').primaryKey(),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    url: text('url').notNull(),
    authMode: text('auth_mode', { enum: CONNECTOR_AUTH_MODES }).notNull(),
    /** Encrypted JSON. Never selected into a client DTO. */
    secrets: text('secrets'),
    status: text('status', { enum: CONNECTOR_STATUSES }).notNull().default('connected'),
    tools: jsonb('tools').$type<CachedConnectorTool[]>().notNull().default([]),
    toolPolicies: jsonb('tool_policies')
      .$type<ConnectorToolPolicies>()
      .notNull()
      .default(DEFAULT_CONNECTOR_TOOL_POLICIES),
    /**
     * Per-use policies. NULL means "not projected from `toolPolicies` yet":
     * migration 0288 deliberately carries no backfill (it must replay as a
     * no-op), so `ensureConnectorPolicyState` projects the shared map into the
     * uses this connector is already assigned to on first read.
     */
    profilePolicies: jsonb('profile_policies').$type<ConnectorProfilePolicies>(),
    /** Reviewed tool contracts, keyed by tool name. NULL like the column above. */
    toolReviews: jsonb('tool_reviews').$type<ConnectorToolReviews>(),
    /** Bumped by every discovery that adds, removes or changes a tool contract. */
    catalogRevision: integer('catalog_revision').notNull().default(1),
    /** Bumped by every policy write; the base version a client edit must match. */
    policyVersion: integer('policy_version').notNull().default(1),
    assignments: jsonb('assignments')
      .$type<ConnectorAssignments>()
      .notNull()
      .default(DEFAULT_CONNECTOR_ASSIGNMENTS),
    enabled: boolean('enabled').notNull().default(true),
    lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
    lastCallAt: timestamp('last_call_at', { withTimezone: true }),
    lastError: text('last_error'),
    lastErrorAt: timestamp('last_error_at', { withTimezone: true }),
    errorCount: integer('error_count').notNull().default(0),
    createdByPrincipalId: typeIdColumnNullable('principal')('created_by_principal_id').references(
      () => principal.id,
      { onDelete: 'set null' }
    ),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('connectors_slug_lower_unique').on(sql`lower(${table.slug})`),
    uniqueIndex('connectors_name_lower_unique').on(sql`lower(${table.name})`),
    index('connectors_enabled_idx').on(table.enabled),
    check('connectors_name_length_check', sql`char_length(${table.name}) BETWEEN 1 AND 80`),
    check('connectors_slug_length_check', sql`char_length(${table.slug}) BETWEEN 1 AND 20`),
    check('connectors_auth_mode_check', sql`${table.authMode} IN ('none', 'bearer', 'oauth')`),
    check('connectors_status_check', sql`${table.status} IN ('connected', 'error', 'disabled')`),
  ]
)

export const connectorsRelations = relations(connectors, ({ one }) => ({
  createdBy: one(principal, {
    fields: [connectors.createdByPrincipalId],
    references: [principal.id],
  }),
}))
