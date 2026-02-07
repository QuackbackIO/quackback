/**
 * Shared webhook registration utilities.
 *
 * Generates webhook secrets and callback URLs for inbound webhook registration.
 */

import { randomBytes } from 'crypto'
import { config } from '@/lib/server/config'
import { db, integrations, eq } from '@/lib/server/db'
import type { IntegrationId } from '@quackback/ids'

/**
 * Generate a random webhook secret (32 bytes hex = 64 chars).
 */
export function generateWebhookSecret(): string {
  return randomBytes(32).toString('hex')
}

/**
 * Build the callback URL for an integration type.
 */
export function buildWebhookCallbackUrl(integrationType: string): string {
  return `${config.baseUrl}/api/integrations/${integrationType}/webhook`
}

/**
 * Store webhook registration details in the integration config.
 */
export async function storeWebhookConfig(
  integrationId: IntegrationId,
  webhookSecret: string,
  externalWebhookId?: string
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
