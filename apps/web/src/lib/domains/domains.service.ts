/**
 * Domain Service
 *
 * Business logic for managing custom domains.
 * Operates on the CATALOG database (not tenant database).
 * Integrates with Cloudflare API for custom hostname management.
 */

import { eq, and } from 'drizzle-orm'
import * as crypto from 'node:crypto'
import type {
  Domain,
  AddDomainInput,
  DomainStatus,
  DomainType,
  SslStatus,
  OwnershipStatus,
  VerificationRecords,
} from './domains.types'
import { NotFoundError, ValidationError, ConflictError, ForbiddenError } from '@/lib/shared/errors'
import { workspaceDomain, getCatalogDb } from '@/lib/catalog'

// ============================================
// Cloudflare Integration
// ============================================

import {
  createCustomHostname as cfCreateHostname,
  getCustomHostname as cfGetHostname,
  deleteCustomHostname as cfDeleteHostname,
  isCloudflareConfigured,
  type CFCustomHostname,
} from '@/lib/cloudflare'

/**
 * Extract verification records from Cloudflare hostname response
 */
function extractVerificationRecords(hostname: CFCustomHostname): VerificationRecords {
  const records: VerificationRecords = {}

  // Get CNAME target from environment
  records.cnameTarget = process.env.CLOUD_APP_DOMAIN || 'proxy.quackback.cloud'

  // Extract TXT verification if available
  if (hostname.ownership_verification) {
    records.txtName = hostname.ownership_verification.name
    records.txtValue = hostname.ownership_verification.value
  }

  // Extract HTTP verification if available
  if (hostname.ownership_verification_http) {
    records.httpUrl = hostname.ownership_verification_http.http_url
    records.httpBody = hostname.ownership_verification_http.http_body
  }

  // Extract SSL validation records if available
  const validationRecord = hostname.ssl?.validation_records?.[0]
  if (validationRecord) {
    if (validationRecord.txt_name && validationRecord.txt_value) {
      records.txtName = validationRecord.txt_name
      records.txtValue = validationRecord.txt_value
    }
    if (validationRecord.http_url && validationRecord.http_body) {
      records.httpUrl = validationRecord.http_url
      records.httpBody = validationRecord.http_body
    }
  }

  return records
}

// ============================================
// Domain Validation
// ============================================

/** Reserved domains that cannot be used as custom domains */
const RESERVED_DOMAINS = [
  'localhost',
  'quackback.io',
  'quackback.com',
  'quackback.dev',
  'quackback.app',
]

/** Validate domain format */
function isValidDomainFormat(domain: string): boolean {
  // Basic domain validation regex
  const domainRegex = /^(?!-)[a-zA-Z0-9-]{1,63}(?<!-)(\.[a-zA-Z]{2,})+$/
  return domainRegex.test(domain)
}

/** Check if domain is reserved */
function isReservedDomain(domain: string): boolean {
  const lowerDomain = domain.toLowerCase()
  return RESERVED_DOMAINS.some(
    (reserved) => lowerDomain === reserved || lowerDomain.endsWith(`.${reserved}`)
  )
}

// ============================================
// Helper to map DB record to Domain type
// ============================================

function mapToDomain(record: typeof workspaceDomain.$inferSelect): Domain {
  return {
    id: record.id,
    workspaceId: record.workspaceId,
    domain: record.domain,
    domainType: record.domainType as DomainType,
    isPrimary: record.isPrimary,
    verified: record.verified,
    verificationToken: record.verificationToken,
    cloudflareHostnameId: record.cloudflareHostnameId,
    sslStatus: record.sslStatus as SslStatus | null,
    ownershipStatus: record.ownershipStatus as OwnershipStatus | null,
    createdAt: record.createdAt,
  }
}

// ============================================
// Service Functions
// ============================================

/**
 * List all domains for a workspace
 */
export async function listDomains(workspaceId: string): Promise<Domain[]> {
  const db = getCatalogDb()

  const records = await db.query.workspaceDomain.findMany({
    where: eq(workspaceDomain.workspaceId, workspaceId),
    orderBy: (domain, { asc }) => [asc(domain.createdAt)],
  })

  return records.map(mapToDomain)
}

/**
 * Get a domain by ID
 */
