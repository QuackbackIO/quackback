/**
 * Tenant access validation utilities
 *
 * This module handles tenant (organization) access validation for subdomain-based routing.
 * Use these functions in server components within the (tenant) route group.
 */

import { headers } from 'next/headers'
import { cache } from 'react'
import { redirect } from 'next/navigation'
import { db, organization, member, eq, and } from '@quackback/db'
import { getSession } from './auth/server'
import { buildMainDomainUrl } from './routing'

// =============================================================================
// Org Slug from Headers (set by proxy.ts)
// =============================================================================

/**
 * Get the org slug from the x-org-slug header set by proxy.ts
 */
export const getOrgSlug = cache(async (): Promise<string | null> => {
  const headersList = await headers()
  return headersList.get('x-org-slug')
})

// =============================================================================
// Organization Lookup
// =============================================================================

/**
 * Get the current organization from the subdomain
 * Returns null if no subdomain or org not found
 */
export const getCurrentOrganization = cache(async () => {
  const slug = await getOrgSlug()
  if (!slug) return null

  const org = await db.query.organization.findFirst({
    where: eq(organization.slug, slug),
  })

  return org ?? null
})

// =============================================================================
// Access Validation
// =============================================================================

type ValidationResult =
  | { valid: false; reason: 'not_authenticated' | 'org_not_found' | 'not_a_member' }
  | {
      valid: true
      organization: NonNullable<Awaited<ReturnType<typeof getCurrentOrganization>>>
      member: NonNullable<Awaited<ReturnType<typeof db.query.member.findFirst>>>
      user: NonNullable<Awaited<ReturnType<typeof getSession>>>['user']
    }

/**
 * Validate that the current user has access to the current organization
 * Returns the organization and member info if valid
 */
export const validateTenantAccess = cache(async (): Promise<ValidationResult> => {
  const [session, org] = await Promise.all([getSession(), getCurrentOrganization()])

  if (!session?.user) {
    return { valid: false, reason: 'not_authenticated' }
  }

  if (!org) {
    return { valid: false, reason: 'org_not_found' }
  }

  const memberRecord = await db.query.member.findFirst({
    where: and(eq(member.organizationId, org.id), eq(member.userId, session.user.id)),
  })

  if (!memberRecord) {
    return { valid: false, reason: 'not_a_member' }
  }

  return {
    valid: true,
    organization: org,
    member: memberRecord,
    user: session.user,
  }
})

// =============================================================================
// Access Guards (redirect on failure)
// =============================================================================

/**
 * Require valid tenant access - redirects if invalid
 */
export async function requireTenant() {
  const result = await validateTenantAccess()

  if (!result.valid) {
    const redirectMap = {
      not_authenticated: '/login',
      org_not_found: '/select-org?error=org_not_found',
      not_a_member: '/select-org?error=not_a_member',
    } as const
    redirect(buildMainDomainUrl(redirectMap[result.reason]))
  }

  return result
}

/**
 * Require specific role within the tenant
 */
export async function requireTenantRole(allowedRoles: string[]) {
  const result = await requireTenant()

  if (!allowedRoles.includes(result.member.role)) {
    throw new Error('Forbidden: insufficient permissions')
  }

  return result
}
