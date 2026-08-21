/**
 * Agent Connectors — client-safe contract.
 *
 * One connector = a named remote MCP server, an auth mode, a cached tool
 * catalog, a per-tool permission dial, and per-agent availability. Secrets
 * never appear on this DTO.
 */
import { z } from 'zod'

export const CONNECTOR_NAME_MAX_LENGTH = 80
export const CONNECTOR_SLUG_MAX_LENGTH = 20
export const CONNECTOR_URL_MAX_LENGTH = 2_000
export const CONNECTOR_BEARER_TOKEN_MAX_LENGTH = 4_000
export const CONNECTOR_RESPONSE_CHAR_LIMIT = 4_000
export const CONNECTOR_REQUEST_TIMEOUT_MS = 10_000
export const CONNECTOR_MAX_RESPONSE_BYTES = 256 * 1024
export const CONNECTOR_TOOL_NAME_MAX = 64

/** Two-letter mark from a connector name. Schema-reachable names are min(1). */
export function connectorInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length >= 2) {
    return `${parts[0]![0] ?? ''}${parts[1]![0] ?? ''}`.toUpperCase()
  }
  return name.trim().slice(0, 2).toUpperCase() || '?'
}

export const CONNECTOR_AUTH_MODES = ['none', 'bearer', 'oauth'] as const
export const connectorAuthModeSchema = z.enum(CONNECTOR_AUTH_MODES)
export type ConnectorAuthMode = z.infer<typeof connectorAuthModeSchema>

export const CONNECTOR_STATUSES = ['connected', 'error', 'disabled'] as const
export const connectorStatusSchema = z.enum(CONNECTOR_STATUSES)
export type ConnectorStatus = z.infer<typeof connectorStatusSchema>

export const CONNECTOR_TOOL_POLICIES = ['always', 'approval', 'never'] as const
export const connectorToolPolicySchema = z.enum(CONNECTOR_TOOL_POLICIES)
export type ConnectorToolPolicy = z.infer<typeof connectorToolPolicySchema>

export const CONNECTOR_TOOL_GROUPS = ['read', 'write'] as const
export type ConnectorToolGroup = (typeof CONNECTOR_TOOL_GROUPS)[number]

export const connectorAssignmentsSchema = z.object({
  agent: z.boolean(),
  copilot: z.boolean(),
})
export type ConnectorAssignments = z.infer<typeof connectorAssignmentsSchema>

export const connectorToolPoliciesSchema = z.object({
  groupDefaults: z.object({
    read: connectorToolPolicySchema,
    write: connectorToolPolicySchema,
  }),
  tools: z.record(z.string(), connectorToolPolicySchema),
})
export type ConnectorToolPoliciesInput = z.infer<typeof connectorToolPoliciesSchema>

export const DEFAULT_CONNECTOR_TOOL_POLICIES: ConnectorToolPoliciesInput = {
  groupDefaults: { read: 'always', write: 'approval' },
  tools: {},
}

export const connectorCreateInputSchema = z.object({
  name: z.string().trim().min(1).max(CONNECTOR_NAME_MAX_LENGTH),
  url: z
    .string()
    .trim()
    .min(1)
    .max(CONNECTOR_URL_MAX_LENGTH)
    .refine((value) => {
      try {
        return new URL(value).protocol === 'https:'
      } catch {
        return false
      }
    }, 'Enter an HTTPS MCP server URL'),
  authMode: connectorAuthModeSchema.default('none'),
  bearerToken: z.string().max(CONNECTOR_BEARER_TOKEN_MAX_LENGTH).optional(),
  assignments: connectorAssignmentsSchema.default({ agent: true, copilot: true }),
})
export type ConnectorCreateInput = z.infer<typeof connectorCreateInputSchema>

