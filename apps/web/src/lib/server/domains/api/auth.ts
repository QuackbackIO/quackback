/**
 * API Key Authentication Middleware
 *
 * Validates API keys for public REST API endpoints.
 * Used in /api/v1/* routes.
 */

import { verifyApiKey } from '@/lib/server/domains/api-keys/api-key.service'
import type { ApiKey } from '@/lib/server/domains/api-keys'
import { checkRateLimit, getClientIp } from './rate-limit'
import { UnauthorizedError, ForbiddenError, RateLimitError } from '@/lib/shared/errors'
import { db, principal, eq } from '@/lib/server/db'
import type { PrincipalId } from '@quackback/ids'
import { isAdmin, type Role } from '@/lib/shared/roles'
import { resolveActorPermissions } from '@/lib/server/policy/permissions'
import type { PermissionKey } from '@/lib/shared/permissions'

export type MemberRole = Role

export interface ApiAuthContext {
  /** The validated API key */
  apiKey: ApiKey
  /** The principal ID of the key creator (for audit logging) */
  principalId: PrincipalId
  /** The role of the member who created the key */
  role: MemberRole
  /** Whether the request is in import mode (suppresses side effects, raises rate limit) */
  importMode: boolean
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

  // Use the API key's service principal for role and identity
  const principalRecord = await db.query.principal.findFirst({
    where: eq(principal.id, apiKey.principalId),
    columns: { role: true },
  })

  // Default to most restrictive role if principal not found
  const role = (principalRecord?.role as MemberRole) ?? 'user'

  return {
    apiKey,
    principalId: apiKey.principalId,
    role,
    importMode: false,
  }
}

/**
 * Require API key authentication, optionally gated on a permission.
 * Includes rate limiting to prevent brute-force attacks.
 *
 * A key's authority is its owner's permission set (the service principal's role
 * preset). Bare `withApiKeyAuth(request)` requires only a valid key. The legacy
 * `{ role }` form was retired at the Phase C completion gate.
 *
 * @example
 * const { principalId } = await withApiKeyAuth(request, { permission: PERMISSIONS.POST_CREATE })
 */
export async function withApiKeyAuth(
  request: Request,
  options?: { permission: PermissionKey }
): Promise<ApiAuthContext> {
  const clientIp = getClientIp(request)
  const wantsImportMode = request.headers.get('x-import-mode') === 'true'
  const rateLimit = await checkRateLimit(clientIp, wantsImportMode)

  if (!rateLimit.allowed) {
    throw new RateLimitError(rateLimit.retryAfter ?? 60)
  }

  const auth = await requireApiKey(request)

  if (!auth) {
    throw new UnauthorizedError(
      'Invalid or missing API key. Provide a valid key in the Authorization header: Bearer qb_xxx'
    )
  }

  // A key's authority is its owner's permission set — the service principal's
  // role preset. Per-key scope narrowing (owner permissions ∩ key scopes) is a
  // future addition; today every key carries its owner's full authority, so this
  // stays non-regressing vs the prior role inheritance. No options means a valid
  // key is required but no authorization gate — for reads whose data is public.
  if (options) {
    if (!resolveActorPermissions(auth.role).has(options.permission)) {
      throw new ForbiddenError('FORBIDDEN', `Requires the '${options.permission}' permission`)
    }
  }

  if (wantsImportMode && isAdmin(auth.role)) {
    auth.importMode = true
  }

  return auth
}
