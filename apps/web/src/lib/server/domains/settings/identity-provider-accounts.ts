/**
 * Identities linked to an identity provider.
 *
 * Its own module rather than another read on `identity-providers.service`
 * because it is the one query in this area that leaves the provider tables:
 * it counts `account` rows, joined on `registrationId` (what
 * `account.provider_id` actually carries, and the leading column of
 * `account_provider_account_idx`) rather than the provider's row id.
 *
 * `deleteIdentityProvider` refuses outright while any identity references the
 * provider, since removal would orphan people whose accounts have no other way
 * back. The admin surface reads this first so the Remove control can state the
 * cost up front instead of surfacing it as a failed delete.
 */
import {
  account,
  and,
  count,
  db,
  eq,
  identityProvider,
  inArray,
  isNotNull,
  isNull,
  ne,
  permissions,
  principal,
  principalRoleAssignments,
  rolePermissions,
  roles,
  ssoVerifiedDomain,
  user,
} from '@/lib/server/db'
import type { IdentityProviderId, PrincipalId, RoleId } from '@quackback/ids'
import { realEmail } from '@/lib/shared/anonymous-email'
import { canManageSso, isAdminTierBundle } from '@/lib/shared/sso-claim-mapping-edit'
import { roleMappingFor } from '@/lib/shared/oidc-claim-mapping'
import type { Role } from '@/lib/shared/roles'
import { emailDomain } from '@/lib/server/auth/normalize-domain'
import { logger } from '@/lib/server/logger'
import { wrapDbError } from './settings.helpers'

const log = logger.child({ component: 'identity-provider-accounts' })

/** Zero when the provider does not exist. */
export async function countProviderAccounts(id: IdentityProviderId): Promise<number> {
  try {
    const [row] = await db
      .select({ n: count() })
      .from(account)
      .innerJoin(identityProvider, eq(account.providerId, identityProvider.registrationId))
      .where(eq(identityProvider.id, id))
    return row?.n ?? 0
  } catch (error) {
    log.error({ err: error }, 'count identity provider accounts failed')
    wrapDbError('count identity provider accounts', error)
  }
}

/** A teammate who signs in through one provider, and whether they hold admin-level access. */
export type ProviderAdmin = {
  principalId: string
  name: string
  /** A deliverable address only; synthetic placeholders read as null. */
  email: string | null
  role: 'admin' | 'member'
  /** The workspace role a member-tier teammate holds. */
  roleId?: string
  roleName?: string
  /** The admin tier, or a member-tier role whose bundle reaches it. */
  adminTier: boolean
  /** Holds the permission that manages SSO, so could fix this provider. */
  canManageSso: boolean
  /** Their address is at one of this provider's verified domains, where the
   *  default role applies when no rule matches. */
  atVerifiedDomain: boolean
  isCaller: boolean
}

/** Each role's permission keys. */
async function permissionKeysByRole(roleIds: readonly string[]): Promise<Map<string, string[]>> {
  const keysOf = new Map<string, string[]>()
  if (roleIds.length === 0) return keysOf
  const rows = await db
    .select({ roleId: rolePermissions.roleId, key: permissions.key })
    .from(rolePermissions)
    .innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
    .where(inArray(rolePermissions.roleId, roleIds as RoleId[]))
  for (const row of rows) keysOf.set(row.roleId, [...(keysOf.get(row.roleId) ?? []), row.key])
  return keysOf
}

/**
 * The teammates with an identity at this provider, for the role rules'
 * lockout guard: a rule change that drops every admin-tier person here could
 * leave nobody able to undo it. Support principals are not on the customer
 * roster and are left out. Empty when the provider does not exist.
 */
export async function listProviderAdmins(
  id: IdentityProviderId,
  callerPrincipalId: PrincipalId | null
): Promise<ProviderAdmin[]> {
  try {
    const people = await db
      .selectDistinct({
        principalId: principal.id,
        role: principal.role,
        displayName: principal.displayName,
        name: user.name,
        email: user.email,
      })
      .from(account)
      .innerJoin(identityProvider, eq(account.providerId, identityProvider.registrationId))
      .innerJoin(principal, eq(principal.userId, account.userId))
      .innerJoin(user, eq(user.id, account.userId))
      .where(
        and(
          eq(identityProvider.id, id),
          inArray(principal.role, ['admin', 'member']),
          ne(principal.type, 'support')
        )
      )
    if (people.length === 0) return []

    const assignments = await db
      .select({
        principalId: principalRoleAssignments.principalId,
        roleId: roles.id,
        roleName: roles.name,
      })
      .from(principalRoleAssignments)
      .innerJoin(roles, eq(roles.id, principalRoleAssignments.roleId))
      .where(
        and(
          inArray(
            principalRoleAssignments.principalId,
            people.map((p) => p.principalId)
          ),
          isNull(principalRoleAssignments.teamId)
        )
      )
    const assignmentOf = new Map(assignments.map((a) => [a.principalId as string, a]))
    const keysOf = await permissionKeysByRole([
      ...new Set(assignments.map((a) => a.roleId as string)),
    ])
    const verifiedDomains = new Set(
      (
        await db
          .select({ name: ssoVerifiedDomain.name })
          .from(ssoVerifiedDomain)
          .where(and(eq(ssoVerifiedDomain.providerId, id), isNotNull(ssoVerifiedDomain.verifiedAt)))
      ).map((d) => d.name)
    )

    return people.map((p) => {
      const role = p.role === 'admin' ? 'admin' : 'member'
      const email = realEmail(p.email)
      const domain = emailDomain(email)
      const entry: ProviderAdmin = {
        principalId: p.principalId,
        name: p.displayName ?? p.name,
        email,
        role,
        adminTier: role === 'admin',
        canManageSso: role === 'admin',
        atVerifiedDomain: domain !== null && verifiedDomains.has(domain),
        isCaller: p.principalId === callerPrincipalId,
      }
      const assigned = role === 'member' ? assignmentOf.get(p.principalId) : undefined
      if (assigned) {
        const keys = keysOf.get(assigned.roleId) ?? []
        entry.roleId = assigned.roleId
        entry.roleName = assigned.roleName
        entry.adminTier = isAdminTierBundle(keys)
        entry.canManageSso = canManageSso(keys)
      }
      return entry
    })
  } catch (error) {
    log.error({ err: error }, 'list identity provider admins failed')
    wrapDbError('list identity provider admins', error)
  }
}

/**
 * How many people a role mapping would lock out of managing SSO. With sync on,
 * every sign-in re-applies the provider's roles. When no rule can give a role
 * that manages SSO and the default role is not admin, each teammate who
 * manages SSO today and signs in from a verified domain is demoted to the
 * default on their next sign-in. People outside the verified domains who match
 * no rule are left alone by sign-in, so they do not count. Zero when safe.
 */
export async function syncLockoutCount(
  id: IdentityProviderId,
  mapping: unknown,
  defaultRole: Role | null
): Promise<number> {
  const role = roleMappingFor(mapping)
  if (!role?.syncOnEverySignIn || defaultRole === 'admin') return 0
  if (role.rules.some((r) => r.role === 'admin')) return 0
  const ruleRoleIds = [...new Set(role.rules.flatMap((r) => (r.roleId ? [r.roleId] : [])))]
  const keysOf = await permissionKeysByRole(ruleRoleIds)
  if (ruleRoleIds.some((roleId) => canManageSso(keysOf.get(roleId) ?? []))) return 0
  const people = await listProviderAdmins(id, null)
  return people.filter((p) => p.canManageSso && p.atVerifiedDomain).length
}
