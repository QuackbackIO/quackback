/**
 * Shared integration save logic.
 * Replaces the per-integration save.ts files with a single function.
 */
import { db, integrations, eq } from '@/lib/server/db'
import { encryptSecrets } from './encryption'
import { getIntegration } from './index'
import type { IntegrationId, PrincipalId } from '@quackback/ids'
import { createServicePrincipal } from '@/lib/server/domains/principals/principal.service'
import { toIsoString } from '@/lib/shared/utils'

export interface SaveIntegrationParams {
  principalId: PrincipalId
  accessToken: string
  refreshToken?: string
  expiresIn?: number
  config?: Record<string, unknown>
  /** Force create a new integration row (for multi-instance types like GitHub). */
  forceCreate?: boolean
  /** Specific integration ID to update (for reconnecting a specific connection). */
  integrationId?: IntegrationId
}

/**
 * Save or update an integration connection.
 * Encrypts secrets, computes token expiry, and upserts the integration row.
 */
export async function saveIntegration(
  integrationType: string,
  params: SaveIntegrationParams
): Promise<IntegrationId> {
  const {
    principalId,
    accessToken,
    refreshToken,
    expiresIn,
    config: oauthConfig,
    forceCreate,
    integrationId: targetIntegrationId,
  } = params

  const secrets: Record<string, unknown> = { accessToken }
  if (refreshToken) secrets.refreshToken = refreshToken

  const encryptedSecrets = encryptSecrets(secrets)
  const now = new Date()
  const tokenExpiresAt = expiresIn ? new Date(now.getTime() + expiresIn * 1000) : undefined

  const config = {
    ...oauthConfig,
    ...(tokenExpiresAt ? { tokenExpiresAt: toIsoString(tokenExpiresAt) } : {}),
  }

  // Check if integration already exists (for reconnect — keep existing service principal)
  // NOTE: unique constraint on integration_type was dropped in migration 0057 to allow
  // multiple integrations per type, so we use manual find-then-update/insert instead of
  // onConflictDoUpdate.
  let existing: { id: string; principalId: string | null } | undefined
  if (targetIntegrationId) {
    // Reconnect a specific integration by ID
    existing =
      (await db.query.integrations.findFirst({
        where: eq(integrations.id, targetIntegrationId),
        columns: { id: true, principalId: true },
      })) ?? undefined
  } else if (!forceCreate) {
    // Default: find first integration by type (legacy single-instance behavior)
    existing =
      (await db.query.integrations.findFirst({
        where: eq(integrations.integrationType, integrationType),
        columns: { id: true, principalId: true },
      })) ?? undefined
  }
  // When forceCreate=true and no targetIntegrationId, skip lookup → always INSERT

  // Create service principal if this is a new integration or missing one
  let integrationPrincipalId = (existing?.principalId as PrincipalId | null) ?? null
  if (!integrationPrincipalId) {
    const displayName = `${integrationType.charAt(0).toUpperCase()}${integrationType.slice(1)} Integration`
    const servicePrincipal = await createServicePrincipal({
      role: 'member',
      displayName,
      serviceMetadata: { kind: 'integration', integrationType },
    })
    integrationPrincipalId = servicePrincipal.id
  }

  let integrationId: IntegrationId

  if (existing) {
    await db
      .update(integrations)
      .set({
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
      })
      .where(eq(integrations.id, existing.id as IntegrationId))
    integrationId = existing.id as IntegrationId
  } else {
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
      .returning({ id: integrations.id })
    integrationId = row.id as IntegrationId
  }

  // Run integration-specific post-connect hook (e.g. provision feedback source)
  const definition = getIntegration(integrationType)
  if (definition?.onConnect) {
    await definition.onConnect(integrationId)
  }

  return integrationId
}
