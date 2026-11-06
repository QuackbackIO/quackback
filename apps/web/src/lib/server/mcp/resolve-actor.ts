import { db, eq, principal, apiKeys } from '@/lib/server/db'
import { permissionsForPrincipal } from '@/lib/server/policy/permissions'
import { resolveApiKeyAuthority } from '@/lib/server/domains/api-keys/api-key-authority'
import { hasApiScope, parseApiKeyScopes } from '@/lib/shared/api-key-scopes'
import type { PermissionKey } from '@/lib/shared/permissions'
import type { Role } from '@/lib/shared/roles'
import type { PrincipalId } from '@quackback/ids'
import type { Actor } from '@/lib/server/policy/types'
import type { McpAuthContext, McpScope } from './types'
import { ForbiddenError } from '@/lib/shared/errors'

function ownerRequired(): ForbiddenError {
  return new ForbiddenError(
    'MCP_SETTINGS_OWNER_REQUIRED',
    'A current workspace owner must review this request.'
  )
}

/**
 * Current assignments and key scopes cap every settings and navigation call.
 * A personal API key resolves to the teammate who created it, and a workspace
 * key to itself, with the same authority the REST API grants the key (see
 * resolveApiKeyAuthority).
 */
export async function resolveMcpActor(
  auth: McpAuthContext,
  requiredScope?: McpScope
): Promise<Actor> {
  const [record] = await db
    .select({ id: principal.id, role: principal.role, type: principal.type })
    .from(principal)
    .where(eq(principal.id, auth.principalId))
    .limit(1)
  if (!record || (record.role !== 'admin' && record.role !== 'member'))
    throw new ForbiddenError('MCP_TEAM_MEMBER_REQUIRED', 'This operation requires a team member.')

  const ceiling = auth.permissions
  const actor = (
    principalId: PrincipalId,
    role: Role,
    held: ReadonlySet<PermissionKey>
  ): Actor => ({
    principalId,
    role,
    principalType: 'user',
    segmentIds: new Set(),
    permissions: new Set(
      [...held].filter((permission) => ceiling === undefined || ceiling.has(permission))
    ),
  })

  if (record.type !== 'service') {
    const role = record.role as Role
    return actor(record.id, role, await permissionsForPrincipal(record.id, role))
  }

  const [key] = await db.select().from(apiKeys).where(eq(apiKeys.principalId, record.id)).limit(1)
  if (
    !key ||
    key.revokedAt ||
    (key.expiresAt && key.expiresAt.getTime() <= Date.now()) ||
    (requiredScope && !hasApiScope(parseApiKeyScopes(key.scopes), requiredScope))
  )
    throw ownerRequired()
  const authority = await resolveApiKeyAuthority(key)
  if (!authority) throw ownerRequired()
  // A personal key acts as its creator; a workspace key acts as itself.
  if (!authority.owner) {
    return { ...actor(record.id, authority.role, authority.permissions), principalType: 'service' }
  }
  return actor(authority.owner.id, authority.role, authority.permissions)
}