export async function getDomainById(workspaceId: string, domainId: string): Promise<Domain | null> {
  const db = getCatalogDb()

  const record = await db.query.workspaceDomain.findFirst({
    where: and(eq(workspaceDomain.id, domainId), eq(workspaceDomain.workspaceId, workspaceId)),
  })

  return record ? mapToDomain(record) : null
}

/**
 * Add a custom domain to a workspace
 */
export async function addCustomDomain(workspaceId: string, input: AddDomainInput): Promise<Domain> {
  const db = getCatalogDb()
  const domain = input.domain.toLowerCase().trim()

  // Validate domain format
  if (!isValidDomainFormat(domain)) {
    throw new ValidationError('INVALID_DOMAIN_FORMAT', 'Invalid domain format')
  }

  // Check for reserved domains
  if (isReservedDomain(domain)) {
    throw new ValidationError('RESERVED_DOMAIN', 'This domain is reserved and cannot be used')
  }

  // Check if domain already exists
  const existingDomain = await db.query.workspaceDomain.findFirst({
    where: eq(workspaceDomain.domain, domain),
  })

  if (existingDomain) {
    throw new ConflictError('DOMAIN_ALREADY_EXISTS', 'This domain is already registered')
  }

  // Generate verification token and domain ID
  const verificationToken = crypto.randomUUID()
  const domainId = crypto.randomUUID()

  // Create initial record with pending status
  let cloudflareHostnameId: string | null = null
  let sslStatus: SslStatus = 'initializing'
  let ownershipStatus: OwnershipStatus = 'pending'

  // Try to create Cloudflare hostname if configured
  if (isCloudflareConfigured()) {
    try {
      const result = await cfCreateHostname(domain, {
        workspaceId,
        domainId,
      })
      cloudflareHostnameId = result.id
      sslStatus = result.ssl.status as SslStatus
      ownershipStatus = result.status as OwnershipStatus
    } catch (error) {
      console.warn('[domains] Failed to create Cloudflare hostname:', error)
      // Continue without Cloudflare - domain will need manual verification
    }
  }

  // Insert domain record
  const [inserted] = await db
    .insert(workspaceDomain)
    .values({
      id: domainId,
      workspaceId,
      domain,
      domainType: 'custom',
      isPrimary: false,
      verified: false,
      verificationToken,
      cloudflareHostnameId,
      sslStatus,
      ownershipStatus,
    })
    .returning()

  return mapToDomain(inserted)
}

/**
 * Delete a domain from a workspace
 */
export async function deleteDomain(workspaceId: string, domainId: string): Promise<void> {
  const db = getCatalogDb()

  // Get the domain
  const domain = await getDomainById(workspaceId, domainId)
  if (!domain) {
    throw new NotFoundError('DOMAIN_NOT_FOUND', 'Domain not found')
  }

  // Prevent deleting primary subdomain
  if (domain.domainType === 'subdomain' && domain.isPrimary) {
    throw new ForbiddenError(
      'CANNOT_DELETE_PRIMARY_SUBDOMAIN',
      'Cannot delete the primary subdomain'
    )
  }

  // Delete from Cloudflare if applicable
  if (domain.cloudflareHostnameId && isCloudflareConfigured()) {
    try {
      await cfDeleteHostname(domain.cloudflareHostnameId)
    } catch (error) {
      console.warn('[domains] Failed to delete Cloudflare hostname:', error)
      // Continue with deletion even if Cloudflare fails
    }
  }

  // Delete from database
  await db
    .delete(workspaceDomain)
    .where(and(eq(workspaceDomain.id, domainId), eq(workspaceDomain.workspaceId, workspaceId)))
}

/**
 * Set a domain as the primary domain for a workspace
 */
