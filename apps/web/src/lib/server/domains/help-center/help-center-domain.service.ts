/**
 * Custom domain verification service for the help center.
 *
 * Handles CNAME-based domain verification so customers can serve
 * their help center on a custom domain (e.g. docs.acme.com).
 */

import dns from 'node:dns/promises'
import { generateId, type WorkspaceId } from '@quackback/ids'
import { db, eq, desc, kbDomainVerifications } from '@/lib/server/db'

// ============================================================================
// CNAME target
// ============================================================================

/**
 * Returns the CNAME target customers should point their custom domain to.
 * Configurable via HELP_CENTER_CNAME_TARGET env var; defaults to help-proxy.quackback.app.
 */
export function generateCnameTarget(): string {
  return process.env.HELP_CENTER_CNAME_TARGET ?? 'help-proxy.quackback.app'
}

// ============================================================================
// Create verification record
// ============================================================================

/**
 * Creates a new domain verification record in the database.
 * The domain is lowercased before storage.
 */
export async function createDomainVerification(settingsId: WorkspaceId, domain: string) {
  const id = generateId('helpcenter_domain')
  const cnameTarget = generateCnameTarget()

  await db.insert(kbDomainVerifications).values({
    id,
    settingsId,
    domain: domain.toLowerCase(),
    status: 'pending',
    cnameTarget,
  })

  return { id, domain: domain.toLowerCase(), cnameTarget, status: 'pending' as const }
}

// ============================================================================
// DNS verification
// ============================================================================

/**
 * Checks whether the given domain has a CNAME record pointing to the expected target.
 * Comparison is case-insensitive.
 */
export async function verifyCname(domain: string, expectedTarget: string): Promise<boolean> {
  try {
    const records = await dns.resolveCname(domain)
    return records.some((record) => record.toLowerCase() === expectedTarget.toLowerCase())
  } catch {
    return false
  }
}

// ============================================================================
// Check all pending verifications
// ============================================================================

/**
 * Iterates over all pending domain verifications and:
 * - Marks as 'verified' if the CNAME now resolves correctly
 * - Marks as 'failed' if pending for more than 72 hours without verification
 * - Otherwise just updates lastCheckedAt
 */
export async function checkPendingVerifications(): Promise<void> {
  const pending = await db
    .select()
    .from(kbDomainVerifications)
    .where(eq(kbDomainVerifications.status, 'pending'))

  for (const record of pending) {
    const verified = await verifyCname(record.domain, record.cnameTarget)
    const now = new Date()

    if (verified) {
      await db
        .update(kbDomainVerifications)
        .set({ status: 'verified', verifiedAt: now, lastCheckedAt: now })
        .where(eq(kbDomainVerifications.id, record.id))

      // Update settings to reflect verified domain
      const { updateHelpCenterConfig } =
        await import('@/lib/server/domains/settings/settings.service')
      await updateHelpCenterConfig({ domainVerified: true })
    } else {
      const hoursElapsed = (now.getTime() - record.createdAt.getTime()) / (1000 * 60 * 60)

      if (hoursElapsed > 72) {
        await db
          .update(kbDomainVerifications)
          .set({ status: 'failed', lastCheckedAt: now })
          .where(eq(kbDomainVerifications.id, record.id))
      } else {
        await db
          .update(kbDomainVerifications)
          .set({ lastCheckedAt: now })
          .where(eq(kbDomainVerifications.id, record.id))
      }
    }
  }
}

// ============================================================================
// Query
// ============================================================================

/**
 * Gets the latest domain verification record for a given domain.
 * Returns null if no record exists.
 */
export async function getDomainVerificationForDomain(domain: string) {
  const records = await db
    .select()
    .from(kbDomainVerifications)
    .where(eq(kbDomainVerifications.domain, domain.toLowerCase()))
    .orderBy(desc(kbDomainVerifications.createdAt))
    .limit(1)

  return records[0] ?? null
}
