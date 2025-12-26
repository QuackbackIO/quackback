import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { validateApiTenantAccess, type ApiTenantResult } from '@/lib/tenant'
import { Feature } from '@quackback/domain'
import { checkFeatureAccess } from '@/lib/features/server'
import {
  isValidTypeId,
  type IdPrefix,
  type PostId,
  type BoardId,
  type CommentId,
  type TagId,
  type StatusId,
  type RoadmapId,
  type MemberId,
  type IntegrationId,
  type InviteId,
  type UserId,
} from '@quackback/ids'

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
 * Map of prefix to TypeId type for type-safe ID parsing
 */
type PrefixToTypeId = {
  post: PostId
  board: BoardId
  comment: CommentId
  tag: TagId
  status: StatusId
  roadmap: RoadmapId
  member: MemberId
  integration: IntegrationId
  invite: InviteId
  user: UserId
}

/**
 * Validate and return a TypeID from request input.
 * Throws ApiError with 400 status if format is invalid.
 *
 * Now that Drizzle handles TypeID ↔ UUID conversion automatically,
 * this function just validates the format and returns the TypeID as-is.
 *
 * @param value - TypeID string (e.g., 'post_01h455vb4pex5vsknk084sn02q')
 * @param expectedPrefix - Prefix to validate against (required for type safety)
 * @returns The validated TypeID with proper branded type
 * @throws ApiError if format is invalid or prefix doesn't match
 *
 * @example
 * const postId = parseId('post_01h455vb4pex5vsknk084sn02q', 'post') // => PostId
 * const boardId = parseId('board_01h455vb4pex5vsknk084sn02q', 'board') // => BoardId
 * parseId('invalid', 'post') // throws ApiError(400)
 */
export function parseId<P extends keyof PrefixToTypeId>(
  value: string,
  expectedPrefix: P
): PrefixToTypeId[P]
export function parseId(value: string, expectedPrefix?: IdPrefix): string
export function parseId(value: string, expectedPrefix?: IdPrefix): string {
  if (!isValidTypeId(value, expectedPrefix)) {
    throw new ApiError(
      expectedPrefix
        ? `Invalid ID format. Expected ${expectedPrefix}_xxx, got: ${value}`
        : `Invalid TypeID format: ${value}`,
      400
    )
  }
  // Return the TypeID as-is - Drizzle columns handle UUID conversion
  return value
}

/**
 * Verify that a resource exists.
 * Throws ApiError if resource is not found (404).
 *
 * @example
 * const board = await db.query.boards.findFirst({ where: eq(boards.id, boardId) })
 * verifyResourceExists(board, 'Board')
 * // board is now guaranteed to be non-null
 */
export function verifyResourceExists<T>(
  resource: T | null | undefined,
  resourceName: string = 'Resource'
): asserts resource is T {
  if (!resource) {
    throw new ApiError(`${resourceName} not found`, 404)
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
export function validateBody<T extends z.ZodTypeAny>(schema: T, body: unknown): z.output<T> {
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
  /**
   * Required feature for this endpoint. If specified, checks subscription tier access.
   * OSS (self-hosted) editions automatically have access to all features.
   */
  feature?: Feature
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
      // Validate tenant access
      const validation = await validateApiTenantAccess()
      if (!validation.success) {
        return NextResponse.json({ error: validation.error }, { status: validation.status })
      }

      // Check role if required
      if (options.roles && options.roles.length > 0) {
        if (!isAllowedRole(validation.member.role, options.roles)) {
          return forbiddenResponse()
        }
      }

      // Check feature access if required
      if (options.feature) {
        const featureCheck = await checkFeatureAccess(options.feature)
        if (!featureCheck.allowed) {
          return NextResponse.json(
            {
              error: featureCheck.error,
              requiredTier: featureCheck.requiredTier,
              upgradeUrl: featureCheck.upgradeUrl,
            },
            { status: 402 } // Payment Required
          )
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
 * const validation = await validateApiTenantAccess()
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

      // Validate tenant access
      const validation = await validateApiTenantAccess()
      if (!validation.success) {
        return NextResponse.json({ error: validation.error }, { status: validation.status })
      }

      // Check role if required
      if (options.roles && options.roles.length > 0) {
        if (!isAllowedRole(validation.member.role, options.roles)) {
          return forbiddenResponse()
        }
      }

      // Check feature access if required
      if (options.feature) {
        const featureCheck = await checkFeatureAccess(options.feature)
        if (!featureCheck.allowed) {
          return NextResponse.json(
            {
              error: featureCheck.error,
              requiredTier: featureCheck.requiredTier,
              upgradeUrl: featureCheck.upgradeUrl,
            },
            { status: 402 } // Payment Required
          )
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

// Re-export Feature for convenience
export { Feature }
