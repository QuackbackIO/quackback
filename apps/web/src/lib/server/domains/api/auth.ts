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
import { db, principal, user, eq } from '@/lib/server/db'
import type { PrincipalId } from '@quackback/ids'
import { isAdmin, type Role } from '@/lib/shared/roles'
import { resolveActorPermissions } from '@/lib/server/policy/permissions'
import { hasApiScope, scopeForPermission } from '@/lib/server/domains/api-keys/api-key-scopes'
import type { PermissionKey } from '@/lib/shared/permissions'

export type MemberRole = Role

/** The key's principal row (with any linked user) as read by the auth query. */
export type ApiKeyPrincipal = typeof principal.$inferSelect & {
  user: typeof user.$inferSelect | null
}

export interface ApiAuthContext {
  /** The validated API key */
  apiKey: ApiKey
  /** The principal ID of the key creator (for audit logging) */
  principalId: PrincipalId
  /** The role of the member who created the key */
  role: MemberRole
  /**
   * The key's principal row read during auth, or null when the principal is
   * missing. Exposed so downstream consumers (the MCP handler) reuse the
   * single per-request lookup instead of re-querying.
   */
  principal: ApiKeyPrincipal | null
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

  // Use the API key's service principal for role and identity. The linked
  // user rides along in the same query for consumers that need the human
  // identity (legacy human-backed keys via MCP); service principals have none.
  const principalRecord = await db.query.principal.findFirst({
    where: eq(principal.id, apiKey.principalId),
    with: { user: true },
  })

  // Default to most restrictive role if principal not found
  const role = (principalRecord?.role as MemberRole) ?? 'user'

  return {
    apiKey,
    principalId: apiKey.principalId,
    role,
    principal: principalRecord ?? null,
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

  // A key's authority is its owner's permission set (the service principal's
  // role preset) INTERSECTED with the key's stored scopes — the personal-access-
  // token model. Keys with a NULL scopes column predate scope selection and keep
  // full owner authority. No options means a valid key is required but no
  // authorization gate — for reads whose data is public.
  if (options) {
    if (!resolveActorPermissions(auth.role).has(options.permission)) {
      throw new ForbiddenError('FORBIDDEN', `Requires the '${options.permission}' permission`)
    }
    assertKeyScopeFor(auth, options.permission)
  }

  if (wantsImportMode && isAdmin(auth.role)) {
    auth.importMode = true
  }

  return auth
}

/**
 * Assert an API key's authority holds every permission in the list — the
 * owner's role preset must grant each permission AND, for a scoped key, the
 * key must hold each permission's mapped scope. For routes whose required
 * permissions depend on the request body (e.g. a multi-field PATCH), gate with
 * a bare `withApiKeyAuth(request)` then call this with the body-derived key set.
 */
export function assertApiPermissions(
  auth: ApiAuthContext,
  permissions: readonly PermissionKey[]
): void {
  const held = resolveActorPermissions(auth.role)
  for (const permission of permissions) {
    if (!held.has(permission)) {
      throw new ForbiddenError('FORBIDDEN', `Requires the '${permission}' permission`)
    }
    assertKeyScopeFor(auth, permission)
  }
}

/**
 * Enforce the key-scope half of the authority intersection: a scoped key must
 * hold the scope its permission maps to (see `scopeForPermission` for the
 * shared permission-to-scope table). Legacy keys (NULL scopes) pass everything
 * their owner's permissions allow.
 */
function assertKeyScopeFor(auth: ApiAuthContext, permission: PermissionKey): void {
  const required = scopeForPermission(permission)
  if (!hasApiScope(auth.apiKey.scopes, required)) {
    throw new ForbiddenError(
      'FORBIDDEN',
      `This API key is missing the '${required}' scope required by '${permission}'`
    )
  }
}
