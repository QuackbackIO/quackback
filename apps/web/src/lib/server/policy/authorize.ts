import type { Actor, Decision } from './types'
import { allowDecision, denyDecision } from './types'
import type { PermissionKey } from '@/lib/shared/permissions'

/**
 * The single permission predicate. Every converted route gate and policy branch
 * funnels through `can` / `authorize` instead of reading a role string, so when
 * resolution moves from preset expansion to assignment joins (the custom-role
 * era) no call site changes.
 */
export function can(actor: Actor, permission: PermissionKey): boolean {
  return actor.permissions?.has(permission) ?? false
}

/**
 * Decision-returning form, mirroring the `canX(actor, resource): Decision` shape
 * used across the policy modules so the deny case carries a machine-readable
 * reason for logging and UI hints.
 */
export function authorize(actor: Actor, permission: PermissionKey): Decision {
  return can(actor, permission)
    ? allowDecision()
    : denyDecision(`insufficient_permission:${permission}`)
}
