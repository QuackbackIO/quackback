import type { PrincipalId, UserId } from '@quackback/ids'
import {
  and,
  db,
  eq,
  inArray,
  isNull,
  principal,
  ssoRecoveryCode,
  type Database,
  type Transaction,
} from '@/lib/server/db'
import { recordAuditEvent, recordAuditEventInTransaction } from '@/lib/server/audit/log'
import { logger } from '@/lib/server/logger'
import { permissionsForPrincipal, permissionsForPrincipals } from '@/lib/server/policy/permissions'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { isTeamMember, type Role } from '@/lib/shared/roles'

const log = logger.child({ component: 'recovery-codes' })

type Executor = Database | Transaction

/**
 * Whether a person may use recovery codes right now: on the team and holding
 * `auth.manage`, the permission that generates them.
 *
 * Codes are break-glass for the people who manage sign-in. Removing or
 * demoting someone moves `principal.role`; it does not reach their codes, so
 * the codes themselves cannot be the authority on whether they still work.
 * Both checks, because a person off the team keeps no team permissions
 * whatever their role assignments still say.
 */
export async function isRecoveryCodeHolder(
  userId: UserId,
  executor: Executor = db
): Promise<boolean> {
  const [row] = await executor
    .select({ id: principal.id, role: principal.role })
    .from(principal)
    .where(eq(principal.userId, userId))
    .limit(1)
  if (!row || !isTeamMember(row.role)) return false
  const keys = await permissionsForPrincipal(row.id as PrincipalId, row.role as Role, executor)
  return keys.has(PERMISSIONS.AUTH_MANAGE)
}

/** True when the workspace has at least one unused recovery code — the
 *  break-glass guarantee before SSO can be made the only way in.
 *
 *  Workspace-scoped (no userId filter): any admin's active codes count,
 *  because any admin can use their codes to unblock access for others. Only
 *  codes someone may still use count (see {@link isRecoveryCodeHolder}): the
 *  codes of a person removed from the team are no way back in. */
export async function hasActiveRecoveryCodes(): Promise<boolean> {
  const holders = await db
    .selectDistinct({ id: principal.id, role: principal.role })
    .from(ssoRecoveryCode)
    .innerJoin(principal, eq(principal.userId, ssoRecoveryCode.userId))
    .where(and(isNull(ssoRecoveryCode.usedAt), inArray(principal.role, ['admin', 'member'])))
  if (holders.length === 0) return false
  const keys = await permissionsForPrincipals(
    holders.map((h) => ({ id: h.id as PrincipalId, role: h.role as Role }))
  )
  return [...keys.values()].some((set) => set.has(PERMISSIONS.AUTH_MANAGE))
}

/**
 * Delete a person's recovery codes once they may no longer use them. Called by
 * the role writer after a role change, inside its transaction, so a removal or
 * demotion takes the codes with it.
 */
export async function invalidateRecoveryCodesOfFormerHolder(
  executor: Executor,
  userId: UserId
): Promise<void> {
  if (await isRecoveryCodeHolder(userId, executor)) return
  const removed = await executor
    .delete(ssoRecoveryCode)
    .where(eq(ssoRecoveryCode.userId, userId))
    .returning({ id: ssoRecoveryCode.id })
  if (removed.length === 0) return
  log.info({ userId, count: removed.length }, 'recovery codes invalidated: holder left the role')
  const event = {
    event: 'sso.recovery_codes.invalidated' as const,
    outcome: 'success' as const,
    actor: { type: 'system' as const },
    target: { type: 'user', id: userId },
    metadata: { count: removed.length, reason: 'holder_role_changed' },
  }
  if ('rollback' in executor) await recordAuditEventInTransaction(executor, event)
  else await recordAuditEvent(event)
}
