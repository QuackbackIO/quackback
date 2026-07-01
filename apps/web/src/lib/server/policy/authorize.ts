import type { Actor, Decision } from './types'
import { allowDecision, denyDecision } from './types'
import { resolveActorPermissions } from './permissions'
import type { PermissionKey } from '@/lib/shared/permissions'

/**
 * The single permission predicate. Every converted route gate and policy branch
 * funnels through `can` / `authorize` instead of reading a role string.
 *
 * Uses the actor's resolved `permissions` when present (real request actors set
 * it via policyActorFromAuth); otherwise falls back to resolving from the actor's
 * role. In v1 permissions are a pure function of role, so both paths agree — this
 * keeps `can` correct for the inline actor fixtures the policy layer builds
 * without threading a permission set through every one. When resolution becomes
 * assignment-derived, populated actors take precedence and the seams populate.
 */
export function can(actor: Actor, permission: PermissionKey): boolean {
  return (actor.permissions ?? resolveActorPermissions(actor.role)).has(permission)
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
