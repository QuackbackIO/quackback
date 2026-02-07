/**
 * Platform credential service.
 *
 * Manages OAuth app credentials (client ID, client secret, bot tokens) that
 * enable integrations at the platform level. These are separate from per-instance
 * tokens stored in the integrations table.
 */

import { generateId, type MemberId } from '@quackback/ids'
import { db, integrationPlatformCredentials, eq } from '@/lib/server/db'
import {
  encryptPlatformCredentials,
  decryptPlatformCredentials,
} from '@/lib/server/integrations/encryption'

interface SavePlatformCredentialsInput {
  integrationType: string
  credentials: Record<string, string>
  memberId: MemberId
}

/**
 * Save (upsert) platform credentials for an integration type.
 * Encrypts all credential values before storing.
 */
export async function savePlatformCredentials({
  integrationType,
  credentials,
  memberId,
}: SavePlatformCredentialsInput): Promise<void> {
  const encrypted = encryptPlatformCredentials(credentials)
  const now = new Date()

  await db
    .insert(integrationPlatformCredentials)
    .values({
      id: generateId('platform_cred'),
      integrationType,
      secrets: encrypted,
      configuredByMemberId: memberId,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [integrationPlatformCredentials.integrationType],
      set: {
        secrets: encrypted,
        configuredByMemberId: memberId,
        updatedAt: now,
      },
    })
}

/**
 * Get decrypted platform credentials for an integration type.
 * Returns null if not configured.
 */
export async function getPlatformCredentials(
  integrationType: string
): Promise<Record<string, string> | null> {
  const row = await db.query.integrationPlatformCredentials.findFirst({
    where: eq(integrationPlatformCredentials.integrationType, integrationType),
    columns: { secrets: true },
  })

  if (!row) return null
  try {
    return decryptPlatformCredentials<Record<string, string>>(row.secrets)
  } catch (error) {
    console.error(
      `[PlatformCredentials] Failed to decrypt credentials for ${integrationType}:`,
      error
    )
    return null
  }
}

/**
 * Check if platform credentials exist for an integration type.
 * Lightweight check — no decryption.
 */
export async function hasPlatformCredentials(integrationType: string): Promise<boolean> {
  const row = await db.query.integrationPlatformCredentials.findFirst({
    where: eq(integrationPlatformCredentials.integrationType, integrationType),
    columns: { id: true },
  })
  return !!row
}

/**
 * Get the set of integration types that have platform credentials configured.
 */
export async function getConfiguredIntegrationTypes(): Promise<Set<string>> {
  const rows = await db.query.integrationPlatformCredentials.findMany({
    columns: { integrationType: true },
  })
  return new Set(rows.map((r) => r.integrationType))
}

/**
 * Delete platform credentials for an integration type.
 */
export async function deletePlatformCredentials(integrationType: string): Promise<void> {
  await db
    .delete(integrationPlatformCredentials)
    .where(eq(integrationPlatformCredentials.integrationType, integrationType))
}
