/**
 * Discover and diff a connector's tool catalog.
 *
 * Vanished tools are pruned from the catalog, from every use's per-tool
 * overrides, and from the reviewed contracts. A new or changed tool does NOT
 * inherit a group default any more: `applyConnectorCatalogDiff` leaves it
 * without a reviewed contract, which the resolver reads as unavailable to
 * every use until a teammate reviews it. `applyCatalogDiff` below still
 * maintains the legacy shared map so the two can be compared during rollout.
 */
import { createHash } from 'node:crypto'
import type {
  CachedConnectorTool,
  ConnectorAssignments,
  ConnectorProfilePolicies,
  ConnectorToolPolicies,
  ConnectorToolReviews,
} from '@/lib/server/db'
import {
  DEFAULT_CONNECTOR_TOOL_POLICIES,
  projectSharedPoliciesToProfiles,
  toolGroupFromAnnotations,
  type ConnectorToolPoliciesInput,
} from '@/lib/shared/assistant/connectors'
import { grandfatherToolReviews, pruneToolReviews, reviewStateForTool } from './catalog-review'
import type { DiscoveredMcpTool } from './mcp-client'

export interface CatalogDiff {
  tools: CachedConnectorTool[]
  toolPolicies: ConnectorToolPolicies
  added: string[]
  removed: string[]
}

function hashInputSchema(schema: Record<string, unknown> | undefined): string | undefined {
  if (!schema) return undefined
  return createHash('sha256').update(JSON.stringify(schema)).digest('hex').slice(0, 16)
}

export function applyCatalogDiff(
  previous: readonly CachedConnectorTool[],
  discovered: readonly DiscoveredMcpTool[],
  previousPolicies:
    ConnectorToolPoliciesInput | ConnectorToolPolicies = DEFAULT_CONNECTOR_TOOL_POLICIES
): CatalogDiff {
  const now = new Date().toISOString()
  const previousByName = new Map(previous.map((tool) => [tool.name, tool]))
  const nextTools: CachedConnectorTool[] = discovered.map((tool) => {
    const existing = previousByName.get(tool.name)
    return {
      name: tool.name,
      title: tool.title,
      description: tool.description,
      annotations: tool.annotations,
      inputSchema: tool.inputSchema,
      inputSchemaHash: hashInputSchema(tool.inputSchema),
      firstSeenAt: existing?.firstSeenAt ?? now,
    }
  })
  const nextNames = new Set(nextTools.map((tool) => tool.name))
  const added = nextTools.filter((tool) => !previousByName.has(tool.name)).map((tool) => tool.name)
  const removed = previous.filter((tool) => !nextNames.has(tool.name)).map((tool) => tool.name)

  const groupDefaults =
    previousPolicies.groupDefaults ?? DEFAULT_CONNECTOR_TOOL_POLICIES.groupDefaults
  const nextOverrides: Record<string, ConnectorToolPolicies['tools'][string]> = {}
  for (const [name, policy] of Object.entries(previousPolicies.tools ?? {})) {
    if (nextNames.has(name)) nextOverrides[name] = policy
  }

  return {
    tools: nextTools,
    toolPolicies: { groupDefaults, tools: nextOverrides },
    added,
    removed,
  }
}

export function isNewTool(tool: CachedConnectorTool, lastSyncedAt: Date | null): boolean {
  if (!lastSyncedAt) return false
  return new Date(tool.firstSeenAt).getTime() > lastSyncedAt.getTime()
}

export function groupForCachedTool(tool: CachedConnectorTool) {
  return toolGroupFromAnnotations(tool.annotations)
}

/** Everything a diff needs to know about the connector it is diffing. */
export interface ConnectorCatalogState {
  tools: readonly CachedConnectorTool[]
  toolPolicies: ConnectorToolPolicies
  profilePolicies: ConnectorProfilePolicies | null
  toolReviews: ConnectorToolReviews | null
  catalogRevision: number
  assignments: ConnectorAssignments
}

export interface ConnectorCatalogDiff extends CatalogDiff {
  profilePolicies: ConnectorProfilePolicies
  toolReviews: ConnectorToolReviews
  catalogRevision: number
  /** Tools whose reviewed contract no longer matches what the server publishes. */
  changed: string[]
}

/**
 * Diff a catalog while maintaining the per-use policies and the reviewed
 * contracts.
 *
 * Three things happen that the legacy diff cannot do:
 *
 * - A connector still carrying the pre-profile shared map is projected into
 *   the uses it is already assigned to (never into others), which is the lazy
 *   half of migration 0288.
 * - Every use's per-tool overrides are pruned to the live catalog, so a tool
 *   that vanishes and later returns cannot resurrect an old override.
 * - The catalog revision moves only when something actually changed, so an
 *   unchanged refresh does not invalidate a review a teammate just gave.
 */
export function applyConnectorCatalogDiff(
  state: ConnectorCatalogState,
  discovered: readonly DiscoveredMcpTool[]
): ConnectorCatalogDiff {
  const base = applyCatalogDiff(state.tools, discovered, state.toolPolicies)
  const liveNames = new Set(base.tools.map((tool) => tool.name))

  const effectivePolicies =
    state.profilePolicies ?? projectSharedPoliciesToProfiles(state.toolPolicies, state.assignments)
  const profilePolicies: ConnectorProfilePolicies = {}
  for (const [profile, record] of Object.entries(effectivePolicies)) {
    if (!record) continue
    const tools: Record<string, (typeof record.tools)[string]> = {}
    for (const [name, policy] of Object.entries(record.tools)) {
      if (liveNames.has(name)) tools[name] = policy
    }
    profilePolicies[profile as keyof ConnectorProfilePolicies] = { ...record, tools }
  }

  // Grandfathering reads the PREVIOUS catalog on purpose: tools this diff is
  // adding were never callable, so they start unreviewed like any other new
  // contract.
  const reviews = pruneToolReviews(
    state.toolReviews ?? grandfatherToolReviews(state.tools, state.catalogRevision),
    liveNames
  )
  const changed = base.tools
    .filter((tool) => reviewStateForTool(tool, reviews).state === 'changed')
    .map((tool) => tool.name)

  const moved = base.added.length > 0 || base.removed.length > 0 || changed.length > 0
  return {
    ...base,
    profilePolicies,
    toolReviews: reviews,
    catalogRevision: moved ? state.catalogRevision + 1 : state.catalogRevision,
    changed,
  }
}
