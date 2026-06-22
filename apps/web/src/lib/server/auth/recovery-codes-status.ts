import { db, isNull, ssoRecoveryCode } from '@/lib/server/db'

/** True when the workspace has at least one unused recovery code — the
 *  break-glass guarantee before SSO can be made the only way in.
 *
 *  Workspace-scoped (no userId filter): any admin's active codes count,
 *  because any admin can use their codes to unblock access for others. */
export async function hasActiveRecoveryCodes(): Promise<boolean> {
  const rows = await db
    .select({ id: ssoRecoveryCode.id })
    .from(ssoRecoveryCode)
    .where(isNull(ssoRecoveryCode.usedAt))
    .limit(1)
  return rows.length > 0
}
