import { db, eq, principal, apiKeys } from '@/lib/server/db'
import { permissionsForPrincipal } from '@/lib/server/policy/permissions'
import { hasApiScope, parseApiKeyScopes } from '@/lib/shared/api-key-scopes'
import type { Actor } from '@/lib/server/policy/types'
import type { McpAuthContext, McpScope } from './types'
import { ForbiddenError } from '@/lib/shared/errors'

/** Current assignments and key scopes cap every settings and navigation call. */
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
  let person = record
  const servicePermissions = await permissionsForPrincipal(record.id, record.role)
  if (record.type === 'service') {
    const [key] = await db.select().from(apiKeys).where(eq(apiKeys.principalId, record.id)).limit(1)
    if (
      !key?.createdById ||
      key.revokedAt ||
      (key.expiresAt && key.expiresAt.getTime() <= Date.now()) ||
      (requiredScope && !hasApiScope(parseApiKeyScopes(key.scopes), requiredScope))
    )
      throw new ForbiddenError(
        'MCP_SETTINGS_OWNER_REQUIRED',
        'A current workspace Owner must review this request.'
      )
    const [owner] = await db
      .select({ id: principal.id, role: principal.role, type: principal.type })
      .from(principal)
      .where(eq(principal.id, key.createdById))
      .limit(1)
    if (!owner || owner.type !== 'user' || (owner.role !== 'admin' && owner.role !== 'member'))
      throw new ForbiddenError(
        'MCP_SETTINGS_OWNER_REQUIRED',
        'A current workspace Owner must review this request.'
      )
    person = owner
  }
  const permissions = await permissionsForPrincipal(person.id, person.role as 'admin' | 'member')
  const ceiling = auth.permissions
  const effective = new Set(
    [...permissions].filter(
      (permission) =>
        servicePermissions.has(permission) && (ceiling === undefined || ceiling.has(permission))
    )
  )
  return {
    principalId: person.id,
    role: person.role as 'admin' | 'member',
    principalType: 'user',
    segmentIds: new Set(),
    permissions: effective,
  }
}