export async function setDomainPrimary(workspaceId: string, domainId: string): Promise<Domain> {
  const db = getCatalogDb()

  // Get the domain
  const domain = await getDomainById(workspaceId, domainId)
  if (!domain) {
    throw new NotFoundError('DOMAIN_NOT_FOUND', 'Domain not found')
  }

  // Domain must be verified to be set as primary
  if (!domain.verified) {
    throw new ValidationError(
      'DOMAIN_NOT_VERIFIED',
      'Domain must be verified before setting as primary'
    )
  }

  // Unset current primary domain(s)
  await db
    .update(workspaceDomain)
    .set({ isPrimary: false })
    .where(and(eq(workspaceDomain.workspaceId, workspaceId), eq(workspaceDomain.isPrimary, true)))

  // Set new primary domain
  const [updated] = await db
    .update(workspaceDomain)
    .set({ isPrimary: true })
    .where(and(eq(workspaceDomain.id, domainId), eq(workspaceDomain.workspaceId, workspaceId)))
    .returning()

  return mapToDomain(updated)
}

/**
 * Refresh domain verification status from Cloudflare
 */
export async function refreshDomainVerification(
  workspaceId: string,
  domainId: string
): Promise<Domain> {
  const db = getCatalogDb()

  // Get the domain
  const domain = await getDomainById(workspaceId, domainId)
  if (!domain) {
    throw new NotFoundError('DOMAIN_NOT_FOUND', 'Domain not found')
  }

  // If no Cloudflare hostname, nothing to refresh
  if (!domain.cloudflareHostnameId) {
    return domain
  }

  // Fetch status from Cloudflare
  if (isCloudflareConfigured()) {
    try {
      const result = await cfGetHostname(domain.cloudflareHostnameId)
      if (result) {
        // Update database with new status
        const verified = result.ssl.status === 'active'
        const [updated] = await db
          .update(workspaceDomain)
          .set({
            sslStatus: result.ssl.status,
            ownershipStatus: result.status,
            verified,
          })
          .where(
            and(eq(workspaceDomain.id, domainId), eq(workspaceDomain.workspaceId, workspaceId))
          )
          .returning()

        return mapToDomain(updated)
      }
    } catch (error) {
      console.warn('[domains] Failed to refresh Cloudflare status:', error)
      // Return current domain state if Cloudflare fails
    }
  }

  return domain
}

/**
 * Get domain status including verification records
 */
export async function getDomainStatus(
  workspaceId: string,
  domainId: string
): Promise<DomainStatus> {
  const domain = await getDomainById(workspaceId, domainId)
  if (!domain) {
    throw new NotFoundError('DOMAIN_NOT_FOUND', 'Domain not found')
  }

  const status: DomainStatus = {
    sslStatus: domain.sslStatus,
    ownershipStatus: domain.ownershipStatus,
  }

  // If Cloudflare hostname exists, get verification records
  if (domain.cloudflareHostnameId && isCloudflareConfigured()) {
    try {
      const result = await cfGetHostname(domain.cloudflareHostnameId)
      if (result) {
        status.verificationRecords = extractVerificationRecords(result)
        status.sslStatus = result.ssl.status as SslStatus | null
        status.ownershipStatus = result.status as OwnershipStatus | null
      }
    } catch (error) {
      console.warn('[domains] Failed to get Cloudflare verification records:', error)
    }
  } else {
    // Provide fallback verification info for non-Cloudflare domains
    const fallbackOrigin = process.env.CLOUD_APP_DOMAIN || 'proxy.quackback.cloud'
    status.verificationRecords = {
      cnameTarget: fallbackOrigin,
    }
  }

  return status
}

/**
 * Update domain status from Cloudflare webhook
 * Called by the webhook handler when Cloudflare sends status updates
 */
export async function updateDomainFromWebhook(
  cloudflareHostnameId: string,
  sslStatus: string,
  ownershipStatus: string
): Promise<void> {
  const db = getCatalogDb()

  // Find domain by Cloudflare hostname ID
  const domain = await db.query.workspaceDomain.findFirst({
    where: eq(workspaceDomain.cloudflareHostnameId, cloudflareHostnameId),
  })

  if (!domain) {
    console.warn(`[domains] Webhook for unknown hostname: ${cloudflareHostnameId}`)
    return
  }

  // Update status
  const verified = sslStatus === 'active'
  await db
    .update(workspaceDomain)
    .set({
      sslStatus,
      ownershipStatus,
      verified,
    })
    .where(eq(workspaceDomain.cloudflareHostnameId, cloudflareHostnameId))

  console.log(
    `[domains] Updated domain ${domain.domain}: ssl=${sslStatus}, ownership=${ownershipStatus}`
  )
}
