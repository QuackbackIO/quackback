/**
 * Custom roles past the plan's cap, after the plan limits grace.
 *
 * The roles stay, and everyone already on one keeps exactly the access it
 * gives. What stops is change: a custom role cannot be edited, and cannot be
 * given to anyone who does not already hold it. Deleting one, or moving
 * someone onto a built-in role, stays open, since those are how the workspace
 * gets back under the cap.
 */
import type { RoleId } from '@quackback/ids'
import { db, eq, roles } from '@/lib/server/db'
import { TierLimitError } from '@/lib/server/errors/tier-limit-error'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'role-plan-lock' })

/** Whether custom roles are held now. Fails open (the plan limits helpers do). */
export async function customRolesLocked(): Promise<boolean> {
  try {
    const { isCapEnforced } = await import('@/lib/server/domains/plan-limits/plan-limits.service')
    return await isCapEnforced('maxCustomRoles')
  } catch (err) {
    log.error({ err }, 'custom role plan check failed; failing open')
    return false
  }
}

/** "Custom roles are locked on the Free plan.", naming the plan when it is known. */
export function customRolesLockedLine(planName: string | null): string {
  return `Custom roles are locked${planName ? ` on the ${planName} plan` : ''}.`
}

async function lockedLine(): Promise<string> {
  const { currentPlanName } = await import('@/lib/server/domains/plan-limits/plan-limits.copy')
  return customRolesLockedLine(await currentPlanName())
}

function lockedError(message: string): TierLimitError {
  return new TierLimitError({ limit: 'maxCustomRoles', code: 'CUSTOM_ROLES_LOCKED', message })
}

/** Refuse an edit to a custom role while custom roles are held. */
export async function assertCustomRoleEditable(role: { isSystem: boolean }): Promise<void> {
  if (role.isSystem || !(await customRolesLocked())) return
  throw lockedError(`${await lockedLine()} People on them keep their access.`)
}

/**
 * Refuse giving a custom role to someone new while custom roles are held.
 * `alreadyHeld` is true when the person holds that role now, which is no
 * change at all.
 */
export async function assertCustomRoleAssignable(
  role: { isSystem: boolean },
  alreadyHeld = false
): Promise<void> {
  if (role.isSystem || alreadyHeld || !(await customRolesLocked())) return
  throw lockedError(`${await lockedLine()} Pick a built-in role.`)
}

/**
 * Whether `roleId` is a custom role the plan holds now, so it goes to nobody
 * new. For a grant made long after it was chosen (an invitation accepted after
 * the grace), which falls back to the plain member role instead of failing.
 */
export async function isCustomRoleHeld(roleId: RoleId): Promise<boolean> {
  if (!(await customRolesLocked())) return false
  const [row] = await db
    .select({ isSystem: roles.isSystem })
    .from(roles)
    .where(eq(roles.id, roleId))
    .limit(1)
  return !!row && !row.isSystem
}