export const connectorUpdateInputSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1).max(CONNECTOR_NAME_MAX_LENGTH).optional(),
  url: z
    .string()
    .trim()
    .min(1)
    .max(CONNECTOR_URL_MAX_LENGTH)
    .refine((value) => {
      try {
        return new URL(value).protocol === 'https:'
      } catch {
        return false
      }
    }, 'Enter an HTTPS MCP server URL')
    .optional(),
  authMode: connectorAuthModeSchema.optional(),
  bearerToken: z.string().max(CONNECTOR_BEARER_TOKEN_MAX_LENGTH).optional(),
  clearBearerToken: z.boolean().optional(),
  assignments: connectorAssignmentsSchema.optional(),
  toolPolicies: connectorToolPoliciesSchema.optional(),
  enabled: z.boolean().optional(),
})
export type ConnectorUpdateInput = z.infer<typeof connectorUpdateInputSchema>

export interface ConnectorToolDTO {
  name: string
  title?: string
  description?: string
  group: ConnectorToolGroup
  destructive: boolean
  policy: ConnectorToolPolicy
  isOverride: boolean
  isNew: boolean
}

export interface ConnectorDTO {
  id: string
  name: string
  slug: string
  url: string
  authMode: ConnectorAuthMode
  hasSecret: boolean
  status: ConnectorStatus
  enabled: boolean
  assignments: ConnectorAssignments
  toolPolicies: ConnectorToolPoliciesInput
  tools: ConnectorToolDTO[]
  toolCount: number
  lastSyncedAt: string | null
  lastCallAt: string | null
  lastError: string | null
  lastErrorAt: string | null
  createdAt: string
  updatedAt: string
  /** Present when create needs an interactive authorize redirect. */
  authorizationUrl?: string
}

export interface BuiltinConnectorToolDTO {
  name: string
  label: string
  description: string
  group: ConnectorToolGroup
}

export interface BuiltinConnectorDTO {
  id: 'quackback'
  name: string
  builtin: true
  tools: BuiltinConnectorToolDTO[]
}

/**
 * Stable slug used as the tool-name namespace. Capped at 20 chars so
 * `connector_<slug>__<tool>` stays inside the 64-char function-name limit
 * for typical tool names.
 */
export function slugifyConnectorName(name: string): string {
  const slug = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, CONNECTOR_SLUG_MAX_LENGTH)
  return slug.length > 0 ? slug : 'connector'
}

/** Four-char stable hash of a tool name, used when the full name overflows 64. */
export function stableToolHash(value: string): string {
  let hash = 5381
  for (let i = 0; i < value.length; i++) {
    hash = ((hash << 5) + hash + value.charCodeAt(i)) | 0
  }
  return (hash >>> 0).toString(16).padStart(4, '0').slice(0, 4)
}

export function connectorToolName(slug: string, toolName: string): string {
  const prefix = `connector_${slug}__`
  if (prefix.length + toolName.length <= CONNECTOR_TOOL_NAME_MAX) {
    return `${prefix}${toolName}`
  }
  const hash = stableToolHash(toolName)
  const keep = Math.max(1, CONNECTOR_TOOL_NAME_MAX - prefix.length - 1 - hash.length)
  return `${prefix}${toolName.slice(0, keep)}_${hash}`
}

export function parseConnectorToolName(name: string): { slug: string; tool: string } | null {
  if (!name.startsWith('connector_')) return null
  const rest = name.slice('connector_'.length)
  const sep = rest.indexOf('__')
  if (sep <= 0) return null
  return { slug: rest.slice(0, sep), tool: rest.slice(sep + 2) }
}

export function toolGroupFromAnnotations(annotations: {
  readOnlyHint?: boolean
}): ConnectorToolGroup {
  return annotations.readOnlyHint === true ? 'read' : 'write'
}

export function resolveToolPolicy(
  policies: ConnectorToolPoliciesInput,
  toolName: string,
  group: ConnectorToolGroup
): ConnectorToolPolicy {
  return policies.tools[toolName] ?? policies.groupDefaults[group]
}
