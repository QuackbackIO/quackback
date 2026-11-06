/**
 * API Key Authentication Middleware
 *
 * Validates API keys for public REST API endpoints.
 * Used in /api/v1/* routes.
 */

import { verifyApiKey } from '@/lib/server/domains/api-keys/api-key.service'
import {
  resolveApiKeyAuthority,
  type ApiKeyPrincipal,
} from '@/lib/server/domains/api-keys/api-key-authority'
import type { ApiKey } from '@/lib/server/domains/api-keys'
import {
  apiRateLimitRetryAfter,
  checkRateLimit,
  getClientIp,
  hasRecentApiKeyFailure,
  recordApiKeyFailure,
} from './rate-limit'
import { UnauthorizedError, ForbiddenError, RateLimitError } from '@/lib/shared/errors'
import type { PrincipalId } from '@quackback/ids'
import { isAdmin, type Role } from '@/lib/shared/roles'
import {
  hasApiScope,
  scopeForPermission,
  type ApiKeyScope,
} from '@/lib/server/domains/api-keys/api-key-scopes'
import type { PermissionKey } from '@/lib/shared/permissions'
import {
  apiKeyAttribution,
  getAuditAttribution,
  setAuditAttribution,
} from '@/lib/server/audit/attribution'
import type { AuditActor, AuditActorType } from '@/lib/server/audit/log'

export type MemberRole = Role
export type { ApiKeyPrincipal }

export interface ApiAuthContext {
  /** The validated API key */
  apiKey: ApiKey
  /** The key's own principal ID (its identity for attribution and audit) */
  principalId: PrincipalId
  /** The key's role, capped at its creator's current role */
  role: MemberRole
  /**
   * The key's permission set: its role preset intersected with its creator's
   * current permissions (custom roles included). Gates read this, never a
   * preset expanded from `role`, which could be wider.
   */
  permissions: ReadonlySet<PermissionKey>
  /**
   * The key's principal row read during auth, or null when the principal is
   * missing. Exposed so downstream consumers (the MCP handler) reuse the
   * single per-request lookup instead of re-querying.
   */
  principal: ApiKeyPrincipal | null
  /**
   * The teammate whose row scope this key follows (its creator, for a
   * personal key). Service actors built from this context carry it, so the
   * ticket and conversation filters treat the key as that teammate.
   */
  scopePrincipalId?: PrincipalId
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

  // The key acts for its creator: once they have left the team it is refused
  // exactly like an unknown key, and while they remain it is capped at their
  // current access. The key's principal (with any linked user, for legacy
  // human-backed keys used via MCP) is read in the same query.
  const authority = await resolveApiKeyAuthority(apiKey)
  if (!authority) {
    return null
  }

  return {
    apiKey,
    principalId: apiKey.principalId,
    role: authority.role,
    permissions: authority.permissions,
    principal: authority.principal,
    scopePrincipalId: authority.scopePrincipalId ?? undefined,
    importMode: false,
  }
}

/**
 * Require API key authentication, optionally gated on a permission.
 * Includes rate limiting to prevent brute-force attacks.
 *
 * A key's authority is its role preset intersected with its creator's current
 * permissions (see `resolveApiKeyAuthority`). Bare `withApiKeyAuth(request)`
 * requires only a valid key whose creator is still on the team.
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
  // Each request is counted once, before its key is checked. Asking for import
  // mode admits it up to the import cap, but past the base cap it is served
  // only for a verified admin key, and only from an address that has not
  // presented a bad key in import mode this window. A missing, bad or
  // non-admin key therefore stays at the base cap, and so do failed attempts.
  const rateLimit = await checkRateLimit(clientIp, wantsImportMode)

  if (!rateLimit.allowed) {
    throw new RateLimitError(rateLimit.retryAfter ?? 60)
  }

  const overBaseLimit = rateLimit.overBaseLimit === true
  if (overBaseLimit && (await hasRecentApiKeyFailure(clientIp))) {
    throw new RateLimitError(await apiRateLimitRetryAfter(clientIp))
  }

  const auth = await requireApiKey(request)

  if (!auth) {
    if (wantsImportMode) await recordApiKeyFailure(clientIp)
    if (overBaseLimit) throw new RateLimitError(await apiRateLimitRetryAfter(clientIp))
    throw new UnauthorizedError(
      'Invalid or missing API key. Provide a valid key in the Authorization header: Bearer qb_xxx'
    )
  }

  // The key's role is already capped at its creator's current role.
  const importMode = wantsImportMode && isAdmin(auth.role)
  if (overBaseLimit && !importMode) {
    throw new RateLimitError(await apiRateLimitRetryAfter(clientIp))
  }

  // The key is now known, so this request's changes are attributed to it, and
  // to the teammate who created it. Stated before the permission gates so a
  // refused write is attributed too.
  // An admin key's import is summarised per minute rather than row by row.
  // A key used over MCP keeps the MCP label its boundary set before auth ran.
  const channel = getAuditAttribution()?.channel === 'mcp' ? 'mcp' : 'api'
  setAuditAttribution(apiKeyAttribution(auth.apiKey, channel), apiKeyAuditActor(auth), {
    importMode,
  })

  // A key's authority is its resolved permission set (role preset intersected
  // with the creator's current permissions) INTERSECTED with the key's stored
  // scopes: the personal-access-token model. Keys with a NULL scopes column
  // predate scope selection and keep full owner authority. No options means a
  // valid key is required but no authorization gate, for reads whose data is
  // public.
  if (options) {
    if (!auth.permissions.has(options.permission)) {
      throw new ForbiddenError('FORBIDDEN', `Requires the '${options.permission}' permission`)
    }
    assertKeyScopeFor(auth, options.permission)
  }

  if (importMode) {
    auth.importMode = true
  }

  return auth
}

/**
 * The audit actor for a key: its service principal, or for a legacy key backed
 * by a person, that person.
 */
function apiKeyAuditActor(auth: ApiAuthContext): AuditActor {
  const human = auth.principal?.type === 'service' ? null : (auth.principal?.user ?? null)
  return {
    userId: human?.id ?? null,
    email: human?.email ?? null,
    role: auth.role,
    type: (auth.principal?.type as AuditActorType | undefined) ?? 'service',
    authMethod: 'api_key',
  }
}

/**
 * Assert an API key's authority holds every permission in the list: the key's
 * resolved permission set must grant each permission AND, for a scoped key,
 * the key must hold each permission's mapped scope. For routes whose required
 * permissions depend on the request body (e.g. a multi-field PATCH), gate with
 * a bare `withApiKeyAuth(request)` then call this with the body-derived key set.
 */
export function assertApiPermissions(
  auth: ApiAuthContext,
  permissions: readonly PermissionKey[]
): void {
  for (const permission of permissions) {
    if (!auth.permissions.has(permission)) {
      throw new ForbiddenError('FORBIDDEN', `Requires the '${permission}' permission`)
    }
    assertKeyScopeFor(auth, permission)
  }
}

/**
 * Assert a key holds a scope, for a read whose rows are authorized one by one
 * rather than by a single permission. Legacy keys (NULL scopes) hold every
 * scope.
 */
export function assertApiScope(auth: ApiAuthContext, scope: ApiKeyScope): void {
  if (!hasApiScope(auth.apiKey.scopes, scope)) {
    throw new ForbiddenError('FORBIDDEN', `This API key is missing the '${scope}' scope`)
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
