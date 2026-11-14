/**
 * Who holds a role, for the inbox scope signal a role edit or delete sends
 * after it commits (realtime/inbox-scope-invalidate.ts). Kept beside the role
 * service but in its own module so the service stays within size bounds.
 */
import { eq, principalRoleAssignments, type Database, type Transaction } from '@/lib/server/db'
import type { PrincipalId, RoleId } from '@quackback/ids'

/** Every principal holding `roleId`, at any scope. */
export async function roleHolderPrincipalIds(
  exec: Database | Transaction,
  roleId: RoleId
): Promise<PrincipalId[]> {
  const rows = await exec
    .selectDistinct({ principalId: principalRoleAssignments.principalId })
    .from(principalRoleAssignments)
    .where(eq(principalRoleAssignments.roleId, roleId))
  return rows.map((r) => r.principalId)
}
