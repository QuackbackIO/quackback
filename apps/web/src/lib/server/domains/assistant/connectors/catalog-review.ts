/**
 * Reviewed tool contracts.
 *
 * A remote MCP server can change what its tools accept, and what they claim
 * about themselves, between one discovery and the next. Annotations are hints
 * from that server, not grants (the MCP specification says as much), and the
 * read/write hint is exactly what decides which group default a tool would
 * otherwise inherit. So a tool is callable only while its live contract still
 * matches the one a teammate reviewed, and "new" is just the case where no
 * reviewed contract exists at all.
 *
 * The recorded contract is a fingerprint, not the schema: the input schema
 * hashed over canonically sorted keys (so a server that reorders its JSON does
 * not look like it changed something), plus the two annotation hints. That is
 * everything the availability decision reads.
 */
import { createHash } from 'node:crypto'
import { analyzeToolInputSchema, MAX_SCHEMA_DEPTH } from './tool-input-schema'
import type {
  CachedConnectorTool,
  ConnectorToolReview,
  ConnectorToolReviews,
} from '@/lib/server/db'

export interface ToolContractFingerprint {
  schemaHash: string | null
  readOnlyHint: boolean
  destructiveHint: boolean
}

/** Stable JSON: object keys sorted at every depth. */
function canonicalJson(value: unknown, depth = 0): string | null {
  if (depth > MAX_SCHEMA_DEPTH) return null
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) {
    const children = value.map((child) => canonicalJson(child, depth + 1))
    return children.includes(null) ? null : `[${children.join(',')}]`
  }
  const entries: string[] = []
  for (const key of Object.keys(value).sort()) {
    const nested = (value as Record<string, unknown>)[key]
    if (nested === undefined) continue
    const child = canonicalJson(nested, depth + 1)
    if (child === null) return null
    entries.push(`${JSON.stringify(key)}:${child}`)
  }
  return `{${entries.join(',')}}`
}

export function toolContractFingerprint(tool: CachedConnectorTool): ToolContractFingerprint {
  const canonical = tool.inputSchema ? canonicalJson(tool.inputSchema) : null
  return {
    schemaHash:
      canonical !== null ? createHash('sha256').update(canonical).digest('hex').slice(0, 32) : null,
    readOnlyHint: tool.annotations?.readOnlyHint === true,
    destructiveHint: tool.annotations?.destructiveHint === true,
  }
}

export interface ToolReviewState {
  state: 'reviewed' | 'new' | 'changed'
  reviewed: boolean
  /** What moved since the review, in the words the connector page shows. */
  changes: string[]
}

export function reviewStateForTool(
  tool: CachedConnectorTool,
  reviews: ConnectorToolReviews | null | undefined
): ToolReviewState {
  const review = reviews?.[tool.name]
  if (!analyzeToolInputSchema(tool.inputSchema).supported) {
    return {
      state: review ? 'changed' : 'new',
      reviewed: false,
      changes: ['unsupported input schema'],
    }
  }
  if (!review) return { state: 'new', reviewed: false, changes: [] }
  const current = toolContractFingerprint(tool)
  const changes: string[] = []
  if (current.schemaHash !== review.schemaHash) changes.push('input schema')
  if (current.readOnlyHint !== review.readOnlyHint) changes.push('read-only hint')
  if (current.destructiveHint !== review.destructiveHint) changes.push('destructive hint')
  return changes.length === 0
    ? { state: 'reviewed', reviewed: true, changes }
    : { state: 'changed', reviewed: false, changes }
}

function recordFor(
  tool: CachedConnectorTool,
  catalogRevision: number,
  principalId: string | null,
  origin: ConnectorToolReview['origin']
): ConnectorToolReview {
  const fingerprint = toolContractFingerprint(tool)
  return {
    schemaHash: fingerprint.schemaHash,
    readOnlyHint: fingerprint.readOnlyHint,
    destructiveHint: fingerprint.destructiveHint,
    catalogRevision,
    reviewedAt: new Date().toISOString(),
    reviewedByPrincipalId: principalId,
    origin,
  }
}

/**
 * Record the contracts a connector's tools already had when the review gate
 * arrived. These tools were callable under the shared policy map, so revoking
 * them would break working connectors for a change nobody made; recording what
 * they currently declare keeps them working and makes the NEXT change visible.
 */
export function grandfatherToolReviews(
  tools: readonly CachedConnectorTool[],
  catalogRevision: number
): ConnectorToolReviews {
  const reviews: ConnectorToolReviews = {}
  for (const tool of tools) {
    if (!analyzeToolInputSchema(tool.inputSchema).supported) continue
    reviews[tool.name] = recordFor(tool, catalogRevision, null, 'grandfathered')
  }
  return reviews
}

/** Mark the named tools reviewed at their CURRENT contract. */
export function reviewToolContracts(input: {
  tools: readonly CachedConnectorTool[]
  reviews: ConnectorToolReviews | null | undefined
  toolNames: readonly string[]
  catalogRevision: number
  principalId: string | null
}): ConnectorToolReviews {
  const live = new Map(input.tools.map((tool) => [tool.name, tool]))
  const next: ConnectorToolReviews = { ...(input.reviews ?? {}) }
  for (const name of input.toolNames) {
    const tool = live.get(name)
    if (!tool || !analyzeToolInputSchema(tool.inputSchema).supported) continue
    next[name] = recordFor(tool, input.catalogRevision, input.principalId, 'reviewed')
  }
  return next
}

/** Drop reviews for tools the server no longer publishes. */
export function pruneToolReviews(
  reviews: ConnectorToolReviews | null | undefined,
  liveNames: ReadonlySet<string>
): ConnectorToolReviews {
  const next: ConnectorToolReviews = {}
  for (const [name, review] of Object.entries(reviews ?? {})) {
    if (liveNames.has(name)) next[name] = review
  }
  return next
}
