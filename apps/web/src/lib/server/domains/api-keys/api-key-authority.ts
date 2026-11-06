/**
 * The authority an API key carries on a request.
 *
 * A workspace key belongs to nobody: its authority is its own workspace role
 * (a role assignment on its service principal), and nobody joining or leaving
 * changes it. Revoking it demotes that principal, which ends it.
 *
 * A personal key acts for the teammate who created it, so its authority is the
 * intersection of the key's own role preset and that person's current
 * permission set, resolved exactly as a signed-in session resolves it (custom
 * roles included). Key scopes narrow it further at each gate. A key whose
 * creator is gone, is no longer on the team, or is blocked carries no
 * authority and is refused like an unknown key. Every key records its creator
 * when it is made, and deleting that person clears the column, so a key with
 * no recorded creator is a deleted person's key and is refused too.
 *
 * The REST API (`domains/api/auth.ts`) and the MCP endpoint
 * (`mcp/handler.ts`, `mcp/resolve-actor.ts`) both resolve keys here, so the
 * two surfaces cannot disagree about what a key may do.
 */
import { db, eq, inArray, principal, type Principal, type user } from '@/lib/server/db'
import type { PrincipalId } from '@quackback/ids'
import { permissionsForPrincipal, resolveActorPermissions } from '@/lib/server/policy/permissions'
import type { PermissionKey } from '@/lib/shared/permissions'
import { isTeamMember, type Role } from '@/lib/shared/roles'
import { logger } from '@/lib/server/logger'
import type { ApiKey } from './api-key.types'

const log = logger.child({ component: 'api-key-authority' })

/** A principal row as read for a key, with any linked user. */
export type ApiKeyPrincipal = Principal & { user: typeof user.$inferSelect | null }

export interface ApiKeyAuthority {
  /** The key's own principal (with any linked user), or null when it is missing. */
  principal: ApiKeyPrincipal | null
  /** The creator a personal key acts for; null for a workspace key. */
  owner: ApiKeyPrincipal | null
  /** The key's role, capped at its creator's current role. */
  role: Role
  /** The key's role preset intersected with its creator's current permissions. */
  permissions: ReadonlySet<PermissionKey>
  /**
   * The teammate whose row scope the key's requests follow: the creator, for a
   * personal key, so lists and per-item checks see exactly what that teammate
   * sees. Null for a workspace key, which is workspace-wide within its role.
   */
  scopePrincipalId: PrincipalId | null
}

const ROLE_RANK: Record<Role, number> = { user: 0, member: 1, admin: 2 }

function lowerRole(a: Role, b: Role): Role {
  return ROLE_RANK[a] <= ROLE_RANK[b] ? a : b
}

/** A creator vouches for their keys only while they are an unblocked human teammate. */
function isActiveTeammate(row: Principal | undefined): row is ApiKeyPrincipal {
  return !!row && row.type === 'user' && isTeamMember(row.role) && row.blockedAt === null
}

/** Keys already reported as having no recorded creator, so each warns once per process. */
const reportedCreatorless = new Set<string>()

function reportCreatorless(keyId: string): void {
  if (reportedCreatorless.has(keyId)) return
  reportedCreatorless.add(keyId)
  log.warn(
    { api_key_id: keyId },
    'Refused an API key whose owner no longer exists. Revoke it and create a replacement from a current teammate.'
  )
}

/**
 * Resolve a verified key's authority, or null when the key must be refused.
 * Reads the key's principal and its creator in one query, then the creator's
 * workspace grants in one more; nothing scales with the request.
 */
export async function resolveApiKeyAuthority(
  key: Pick<ApiKey, 'id' | 'principalId' | 'createdById'> & { kind?: ApiKey['kind'] }
): Promise<ApiKeyAuthority | null> {
  if (key.kind === 'workspace') return resolveWorkspaceKeyAuthority(key.principalId)
  if (!key.createdById) {
    reportCreatorless(key.id)
    return null
  }

  const ids = [key.principalId]
  if (key.createdById !== key.principalId) ids.push(key.createdById)
  const rows = await db.query.principal.findMany({
    where: inArray(principal.id, ids),
    with: { user: true },
  })
  const owner = rows.find((row) => row.id === key.createdById)
  if (!isActiveTeammate(owner)) return null

  const keyPrincipal = rows.find((row) => row.id === key.principalId) ?? null
  const keyRole = (keyPrincipal?.role as Role | undefined) ?? 'user'

  const ownerRole = owner.role as Role
  const preset = resolveActorPermissions(keyRole)
  const held = await permissionsForPrincipal(owner.id, ownerRole)
  return {
    principal: keyPrincipal,
    owner,
    role: lowerRole(keyRole, ownerRole),
    permissions: new Set([...held].filter((permission) => preset.has(permission))),
    scopePrincipalId: owner.id,
  }
}

/**
 * A workspace key's authority is its own role. Its principal stays a team role
 * while the key is live; revoking the key demotes it to `user`, so a missing or
 * demoted principal is refused like an unknown key.
 */
async function resolveWorkspaceKeyAuthority(
  principalId: ApiKey['principalId']
): Promise<ApiKeyAuthority | null> {
  const keyPrincipal = await db.query.principal.findFirst({
    where: eq(principal.id, principalId),
    with: { user: true },
  })
  if (!keyPrincipal || keyPrincipal.type !== 'service' || !isTeamMember(keyPrincipal.role))
    return null
  const role = keyPrincipal.role as Role
  return {
    principal: keyPrincipal,
    owner: null,
    role,
    permissions: await permissionsForPrincipal(keyPrincipal.id, role),
    scopePrincipalId: null,
  }
}
