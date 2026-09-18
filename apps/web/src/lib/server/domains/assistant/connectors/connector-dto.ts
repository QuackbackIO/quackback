/**
 * The client-facing shape of a connector.
 *
 * Every tool carries one resolved decision PER USE rather than a single
 * policy, so the Connections page renders the same independent answers the
 * runtime resolves, and the review state and schema verdict travel with them:
 * a row that says "Needs approval" while the contract is unreviewed would be
 * a lie the admin would act on.
 */
import {
  resolveConnectorToolAccess,
  CONNECTOR_POLICY_PROFILES,
  type ConnectorDTO,
  type ConnectorToolDTO,
} from '@/lib/shared/assistant/connectors'
import type {
  CachedConnectorTool,
  ConnectorProfilePolicies,
  ConnectorToolReviews,
  connectors,
} from '@/lib/server/db'
import { reviewStateForTool } from './catalog-review'
import { analyzeToolInputSchema } from './tool-input-schema'
import { effectiveConnectorPolicyState } from './connector-policy-state'
import { groupForCachedTool, isNewTool } from './discovery'

type ConnectorRow = typeof connectors.$inferSelect

function toToolDTO(
  tool: CachedConnectorTool,
  state: { profilePolicies: ConnectorProfilePolicies; toolReviews: ConnectorToolReviews },
  lastSyncedAt: Date | null
): ConnectorToolDTO {
  const group = groupForCachedTool(tool)
  const review = reviewStateForTool(tool, state.toolReviews)
  const schema = analyzeToolInputSchema(tool.inputSchema)
  const policies = {} as ConnectorToolDTO['policies']
  for (const profile of CONNECTOR_POLICY_PROFILES) {
    policies[profile] = resolveConnectorToolAccess({
      profilePolicies: state.profilePolicies,
      profile,
      toolName: tool.name,
      group,
      reviewed: review.reviewed,
      schemaSupported: schema.supported,
    })
  }
  return {
    name: tool.name,
    title: tool.title,
    description: tool.description,
    group,
    destructive: tool.annotations.destructiveHint === true,
    policies,
    review: { state: review.state, changes: review.changes },
    schemaSupported: schema.supported,
    ...(schema.supported ? {} : { schemaIssue: schema.reason }),
    isNew: isNewTool(tool, lastSyncedAt),
  }
}

export function toConnectorDTO(row: ConnectorRow): ConnectorDTO {
  const state = effectiveConnectorPolicyState(row)
  const tools = row.tools.map((tool) => toToolDTO(tool, state, row.lastSyncedAt))
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    url: row.url,
    authMode: row.authMode,
    hasSecret: Boolean(row.secrets),
    status: row.status,
    enabled: row.enabled,
    assignments: row.assignments,
    profilePolicies: state.profilePolicies,
    policyVersion: row.policyVersion,
    catalogRevision: row.catalogRevision,
    tools,
    toolCount: row.tools.length,
    unreviewedCount: tools.filter((tool) => tool.review.state !== 'reviewed').length,
    lastSyncedAt: row.lastSyncedAt?.toISOString() ?? null,
    lastCallAt: row.lastCallAt?.toISOString() ?? null,
    lastError: row.lastError,
    lastErrorAt: row.lastErrorAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}
