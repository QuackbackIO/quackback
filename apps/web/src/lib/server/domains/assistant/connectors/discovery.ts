/**
 * Discover and diff a connector's tool catalog.
 *
 * New tools inherit their group default and get firstSeenAt. Vanished tools
 * are pruned from the catalog AND from per-tool policy overrides.
 */
import { createHash } from 'node:crypto'
import type { CachedConnectorTool, ConnectorToolPolicies } from '@/lib/server/db'
import {
  DEFAULT_CONNECTOR_TOOL_POLICIES,
  toolGroupFromAnnotations,
  type ConnectorToolPoliciesInput,
} from '@/lib/shared/assistant/connectors'
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
