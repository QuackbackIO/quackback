/**
 * Tenant access validation utilities
 *
 * This module handles tenant (organization) access validation for both:
 * - Domain-based routing (legacy): Functions like getCurrentOrganization(), requireTenant()
 * - Slug-based routing (new): Functions like getOrganizationBySlug(), requireTenantBySlug()
 *
 * The slug-based functions are used with the new /s/[orgSlug]/ route structure where
 * the organization slug comes from URL params instead of domain lookup.
 *
 * For database queries that need RLS protection, use the withAuthenticatedTenant wrapper
 * which combines auth validation with PostgreSQL session variable setup.
 */

import { headers } from 'next/headers'
import { cache } from 'react'
import { redirect } from 'next/navigation'
import {
  db,
  organization,
  member,
  workspaceDomain,
  eq,
  and,
  withTenantContext,
  type Database,
} from '@quackback/db'
import { getSession } from './auth/server'
import type { ServiceContext } from '@quackback/domain'

// =============================================================================
// Domain Resolution
// =============================================================================

/**
 * Get the current host from the request headers
 * @throws Error if host header is missing
 */
export const getHost = cache(async (): Promise<string> => {
  const headersList = await headers()
  const host = headersList.get('host')
  if (!host) {
    throw new Error('Missing host header')
  }
  return host
})

/**
 * Get the org slug from the current domain
 */
export const getOrgSlug = cache(async (): Promise<string | null> => {
  const org = await getCurrentOrganization()
  return org?.slug ?? null
})

// =============================================================================
// Organization Lookup (via workspace_domain table)
// =============================================================================

/**
 * Get the current organization from the domain
 *
 * Looks up the host in the workspace_domain table.
 * Supports both subdomains (acme.quackback.io) and custom domains (feedback.acme.com).
 */
export const getCurrentOrganization = cache(async () => {
  const host = await getHost()

  const domainRecord = await db.query.workspaceDomain.findFirst({
    where: eq(workspaceDomain.domain, host),
    with: { organization: true },
  })

  return domainRecord?.organization ?? null
})

// =============================================================================
// Member Lookup (simplified - member table is the source of truth)
// =============================================================================

/**
 * Get member record for a user in an organization.
 *
 * All authenticated users have member records with unified roles:
 * - owner/admin/member: Team members with admin dashboard access
 * - user: Portal users with public portal access only
 */
async function getMemberRecord(
  userId: string,
  organizationId: string
): Promise<typeof member.$inferSelect | null> {
  const memberRecord = await db.query.member.findFirst({
    where: and(eq(member.organizationId, organizationId), eq(member.userId, userId)),
  })
  return memberRecord ?? null
}

/**
 * Get the current user's role in the organization, if logged in.
 * Returns null if not logged in or no member record.
 *
 * Use this for public pages that want to show different UI based on role
 * (e.g., "Admin" button vs "Log in" button).
 *
 * All authenticated users have member records with unified roles:
 * - owner/admin/member: Can access admin dashboard
 * - user: Portal users (public portal only)
 */
export const getCurrentUserRole = cache(
  async (): Promise<'owner' | 'admin' | 'member' | 'user' | null> => {
    const [session, org] = await Promise.all([getSession(), getCurrentOrganization()])

    if (!session?.user || !org) {
      return null
    }

    const memberRecord = await getMemberRecord(session.user.id, org.id)

    if (!memberRecord) {
      return null
    }

    return memberRecord.role as 'owner' | 'admin' | 'member' | 'user'
  }
)

// =============================================================================
// Access Validation
// =============================================================================

type ValidationResult =
  | { valid: false; reason: 'not_authenticated' | 'org_not_found' | 'wrong_tenant' }
  | {
      valid: true
      organization: NonNullable<Awaited<ReturnType<typeof getCurrentOrganization>>>
      member: NonNullable<Awaited<ReturnType<typeof db.query.member.findFirst>>>
      user: NonNullable<Awaited<ReturnType<typeof getSession>>>['user']
    }

/**
 * Validate that the current user has access to the current organization.
 *
 * Access = has a member record (any role: owner/admin/member/user).
 * Returns the organization and member info if valid.
 */
