import { NextRequest, NextResponse } from 'next/server'
import { validateApiTenantAccess, type ApiTenantResult } from '@/lib/tenant'

type Role = 'owner' | 'admin' | 'member'

/**
 * Role hierarchy for permission checks.
 * Higher number = more permissions.
 */
const roleHierarchy: Record<Role, number> = {
  owner: 3,
  admin: 2,
  member: 1,
}

/**
 * Check if a user has at least the required role level.
 */
export function hasMinimumRole(userRole: Role, requiredRole: Role): boolean {
  return roleHierarchy[userRole] >= roleHierarchy[requiredRole]
}

/**
 * Check if user role is in the allowed roles array.
 */
export function isAllowedRole(userRole: string, allowedRoles: Role[]): boolean {
  return allowedRoles.includes(userRole as Role)
}

/**
 * Create a forbidden response for role check failures.
 */
export function forbiddenResponse(message = 'Forbidden'): NextResponse {
  return NextResponse.json({ error: message }, { status: 403 })
}

/**
 * Standard error response helper.
 */
export function errorResponse(message: string, status: number = 500): NextResponse {
  return NextResponse.json({ error: message }, { status })
}

/**
 * Standard success response helper.
 */
export function successResponse<T>(data: T, status: number = 200): NextResponse {
  return NextResponse.json(data, { status })
}

/**
 * Options for the API handler wrapper.
 */
interface ApiHandlerOptions {
  /**
   * Required roles for this endpoint. If not specified, any authenticated member can access.
   */
  roles?: Role[]
}

/**
 * Context passed to the handler function after validation.
 */
interface ApiHandlerContext {
  validation: Extract<ApiTenantResult, { success: true }>
}

type ApiHandler = (request: NextRequest, context: ApiHandlerContext) => Promise<NextResponse>

/**
 * Wrap an API route handler with standardized error handling,
 * tenant validation, and optional role checking.
 *
 * @example
 * export const POST = withApiHandler(
 *   async (request, { validation }) => {
 *     const body = await request.json()
 *     // ... handler logic
 *     return successResponse(result, 201)
 *   },
 *   { roles: ['owner', 'admin'] }
 * )
 */
export function withApiHandler(handler: ApiHandler, options: ApiHandlerOptions = {}) {
  return async (request: NextRequest): Promise<NextResponse> => {
    try {
      // Extract organizationId from body or query params
      let organizationId: string | null = null

      if (request.method === 'GET' || request.method === 'DELETE') {
        const { searchParams } = new URL(request.url)
        organizationId = searchParams.get('organizationId')
      } else {
        // For POST/PATCH/PUT, try to parse the body
        // Clone the request so we can read the body twice
        const clonedRequest = request.clone()
        try {
          const body = await clonedRequest.json()
          organizationId = body.organizationId ?? null
        } catch {
          // Body might not be JSON or might be empty
        }
      }

      // Validate tenant access
      const validation = await validateApiTenantAccess(organizationId)
      if (!validation.success) {
        return NextResponse.json({ error: validation.error }, { status: validation.status })
      }

      // Check role if required
      if (options.roles && options.roles.length > 0) {
        if (!isAllowedRole(validation.member.role, options.roles)) {
          return forbiddenResponse()
        }
      }

      // Call the handler
      return await handler(request, { validation })
    } catch (error) {
      console.error('API error:', error)
      return errorResponse('Internal server error', 500)
    }
  }
}

/**
 * Simplified handler for routes that just need role checking.
 * Returns a function that checks if the member has an allowed role.
 *
 * @example
 * const validation = await validateApiTenantAccess(organizationId)
 * if (!validation.success) return errorResponse(validation.error, validation.status)
 *
 * if (!requireRole(validation.member.role, ['owner', 'admin'])) {
 *   return forbiddenResponse()
 * }
 */
export function requireRole(userRole: string, allowedRoles: Role[]): boolean {
  return isAllowedRole(userRole, allowedRoles)
}
