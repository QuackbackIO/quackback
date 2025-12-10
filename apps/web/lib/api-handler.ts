import { NextRequest, NextResponse } from 'next/server'
import type { ZodSchema } from 'zod'
import { validateApiTenantAccess, type ApiTenantResult } from '@/lib/tenant'

/**
 * Unified role type for all users (team + portal)
 * - owner: Full administrative access
 * - admin: Administrative access
 * - member: Team member access
 * - user: Portal user access (public portal only, no admin dashboard)
 */
type Role = 'owner' | 'admin' | 'member' | 'user'

/**
 * Custom error class for API errors that should be returned to the client.
 */
export class ApiError extends Error {
  constructor(
    public override message: string,
    public status: number
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

/**
 * Verify that a resource exists and belongs to the expected organization.
 * Throws ApiError if resource is not found (404) or doesn't belong to org (403).
 *
 * @example
 * const board = await db.query.boards.findFirst({ where: eq(boards.id, boardId) })
 * verifyResourceOwnership(board, validation.organization.id, 'Board')
 * // board is now guaranteed to be non-null and belong to the org
 */
export function verifyResourceOwnership<T extends { organizationId: string }>(
  resource: T | null | undefined,
  expectedOrgId: string,
  resourceName: string = 'Resource'
): asserts resource is T {
  if (!resource) {
    throw new ApiError(`${resourceName} not found`, 404)
  }
  if (resource.organizationId !== expectedOrgId) {
    throw new ApiError('Forbidden', 403)
  }
}

/**
 * Validate request body against a Zod schema.
 * Throws ApiError with 400 status if validation fails.
 *
 * @example
 * const body = await request.json()
 * const { name, description } = validateBody(createBoardSchema, body)
 */
export function validateBody<T>(schema: ZodSchema<T>, body: unknown): T {
  const result = schema.safeParse(body)
  if (!result.success) {
    throw new ApiError(result.error.issues[0]?.message || 'Invalid input', 400)
  }
  return result.data
}

/**
 * Role hierarchy for permission checks.
 * Higher number = more permissions.
 * 'user' role (portal users) has lowest level - public portal access only.
 */
const roleHierarchy: Record<Role, number> = {
  owner: 4,
  admin: 3,
  member: 2,
  user: 1,
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
        const contentType = request.headers.get('content-type') || ''

        try {
          if (contentType.includes('multipart/form-data')) {
            // Handle multipart/form-data (file uploads)
            const formData = await clonedRequest.formData()
            organizationId = formData.get('organizationId') as string | null
          } else {
            // Handle JSON body
            const body = await clonedRequest.json()
            organizationId = body.organizationId ?? null
          }
        } catch {
          // Body might not be JSON/FormData or might be empty
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
      if (error instanceof ApiError) {
        return NextResponse.json({ error: error.message }, { status: error.status })
      }
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

/**
 * Context passed to handler with route params.
 */
interface ApiHandlerContextWithParams<P> extends ApiHandlerContext {
  params: P
}

type ApiHandlerWithParams<P> = (
  request: NextRequest,
  context: ApiHandlerContextWithParams<P>
) => Promise<NextResponse>

/**
 * Wrap an API route handler that has route params with standardized error handling,
 * tenant validation, and optional role checking.
 *
 * @example
 * export const PATCH = withApiHandlerParams<{ id: string }>(
 *   async (request, { validation, params }) => {
 *     const { id } = params
 *     // ... handler logic
 *     return successResponse(result)
 *   },
 *   { roles: ['owner', 'admin'] }
 * )
 */
export function withApiHandlerParams<P>(
  handler: ApiHandlerWithParams<P>,
  options: ApiHandlerOptions = {}
) {
  return async (
    request: NextRequest,
    routeContext: { params: Promise<P> }
  ): Promise<NextResponse> => {
    try {
      const params = await routeContext.params

      // Extract organizationId from body or query params
      let organizationId: string | null = null

      if (request.method === 'GET' || request.method === 'DELETE') {
        const { searchParams } = new URL(request.url)
        organizationId = searchParams.get('organizationId')
      } else {
        // For POST/PATCH/PUT, try to parse the body
        const clonedRequest = request.clone()
        const contentType = request.headers.get('content-type') || ''

        try {
          if (contentType.includes('multipart/form-data')) {
            // Handle multipart/form-data (file uploads)
            const formData = await clonedRequest.formData()
            organizationId = formData.get('organizationId') as string | null
          } else {
            // Handle JSON body
            const body = await clonedRequest.json()
            organizationId = body.organizationId ?? null
          }
        } catch {
          // Body might not be JSON/FormData or might be empty
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

      // Call the handler with params
      return await handler(request, { validation, params })
    } catch (error) {
      if (error instanceof ApiError) {
        return NextResponse.json({ error: error.message }, { status: error.status })
      }
      console.error('API error:', error)
      return errorResponse('Internal server error', 500)
    }
  }
}