export const validateTenantAccess = cache(async (): Promise<ValidationResult> => {
  const [session, org] = await Promise.all([getSession(), getCurrentOrganization()])

  if (!session?.user) {
    return { valid: false, reason: 'not_authenticated' }
  }

  if (!org) {
    return { valid: false, reason: 'org_not_found' }
  }

  // Check member table for team access
  const memberRecord = await getMemberRecord(session.user.id, org.id)

  if (!memberRecord) {
    return { valid: false, reason: 'wrong_tenant' }
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
 * Require valid tenant access - redirects if invalid.
 *
 * Full Tenant Isolation: All redirects stay on the subdomain.
 * Users are scoped to their organization and cannot access other tenants.
 */
export async function requireTenant() {
  const result = await validateTenantAccess()

  if (!result.valid) {
    // All redirects stay on the subdomain in tenant isolation model
    const redirectMap = {
      not_authenticated: '/login',
      org_not_found: '/login?error=org_not_found',
      wrong_tenant: '/login?error=wrong_tenant',
    } as const
    redirect(redirectMap[result.reason])
  }

  return result
}

/**
 * Require specific role within the tenant.
 * Redirects to portal home if user doesn't have required role.
 */
export async function requireTenantRole(allowedRoles: string[]) {
  const result = await requireTenant()

  if (!allowedRoles.includes(result.member.role)) {
    // Users without required role get redirected to portal home
    redirect('/')
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
      wrong_tenant: 'Access denied for this organization',
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
    serviceContext: ServiceContext
  }
> {
  const result = await requireTenant() // This already redirects on failure

  return {
    organization: result.organization,
    member: result.member,
    user: result.user,
    withRLS: <T>(fn: (db: Database) => Promise<T>) => withTenantContext(result.organization.id, fn),
    serviceContext: {
      organizationId: result.organization.id,
      userId: result.user.id,
      memberId: result.member.id,
      memberRole: result.member.role as 'owner' | 'admin' | 'member' | 'user',
      userName: result.user.name || result.user.email,
      userEmail: result.user.email,
    },
  }
}

// =============================================================================
// API Route Helpers (for routes that receive organizationId as parameter)
// =============================================================================

/**
 * Result type for API tenant validation
 */
export type ApiTenantResult =
  | { success: false; error: string; status: 401 | 403 | 400 }
  | {
      success: true
      organization: NonNullable<Awaited<ReturnType<typeof db.query.organization.findFirst>>>
      member: NonNullable<Awaited<ReturnType<typeof db.query.member.findFirst>>>
      user: NonNullable<Awaited<ReturnType<typeof getSession>>>['user']
    }

/**
 * Validate access for API routes that receive organizationId as a parameter.
 *
 * Access = has a member record (any role: owner/admin/member/user).
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

  // Check member table for team access
  const memberRecord = await getMemberRecord(session.user.id, organizationId)

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

// =============================================================================
// Slug-Based Organization Lookup (for path-based routing)
// =============================================================================

/**
 * Get organization by slug (for path-based routing).
 *
 * Use this in routes under /s/[orgSlug]/ where the organization slug
 * comes from URL params instead of domain lookup.
 *
 * @param slug - The organization slug from route params
 * @returns The organization or null if not found
 */
export const getOrganizationBySlug = cache(async (slug: string) => {
  if (!slug || typeof slug !== 'string') {
    return null
  }
  const org = await db.query.organization.findFirst({
    where: eq(organization.slug, slug),
  })
  return org ?? null
})

/**
 * Validate team access using slug from route params.
 *
 * Team access = has a member record (owner/admin/member roles).
 *
 * @param orgSlug - The organization slug from route params
 * @returns Validation result with organization and member info if valid
 */
export const validateTenantAccessBySlug = cache(
  async (orgSlug: string): Promise<ValidationResult> => {
    const [session, org] = await Promise.all([getSession(), getOrganizationBySlug(orgSlug)])

    if (!session?.user) {
      return { valid: false, reason: 'not_authenticated' }
    }

    if (!org) {
      return { valid: false, reason: 'org_not_found' }
    }

    // Check member table for team access
    const memberRecord = await getMemberRecord(session.user.id, org.id)

    if (!memberRecord) {
      return { valid: false, reason: 'wrong_tenant' }
    }

    return { valid: true, organization: org, member: memberRecord, user: session.user }
  }
)

/**
 * Require valid tenant access by slug - redirects if invalid.
 *
 * Use this in protected routes under /s/[orgSlug]/ to ensure the user
 * is authenticated and has access to the organization.
 *
 * @param orgSlug - The organization slug from route params
 * @returns Validated result with organization and member info
 */
export async function requireTenantBySlug(orgSlug: string) {
  const result = await validateTenantAccessBySlug(orgSlug)

  if (!result.valid) {
    const redirectMap = {
      not_authenticated: '/login',
      org_not_found: '/login?error=org_not_found',
      wrong_tenant: '/login?error=wrong_tenant',
    } as const
    redirect(redirectMap[result.reason])
  }

  return result
}

/**
 * Require specific role within tenant (by slug).
 *
 * Use this in routes that require specific roles (e.g., admin dashboard).
 * Redirects to portal home if user doesn't have required role.
 *
 * @param orgSlug - The organization slug from route params
 * @param allowedRoles - Array of allowed roles (e.g., ['owner', 'admin', 'member'])
 * @returns Validated result with organization and member info
 */
export async function requireTenantRoleBySlug(orgSlug: string, allowedRoles: string[]) {
  const result = await requireTenantBySlug(orgSlug)

  if (!allowedRoles.includes(result.member.role)) {
    // Users without required role get redirected to portal home
    redirect('/')
  }

  return result
}

/**
 * Get authenticated tenant context with RLS wrapper (by slug).
 *
 * Use this in routes that need to execute database operations with RLS protection.
 * Provides both the tenant context and a serviceContext for domain services.
 *
 * @param orgSlug - The organization slug from route params
 * @returns Context with organization, member, user, withRLS wrapper, and serviceContext
 *
 * @example
 * const { organization, serviceContext, withRLS } = await requireAuthenticatedTenantBySlug(orgSlug)
 * const posts = await withRLS(db => db.query.posts.findMany())
 * // Or use services:
 * const result = await getPostService().listInboxPosts(filters, serviceContext)
 */
export async function requireAuthenticatedTenantBySlug(orgSlug: string): Promise<
  Omit<AuthenticatedTenantContext, 'db'> & {
    withRLS: <T>(fn: (db: Database) => Promise<T>) => Promise<T>
    serviceContext: ServiceContext
  }
> {
  const result = await requireTenantBySlug(orgSlug)

  return {
    organization: result.organization,
    member: result.member,
    user: result.user,
    withRLS: <T>(fn: (db: Database) => Promise<T>) => withTenantContext(result.organization.id, fn),
    serviceContext: {
      organizationId: result.organization.id,
      userId: result.user.id,
      memberId: result.member.id,
      memberRole: result.member.role as 'owner' | 'admin' | 'member' | 'user',
      userName: result.user.name || result.user.email,
      userEmail: result.user.email,
    },
  }
}

/**
 * Get current user role by slug (for public pages).
 *
 * Use this in public pages under /s/[orgSlug]/(portal)/ that want to show
 * different UI based on whether the user is logged in and their role.
 *
 * All authenticated users have member records with unified roles:
 * - owner/admin/member: Can access admin dashboard
 * - user: Portal users (public portal only)
 *
 * @param orgSlug - The organization slug from route params
 * @returns The user's role or null if not logged in
 */
export const getCurrentUserRoleBySlug = cache(
  async (orgSlug: string): Promise<'owner' | 'admin' | 'member' | 'user' | null> => {
    const [session, org] = await Promise.all([getSession(), getOrganizationBySlug(orgSlug)])

    if (!session?.user || !org) {
      return null
    }

    // Check member table for team access
    const memberRecord = await getMemberRecord(session.user.id, org.id)

    if (!memberRecord) {
      return null
    }

    return memberRecord.role as 'owner' | 'admin' | 'member' | 'user'
  }
)
