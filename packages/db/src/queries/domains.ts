import { eq } from 'drizzle-orm'
import { adminDb } from '../tenant-context'
import { workspaceDomain } from '../schema/auth'
import type { DomainId } from '@quackback/ids'

// ============================================================================
// Types
// ============================================================================

export type CFSSLStatus =
  | 'initializing'
  | 'pending_validation'
  | 'pending_issuance'
  | 'pending_deployment'
  | 'active'
  | 'pending_expiration'
  | 'expired'
  | 'deleted'
  | 'unknown' // Used when webhook doesn't include SSL info

export type CFOwnershipStatus = 'pending' | 'active' | 'moved' | 'blocked' | 'deleted'

// ============================================================================
// Queries (Admin - bypasses RLS for webhook/background updates)
// ============================================================================

/**
 * Update domain's Cloudflare status from webhook or polling.
 * Uses adminDb since webhooks don't have tenant context.
 * @returns true if a domain was found and updated, false otherwise
 */
export async function updateDomainCloudflareStatus(params: {
  cloudflareHostnameId: string
  sslStatus: CFSSLStatus
  ownershipStatus: CFOwnershipStatus
}): Promise<boolean> {
  // When SSL becomes active, also mark domain as verified
  const verified = params.sslStatus === 'active'

  const result = await adminDb
    .update(workspaceDomain)
    .set({
      sslStatus: params.sslStatus,
      ownershipStatus: params.ownershipStatus,
      verified,
      verificationToken: verified ? null : undefined,
    })
    .where(eq(workspaceDomain.cloudflareHostnameId, params.cloudflareHostnameId))
    .returning({ id: workspaceDomain.id })

  // Check if any rows were updated
  return result.length > 0
}

/**
 * Get domain by Cloudflare hostname ID.
 * Used for webhook processing.
 */
export async function getDomainByCloudflareId(cloudflareHostnameId: string) {
  return adminDb.query.workspaceDomain.findFirst({
    where: eq(workspaceDomain.cloudflareHostnameId, cloudflareHostnameId),
  })
}

/**
 * Set Cloudflare hostname ID after registration.
 */
export async function setDomainCloudflareHostnameId(
  domainId: DomainId,
  cloudflareHostnameId: string,
  sslStatus: CFSSLStatus
) {
  await adminDb
    .update(workspaceDomain)
    .set({
      cloudflareHostnameId,
      sslStatus,
      ownershipStatus: 'pending',
      // Clear verification token since CF handles verification
      verificationToken: null,
    })
    .where(eq(workspaceDomain.id, domainId))
}
