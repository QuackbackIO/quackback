/**
 * API Key Authentication Middleware
 *
 * Validates API keys for public REST API endpoints.
 * Used in /api/v1/* routes.
 */

import { verifyApiKey, type ApiKey } from '@/lib/server/domains/api-keys'
import { unauthorizedResponse, forbiddenResponse, rateLimitedResponse } from './responses'
import { checkRateLimit, getClientIp } from './rate-limit'
import type { PrincipalId } from '@quackback/ids'

export type MemberRole = 'admin' | 'member' | 'user'

export interface ApiAuthContext {
  /** The validated API key */
  apiKey: ApiKey
  /** The principal ID of the key creator (for audit logging) */
  principalId: PrincipalId
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

  // Fetch principal role for authorization checks
  const { db, principal, eq } = await import('@/lib/server/db')
  const memberRecord = await db.query.principal.findFirst({
    where: eq(principal.id, apiKey.createdById),
    columns: { role: true },
  })

  // Default to most restrictive role if member not found
  const role = (memberRecord?.role as MemberRole) ?? 'user'

  return {
    apiKey,
    principalId: apiKey.createdById,
    role,
  }
}

export type AuthLevel = 'team' | 'admin'

/**
 * Require API key authentication with role-based authorization.
 * Includes rate limiting to prevent brute-force attacks.
 *
 * @param request - The incoming request
 * @param options.role - Required role level: 'team' (admin or member) or 'admin' (admin only)
 *
 * @example
 * const authResult = await withApiKeyAuth(request, { role: 'team' })
 * if (authResult instanceof Response) return authResult
 * const { apiKey, principalId } = authResult
 */
export async function withApiKeyAuth(
  request: Request,
  options: { role: AuthLevel }
): Promise<ApiAuthContext | Response> {
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

  // Check role-based authorization
  if (options.role === 'admin' && auth.role !== 'admin') {
    return forbiddenResponse('Admin access required for this operation')
  }

  if (options.role === 'team' && auth.role === 'user') {
    return forbiddenResponse('Team member access required for this operation')
  }

  return auth
}
