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
import { db, principal, apiKeys, eq } from '@/lib/server/db'
import type { PrincipalId } from '@quackback/ids'
import { isAdmin, isTeamMember } from '@/lib/shared/roles'
import type { PermissionKey } from '@/lib/server/domains/authz/authz.permissions'

export type MemberRole = 'admin' | 'member' | 'user'

export interface ApiAuthContext {
  /** The validated API key */
  apiKey: ApiKey
  /** The principal ID of the key creator (for audit logging) */
  principalId: PrincipalId
  /** The role of the member who created the key */
  role: MemberRole
  /** Whether the request is in import mode (suppresses side effects, raises rate limit) */
  importMode: boolean
  /** Client IP address (best-effort, from CDN headers or socket). */
  ipAddress: string | null
  /** User-agent header (truncated to 500 chars). */
  userAgent: string | null
  /** Audit source for write paths originating from API key requests. */
  source: 'api'
  /** Quick-reference scope info for the calling key. */
  key: {
    id: ApiKey['id']
    name: string
    scopes: string[]
    allowedTeamIds: string[]
    allowedInboxIds: string[]
    compatLegacyFullAccess: boolean
  }
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

  const ipAddress = getClientIp(request) || null
  const ua = request.headers.get('user-agent')
  const userAgent = ua ? ua.slice(0, 500) : null

  // Best-effort: update last_ip/last_user_agent. last_used_at is already
  // updated inside verifyApiKey; we pile these into a separate fire-and-forget
  // UPDATE so a failure here never blocks auth.
  if (ipAddress || userAgent) {
    db.update(apiKeys)
      .set({ lastIp: ipAddress, lastUserAgent: userAgent })
      .where(eq(apiKeys.id, apiKey.id))
      .execute()
      .catch(() => {
        // ignore
      })
  }

  return {
    apiKey,
    principalId: apiKey.principalId,
    role,
    importMode: false,
    ipAddress,
    userAgent,
    source: 'api',
    key: {
      id: apiKey.id,
      name: apiKey.name,
      scopes: apiKey.scopes,
      allowedTeamIds: apiKey.allowedTeamIds,
      allowedInboxIds: apiKey.allowedInboxIds,
      compatLegacyFullAccess: apiKey.compatLegacyFullAccess,
    },
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
 * const { principalId } = await withApiKeyAuth(request, { role: 'team' })
 */
export async function withApiKeyAuth(
  request: Request,
  options: { role: AuthLevel }
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

  if (options.role === 'admin' && !isAdmin(auth.role)) {
    throw new ForbiddenError('FORBIDDEN', 'Admin access required for this operation')
  }

  if (options.role === 'team' && !isTeamMember(auth.role)) {
    throw new ForbiddenError('FORBIDDEN', 'Team member access required for this operation')
  }

  if (wantsImportMode && isAdmin(auth.role)) {
    auth.importMode = true
  }

  return auth
}

// ---------------------------------------------------------------------------
// Scope enforcement (Phase 6)
// ---------------------------------------------------------------------------

/**
 * Enforce that the authenticated API key is allowed to use `permission`.
 *
 * Semantics:
 *   - If `key.scopes` is empty AND `compatLegacyFullAccess` is true → allow
 *     (backwards-compatible behavior for keys created before scoping shipped).
 *   - If `key.scopes` is empty AND compat is false → deny (admin opted out).
 *   - Otherwise → allow only if `permission` is in `key.scopes`.
 *
 * Throws `ForbiddenError` on denial.
 */
export function assertScopeAllowed(ctx: ApiAuthContext, permission: PermissionKey): void {
  const { scopes, compatLegacyFullAccess } = ctx.key
  if (scopes.length === 0) {
    if (compatLegacyFullAccess) return
    throw new ForbiddenError(
      'API_KEY_SCOPE_DENIED',
      `API key has no scopes; missing required scope: ${permission}`
    )
  }
  if (!scopes.includes(permission)) {
    throw new ForbiddenError(
      'API_KEY_SCOPE_DENIED',
      `API key is not scoped for required permission: ${permission}`
    )
  }
}

/**
 * Enforce that the authenticated API key is allowed to act on `teamId`.
 * Empty `allowedTeamIds` means "no team restriction".
 */
export function assertTeamAllowed(ctx: ApiAuthContext, teamId: string | null | undefined): void {
  if (!teamId) return
  const { allowedTeamIds } = ctx.key
  if (allowedTeamIds.length === 0) return
  if (!allowedTeamIds.includes(teamId)) {
    throw new ForbiddenError(
      'API_KEY_TEAM_DENIED',
      `API key is not allowed to access team ${teamId}`
    )
  }
}

/**
 * Enforce that the authenticated API key is allowed to act on `inboxId`.
 * Empty `allowedInboxIds` means "no inbox restriction".
 */
export function assertInboxAllowed(ctx: ApiAuthContext, inboxId: string | null | undefined): void {
  if (!inboxId) return
  const { allowedInboxIds } = ctx.key
  if (allowedInboxIds.length === 0) return
  if (!allowedInboxIds.includes(inboxId)) {
    throw new ForbiddenError(
      'API_KEY_INBOX_DENIED',
      `API key is not allowed to access inbox ${inboxId}`
    )
  }
}
