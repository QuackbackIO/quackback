/**
 * Domain Server Functions
 *
 * Server functions for custom domain management.
 * Cloud-only feature - requires CUSTOM_DOMAIN feature access.
 */

import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { requireAuth } from './auth-helpers'
import { isCloud, Feature } from '@/lib/features'
import { checkFeatureAccess } from '@/lib/features/server'
import { tenantStorage } from '@/lib/tenant'
import {
  listDomains,
  addCustomDomain,
  deleteDomain,
  setDomainPrimary,
  refreshDomainVerification,
  getDomainStatus,
  getDomainById,
} from '@/lib/domains/domains.service'
import type { Domain, DomainStatus } from '@/lib/domains'

// ============================================
// Validation Schemas
// ============================================

const domainIdSchema = z.object({
  domainId: z.string().uuid(),
})

const addDomainSchema = z.object({
  domain: z
    .string()
    .min(1, 'Domain is required')
    .max(253, 'Domain too long')
    .regex(/^(?!-)[a-zA-Z0-9-]{1,63}(?<!-)(\.[a-zA-Z]{2,})+$/, 'Invalid domain format'),
})

// ============================================
// Helper Functions
// ============================================

/**
 * Get workspace ID from tenant context
 * In cloud mode, this comes from the AsyncLocalStorage tenant context.
 * Throws if not in cloud mode or no tenant context available.
 */
function getWorkspaceId(): string {
  if (!isCloud()) {
    throw new Error('Custom domains are only available in cloud mode')
  }

  const tenant = tenantStorage.getStore()
  if (!tenant?.workspaceId) {
    throw new Error('No tenant context available')
  }

  return tenant.workspaceId
}

/**
 * Ensure CUSTOM_DOMAIN feature is available
 */
async function ensureCustomDomainFeature(): Promise<void> {
  const result = await checkFeatureAccess(Feature.CUSTOM_DOMAIN)
  if (!result.allowed) {
    throw new Error(result.error || 'Custom domains feature not available')
  }
}

// ============================================
// Read Operations
// ============================================

/**
 * Fetch all domains for the current workspace
 */
export const fetchDomainsFn = createServerFn({ method: 'GET' }).handler(
  async (): Promise<Domain[]> => {
    // Only available in cloud mode
    if (!isCloud()) {
      return []
    }

    // Require authentication (any team member can view)
    await requireAuth({ roles: ['admin', 'member'] })

    const workspaceId = getWorkspaceId()
    return listDomains(workspaceId)
  }
)

/**
 * Get status details for a specific domain
 */
export const getDomainStatusFn = createServerFn({ method: 'GET' })
  .inputValidator(domainIdSchema)
  .handler(async ({ data }): Promise<DomainStatus> => {
    // Require admin role
    await requireAuth({ roles: ['admin'] })

    const workspaceId = getWorkspaceId()
    return getDomainStatus(workspaceId, data.domainId)
  })

// ============================================
// Write Operations
// ============================================

/**
 * Add a custom domain to the workspace
 */
export const addDomainFn = createServerFn({ method: 'POST' })
  .inputValidator(addDomainSchema)
  .handler(async ({ data }): Promise<Domain> => {
    // Require admin role
    await requireAuth({ roles: ['admin'] })

    // Check feature access
    await ensureCustomDomainFeature()

    const workspaceId = getWorkspaceId()

    // Normalize domain
    const normalizedDomain = data.domain.toLowerCase().trim()

    return addCustomDomain(workspaceId, { domain: normalizedDomain })
  })

/**
 * Delete a domain from the workspace
 */
export const deleteDomainFn = createServerFn({ method: 'POST' })
  .inputValidator(domainIdSchema)
  .handler(async ({ data }): Promise<{ success: boolean }> => {
    // Require admin role
    await requireAuth({ roles: ['admin'] })

    const workspaceId = getWorkspaceId()

    // Get domain to check type
    const domain = await getDomainById(workspaceId, data.domainId)
    if (!domain) {
      throw new Error('Domain not found')
    }

    // Prevent deleting primary subdomain
    if (domain.domainType === 'subdomain' && domain.isPrimary) {
      throw new Error('Cannot delete the primary subdomain')
    }

    await deleteDomain(workspaceId, data.domainId)
    return { success: true }
  })

/**
 * Set a domain as the primary domain
 */
export const setDomainPrimaryFn = createServerFn({ method: 'POST' })
  .inputValidator(domainIdSchema)
  .handler(async ({ data }): Promise<Domain> => {
    // Require admin role
    await requireAuth({ roles: ['admin'] })

    const workspaceId = getWorkspaceId()

    // Get domain to verify it's verified
    const domain = await getDomainById(workspaceId, data.domainId)
    if (!domain) {
      throw new Error('Domain not found')
    }

    if (!domain.verified) {
      throw new Error('Domain must be verified before setting as primary')
    }

    return setDomainPrimary(workspaceId, data.domainId)
  })

/**
 * Refresh domain verification status from Cloudflare
 */
export const refreshDomainVerificationFn = createServerFn({ method: 'POST' })
  .inputValidator(domainIdSchema)
  .handler(async ({ data }): Promise<Domain> => {
    // Require admin role
    await requireAuth({ roles: ['admin'] })

    const workspaceId = getWorkspaceId()
    return refreshDomainVerification(workspaceId, data.domainId)
  })
