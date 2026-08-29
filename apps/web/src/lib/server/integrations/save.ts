/**
 * Shared integration save logic.
 * Replaces the per-integration save.ts files with a single function.
 */
import { db, integrations, eq } from '@/lib/server/db'
import { encryptSecrets } from './encryption'
import { getIntegration } from './index'
import type { IntegrationId, PrincipalId } from '@quackback/ids'
import { createServicePrincipal } from '@/lib/server/domains/principals/principal.service'

/** Overlay OAuth-returned config onto the stored blob so reconnect cannot
 *  wipe channelId / webhook ids. Exported for tests. */
export function mergeIntegrationConfig(
  existing: Record<string, unknown> | null | undefined,
  oauthConfig: Record<string, unknown> | undefined,
  tokenExpiresAt?: Date
): Record<string, unknown> {
  return {
    ...(existing ?? {}),
    ...(oauthConfig ?? {}),
    ...(tokenExpiresAt ? { tokenExpiresAt: tokenExpiresAt.toISOString() } : {}),
  }
}

export interface SaveIntegrationParams {
  principalId: PrincipalId
  accessToken?: string
  refreshToken?: string
  /** Additional provider secrets, encrypted in the same integration blob. */
  secrets?: Record<string, unknown>
  expiresIn?: number
  config?: Record<string, unknown>
}

/**
 * Save or update an integration connection.
 * Encrypts secrets, computes token expiry, and upserts the integration row.
 */
export async function saveIntegration(
  integrationType: string,
  params: SaveIntegrationParams
): Promise<IntegrationId> {
  const { principalId, accessToken, refreshToken, expiresIn, config: oauthConfig } = params

  const secrets: Record<string, unknown> = { ...(params.secrets ?? {}) }
  if (accessToken) secrets.accessToken = accessToken
  if (refreshToken) secrets.refreshToken = refreshToken

  const encryptedSecrets = encryptSecrets(secrets)
  const now = new Date()
  const tokenExpiresAt = expiresIn ? new Date(now.getTime() + expiresIn * 1000) : undefined

  // Check if integration already exists (for reconnect — keep existing service
  // principal AND overlay OAuth config onto stored config so reconnect cannot
  // wipe channelId / webhook ids).
  const existing = await db.query.integrations.findFirst({
    where: eq(integrations.integrationType, integrationType),
    columns: { principalId: true, config: true },
  })

  const config = mergeIntegrationConfig(
    existing?.config as Record<string, unknown> | undefined,
    oauthConfig,
    tokenExpiresAt
  )

  // Create service principal if this is a new integration or missing one
  let integrationPrincipalId = existing?.principalId ?? null
  if (!integrationPrincipalId) {
    const displayName = `${integrationType.charAt(0).toUpperCase()}${integrationType.slice(1)} Integration`
    const servicePrincipal = await createServicePrincipal({
      role: 'member',
      displayName,
      serviceMetadata: { kind: 'integration', integrationType },
    })
    integrationPrincipalId = servicePrincipal.id
  }

  const [row] = await db
    .insert(integrations)
    .values({
      integrationType,
      status: 'active',
      secrets: encryptedSecrets,
      connectedByPrincipalId: principalId,
      principalId: integrationPrincipalId,
      connectedAt: now,
      config,
    })
    .onConflictDoUpdate({
      target: [integrations.integrationType],
      set: {
        status: 'active',
        secrets: encryptedSecrets,
        connectedByPrincipalId: principalId,
        principalId: integrationPrincipalId,
        connectedAt: now,
        config,
        lastError: null,
        lastErrorAt: null,
        errorCount: 0,
        updatedAt: now,
      },
    })
    .returning({ id: integrations.id })

  const integrationId = row.id as IntegrationId

  // Run integration-specific post-connect hook (e.g. provision feedback source)
  const definition = getIntegration(integrationType)
  if (definition?.onConnect) {
    await definition.onConnect(integrationId)
  }

  return integrationId
}
