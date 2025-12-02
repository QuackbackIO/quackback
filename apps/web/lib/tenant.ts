/**
 * Tenant access validation utilities
 *
 * This module handles tenant (organization) access validation for subdomain-based routing.
 * Use these functions in server components within the (tenant) route group.
 *
 * For database queries that need RLS protection, use the withAuthenticatedTenant wrapper
 * which combines auth validation with PostgreSQL session variable setup.
 */

import { headers } from 'next/headers'
import { cache } from 'react'
import { redirect } from 'next/navigation'
import { db, organization, member, eq, and, withTenantContext, type Database } from '@quackback/db'
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

// =============================================================================
// RLS-Enabled Database Access
// =============================================================================

/**
 * Context provided to RLS-enabled database callbacks
 */
export interface AuthenticatedTenantContext {
  organization: NonNullable<Awaited<ReturnType<typeof getCurrentOrganization>>>
  member: NonNullable<Awaited<ReturnType<typeof db.query.member.findFirst>>>
  user: NonNullable<Awaited<ReturnType<typeof getSession>>>['user']
  db: Database
}

/**
 * Execute database operations with RLS tenant context.
 *
 * This wrapper:
 * 1. Validates user authentication and organization access
 * 2. Sets PostgreSQL session variable `app.organization_id`
 * 3. Switches to the `app_user` role for RLS policy enforcement
 * 4. Executes your callback within a transaction
 *
 * All RLS policies will automatically filter by the organization.
 * You no longer need to manually add `organization_id` filters to queries.
 *
 * @example
 * const posts = await withAuthenticatedTenant(async ({ db, member }) => {
 *   // RLS automatically filters to current organization
 *   return db.query.posts.findMany({
 *     where: eq(posts.status, 'open'),
 *   })
 * })
 */
export async function withAuthenticatedTenant<T>(
  callback: (ctx: AuthenticatedTenantContext) => Promise<T>
): Promise<T> {
  const result = await validateTenantAccess()

  if (!result.valid) {
    const errorMessages = {
      not_authenticated: 'Authentication required',
      org_not_found: 'Organization not found',
      not_a_member: 'Not a member of this organization',
    } as const
    throw new Error(errorMessages[result.reason])
  }

  return withTenantContext(result.organization.id, async (tx) => {
    return callback({
      organization: result.organization,
      member: result.member,
      user: result.user,
      db: tx,
    })
  })
}

/**
 * Execute database operations with RLS tenant context (throws on invalid access).
 * Same as withAuthenticatedTenant but with redirect behavior for use in server components.
 *
 * @example
 * // In a server component
 * const { db, member } = await requireAuthenticatedTenant()
 * const posts = await db.query.posts.findMany()
 */
export async function requireAuthenticatedTenant(): Promise<
  Omit<AuthenticatedTenantContext, 'db'> & {
    withRLS: <T>(fn: (db: Database) => Promise<T>) => Promise<T>
  }
> {
  const result = await requireTenant() // This already redirects on failure

  return {
    organization: result.organization,
    member: result.member,
    user: result.user,
    withRLS: <T>(fn: (db: Database) => Promise<T>) => withTenantContext(result.organization.id, fn),
  }
}

// =============================================================================
// API Route Helpers (for routes that receive organizationId as parameter)
// =============================================================================

/**
 * Result type for API tenant validation
 */
type ApiTenantResult =
  | { success: false; error: string; status: 401 | 403 | 400 }
  | {
      success: true
      organization: NonNullable<Awaited<ReturnType<typeof db.query.organization.findFirst>>>
      member: NonNullable<Awaited<ReturnType<typeof db.query.member.findFirst>>>
      user: NonNullable<Awaited<ReturnType<typeof getSession>>>['user']
    }

/**
 * Validate tenant access for API routes that receive organizationId as a parameter.
 * Unlike subdomain-based validation, this validates against an explicitly provided org ID.
 *
 * @param organizationId - The organization ID to validate access for
 * @returns Validation result with organization, member, and user if successful
 *
 * @example
 * const validation = await validateApiTenantAccess(organizationId)
 * if (!validation.success) {
 *   return NextResponse.json({ error: validation.error }, { status: validation.status })
 * }
 * const { organization, member, user } = validation
 */
export async function validateApiTenantAccess(
  organizationId: string | null | undefined
): Promise<ApiTenantResult> {
  if (!organizationId) {
    return { success: false, error: 'organizationId is required', status: 400 }
  }

  const session = await getSession()
  if (!session?.user) {
    return { success: false, error: 'Unauthorized', status: 401 }
  }

  // Check if user is a member of this organization
  const memberRecord = await db.query.member.findFirst({
    where: and(eq(member.organizationId, organizationId), eq(member.userId, session.user.id)),
  })

  if (!memberRecord) {
    return { success: false, error: 'Forbidden', status: 403 }
  }

  // Get the organization details
  const org = await db.query.organization.findFirst({
    where: eq(organization.id, organizationId),
  })

  if (!org) {
    return { success: false, error: 'Organization not found', status: 403 }
  }

  return {
    success: true,
    organization: org,
    member: memberRecord,
    user: session.user,
  }
}

/**
 * Execute database operations with RLS tenant context for API routes.
 * Use this when you have an organizationId from request params/body.
 *
 * @example
 * const result = await withApiTenantContext(organizationId, async ({ db, member }) => {
 *   // RLS automatically filters to the organization
 *   return db.query.posts.findMany()
 * })
 * if (!result.success) {
 *   return NextResponse.json({ error: result.error }, { status: result.status })
 * }
 * return NextResponse.json(result.data)
 */
type ApiTenantSuccessResult = Extract<ApiTenantResult, { success: true }>

export async function withApiTenantContext<T>(
  organizationId: string | null | undefined,
  callback: (ctx: AuthenticatedTenantContext) => Promise<T>
): Promise<
  | { success: false; error: string; status: 401 | 403 | 400 }
  | {
      success: true
      data: T
      organization: ApiTenantSuccessResult['organization']
      member: ApiTenantSuccessResult['member']
      user: ApiTenantSuccessResult['user']
    }
> {
  const validation = await validateApiTenantAccess(organizationId)

  if (!validation.success) {
    return validation
  }

  const data = await withTenantContext(validation.organization.id, async (tx) => {
    return callback({
      organization: validation.organization,
      member: validation.member,
      user: validation.user,
      db: tx,
    })
  })

  return {
    success: true,
    data,
    organization: validation.organization,
    member: validation.member,
    user: validation.user,
  }
}
