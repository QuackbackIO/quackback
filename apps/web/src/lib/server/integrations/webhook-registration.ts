/**
 * Shared webhook registration utilities.
 *
 * Generates webhook secrets and callback URLs for inbound webhook registration.
 */

import { randomBytes } from 'crypto'
import { config } from '@/lib/server/config'
import { db, integrations, eq } from '@/lib/server/db'
import type { IntegrationId } from '@quackback/ids'
import { getPublicOriginFromHeaders } from './oauth'

interface BuildWebhookCallbackUrlOptions {
  requestHeaders?: Headers
}

const LOCAL_HOSTNAMES = new Set(['localhost', 'host.docker.internal', '0.0.0.0', '::1'])

function isLocalOrPrivateHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, '')

  if (
    LOCAL_HOSTNAMES.has(normalized) ||
    normalized.endsWith('.localhost') ||
    normalized.endsWith('.local')
  ) {
    return true
  }

  if (normalized.includes(':')) {
    return (
      normalized === '::1' ||
      normalized.startsWith('fc') ||
      normalized.startsWith('fd') ||
      normalized.startsWith('fe80:')
    )
  }

  const match = normalized.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (!match) return false

  const octets = match.slice(1).map(Number)
  if (octets.some((n) => n > 255)) return false

  const [a, b] = octets
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127)
  )
}

function isLocalOrPrivateUrl(value: string): boolean {
  try {
    return isLocalOrPrivateHostname(new URL(value).hostname)
  } catch {
    return true
  }
}

function getRequestOrigin(headers?: Headers): string | undefined {
  if (!headers) return undefined
  try {
    return getPublicOriginFromHeaders(headers) || undefined
  } catch {
    return undefined
  }
}

function isUsableExternalOrigin(origin: string): boolean {
  try {
    const url = new URL(origin)
    return url.protocol === 'https:' && !isLocalOrPrivateHostname(url.hostname)
  } catch {
    return false
  }
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '')
}

/**
 * Generate a random webhook secret (32 bytes hex = 64 chars).
 */
export function generateWebhookSecret(): string {
  return randomBytes(32).toString('hex')
}

/**
 * Resolve the externally reachable base URL used for provider webhook callbacks.
 */
export function resolveWebhookBaseUrl(requestHeaders?: Headers): string {
  const configuredBaseUrl = trimTrailingSlash(config.baseUrl)

  if (!isLocalOrPrivateUrl(configuredBaseUrl)) {
    return configuredBaseUrl
  }

  const requestOrigin = getRequestOrigin(requestHeaders)
  if (requestOrigin && isUsableExternalOrigin(requestOrigin)) {
    return requestOrigin
  }

  return configuredBaseUrl
}

/**
 * Build the callback URL for an integration type.
 */
export function buildWebhookCallbackUrl(
  integrationType: string,
  options: BuildWebhookCallbackUrlOptions = {}
): string {
  return `${resolveWebhookBaseUrl(options.requestHeaders)}/api/integrations/${integrationType}/webhook`
}

/**
 * Store webhook registration details in the integration config.
 */
export async function storeWebhookConfig(
  integrationId: IntegrationId,
  webhookSecret: string,
  externalWebhookId?: string,
  extraConfig?: Record<string, unknown>
): Promise<void> {
  const integration = await db.query.integrations.findFirst({
    where: eq(integrations.id, integrationId),
    columns: { config: true },
  })
  if (!integration) return

  const existingConfig = (integration.config ?? {}) as Record<string, unknown>
  await db
    .update(integrations)
    .set({
      config: {
        ...existingConfig,
        webhookSecret,
        statusSyncEnabled: true,
        ...(extraConfig ?? {}),
        ...(externalWebhookId ? { externalWebhookId } : {}),
      },
      updatedAt: new Date(),
    })
    .where(eq(integrations.id, integrationId))
}

/**
 * Remove webhook config when status sync is disabled.
 */
export async function clearWebhookConfig(integrationId: IntegrationId): Promise<void> {
  const integration = await db.query.integrations.findFirst({
    where: eq(integrations.id, integrationId),
    columns: { config: true },
  })
  if (!integration) return

  const existingConfig = (integration.config ?? {}) as Record<string, unknown>
  const {
    webhookSecret: _,
    externalWebhookId: __,
    statusSyncEnabled: ___,
    ...rest
  } = existingConfig
  await db
    .update(integrations)
    .set({ config: rest, updatedAt: new Date() })
    .where(eq(integrations.id, integrationId))
}
