/**
 * Custom roles past the plan's cap, after the plan limits grace.
 *
 * The roles stay, and everyone already on one keeps exactly the access it
 * gives. What stops is change: a custom role cannot be edited, and cannot be
 * given to anyone who does not already hold it. Deleting one, or moving
 * someone onto a built-in role, stays open, since those are how the workspace
 * gets back under the cap.
 */
import { TierLimitError } from '@/lib/server/errors/tier-limit-error'

/** Whether custom roles are held now. Fails open (the plan limits helpers do). */
export async function customRolesLocked(): Promise<boolean> {
  const { isCapEnforced } = await import('@/lib/server/domains/plan-limits/plan-limits.service')
  return isCapEnforced('maxCustomRoles')
}

function lockedError(message: string): TierLimitError {
  return new TierLimitError({ limit: 'maxCustomRoles', code: 'CUSTOM_ROLES_LOCKED', message })
}

/** Refuse an edit to a custom role while custom roles are held. */
export async function assertCustomRoleEditable(role: { isSystem: boolean }): Promise<void> {
  if (role.isSystem || !(await customRolesLocked())) return
  throw lockedError(
    "Custom roles can't be edited on your current plan. People on them keep their access."
  )
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
  throw lockedError(
    "Custom roles can't be given to anyone new on your current plan. Pick a built-in role."
  )
}
