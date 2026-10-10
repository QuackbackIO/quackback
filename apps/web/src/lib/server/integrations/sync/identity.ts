import { createHash } from 'node:crypto'
import type { IntegrationDefinition } from '../types'

/** Sort object keys, retain array ordering. Credentials must never be part of identity. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`)
      .join(',')}}`
  }
  return JSON.stringify(value ?? null)
}
export function syncHash(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex')
}
export function installationIdentity(integration: {
  id: string
  connectedAt: Date | string | null
}): string {
  return `${integration.id}:${integration.connectedAt ? new Date(integration.connectedAt).toISOString() : 'initial'}`
}
/** Connection scope alongside the target: repo numbers and project keys are not global IDs. */
export function syncDestination(
  target: unknown,
  config: Record<string, unknown>,
  definition: Pick<IntegrationDefinition, 'destination'> | undefined
): Record<string, unknown> {
  const scope: Record<string, unknown> = {}
  for (const key of definition?.destination?.scopeKeys ?? []) {
    if (typeof config[key] === 'string') scope[key] = syncHash(config[key])
  }
  // Destinations may be webhook URLs with credentials. Only their digest is public metadata.
  return { scope, target: syncHash(target) }
}

export function syncOperationKey(input: {
  installation: string
  kind: string
  sourceType: string
  sourceId: string
  destination: unknown
  revision?: string
  remoteId?: string
}): string {
  return `sync:${syncHash(input)}`
}

/** A link from another destination must never be inspected with current destination credentials. */
export function reviewDestination(
  link: { id: string; syncScope: string | null },
  integration: {
    id: string
    connectedAt: Date | string | null
    config: unknown
    integrationType: string
  },
  definition: Pick<IntegrationDefinition, 'destination'> | undefined
) {
  const config = (integration.config ?? {}) as Record<string, unknown>
  const destination = syncDestination({ channelId: config.channelId }, config, definition)
  return link.syncScope === `${installationIdentity(integration)}:${syncHash(destination)}`
    ? destination
    : { unverifiedLink: syncHash(link.id), previousScope: syncHash(link.syncScope) }
}
