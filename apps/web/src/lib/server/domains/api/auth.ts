/**
 * API Key Authentication Middleware
 *
 * Validates API keys for public REST API endpoints.
 * Used in /api/v1/* routes.
 */

import { verifyApiKey, type ApiKey } from '@/lib/server/domains/api-keys'
import { unauthorizedResponse, forbiddenResponse, rateLimitedResponse } from './responses'
import { checkRateLimit, getClientIp } from './rate-limit'
import type { MemberId } from '@quackback/ids'

export type MemberRole = 'admin' | 'member' | 'user'

export interface ApiAuthContext {
  /** The validated API key */
  apiKey: ApiKey
  /** The member ID of the key creator (for audit logging) */
  memberId: MemberId
  /** The role of the member who created the key */
  role: MemberRole
}

/**
 * Extract Bearer token from Authorization header
 */
function extractBearerToken(authHeader: string | null): string | null {
  if (!authHeader) return null
  const match = authHeader.match(/^Bearer\s+(.+)$/i)
  return match ? match[1] : null
}

/**
 * Require API key authentication for a request.
 *
 * @param request - The incoming request
 * @returns ApiAuthContext if valid, null if authentication failed
 *
 * @example
 * const auth = await requireApiKey(request)
 * if (!auth) {
 *   return errorResponse('UNAUTHORIZED', 'Invalid or missing API key', 401)
 * }
 */
export async function requireApiKey(request: Request): Promise<ApiAuthContext | null> {
  const authHeader = request.headers.get('authorization')
  const token = extractBearerToken(authHeader)

  if (!token) {
    return null
  }

  const apiKey = await verifyApiKey(token)
  if (!apiKey) {
    return null
  }

  // Fetch member role for authorization checks
  const { db, member, eq } = await import('@/lib/db')
  const memberRecord = await db.query.member.findFirst({
    where: eq(member.id, apiKey.createdById),
    columns: { role: true },
  })

  // Default to most restrictive role if member not found
  const role = (memberRecord?.role as MemberRole) ?? 'user'

  return {
    apiKey,
    memberId: apiKey.createdById,
    role,
  }
}

/**
 * Middleware helper that returns an unauthorized response if API key is invalid.
 * Includes rate limiting to prevent brute-force attacks.
 *
 * @example
 * export async function GET({ request }) {
 *   const authResult = await withApiKeyAuth(request)
 *   if (authResult instanceof Response) return authResult
 *
 *   const { apiKey, memberId } = authResult
 *   // ... handle request
 * }
 */
export async function withApiKeyAuth(request: Request): Promise<ApiAuthContext | Response> {
  // Check rate limit before processing
  const clientIp = getClientIp(request)
  const rateLimit = checkRateLimit(clientIp)

  if (!rateLimit.allowed) {
    return rateLimitedResponse(rateLimit.retryAfter ?? 60)
  }

  const auth = await requireApiKey(request)

  if (!auth) {
    return unauthorizedResponse(
      'Invalid or missing API key. Provide a valid key in the Authorization header: Bearer qb_xxx'
    )
  }

  return auth
}

/**
 * Require API key authentication with admin role.
 * Returns 403 Forbidden if the member is not an admin.
 */
export async function withApiKeyAuthAdmin(request: Request): Promise<ApiAuthContext | Response> {
  const auth = await withApiKeyAuth(request)
  if (auth instanceof Response) return auth

  if (auth.role !== 'admin') {
    return forbiddenResponse('Admin access required for this operation')
  }

  return auth
}

/**
 * Require API key authentication with admin or member role.
 * Returns 403 Forbidden if the member is a portal user.
 */
export async function withApiKeyAuthTeam(request: Request): Promise<ApiAuthContext | Response> {
  const auth = await withApiKeyAuth(request)
  if (auth instanceof Response) return auth

  if (auth.role === 'user') {
    return forbiddenResponse('Team member access required for this operation')
  }

  return auth
}
