/**
 * Who holds a role, for the role writers and the inbox scope signal they send
 * after commit (realtime/inbox-scope-invalidate.ts). Kept beside the role
 * service but in its own module so the service stays within size bounds.
 */
import { eq, principalRoleAssignments, type Database, type Transaction } from '@/lib/server/db'
import type { PrincipalId, RoleId } from '@quackback/ids'

export interface RoleHolders {
  /** Holders of the workspace-wide assignment (no team), the ones a reassign moves. */
  workspaceWide: PrincipalId[]
  /** Every principal holding the role at any scope, each once. */
  all: PrincipalId[]
}

/** One read of a role's assignments. */
export async function roleHolders(
  exec: Database | Transaction,
  roleId: RoleId
): Promise<RoleHolders> {
  const rows = await exec
    .select({
      principalId: principalRoleAssignments.principalId,
      teamId: principalRoleAssignments.teamId,
    })
    .from(principalRoleAssignments)
    .where(eq(principalRoleAssignments.roleId, roleId))
  return {
    workspaceWide: rows.filter((r) => r.teamId === null).map((r) => r.principalId),
    all: [...new Set(rows.map((r) => r.principalId))],
  }
}
