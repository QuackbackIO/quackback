import type { Actor, Decision } from './types'
import { allowDecision, denyDecision } from './types'
import { resolveActorPermissions } from './permissions'
import type { PermissionKey } from '@/lib/shared/permissions'

/**
 * The single permission predicate. Every converted route gate and policy branch
 * funnels through `can` / `authorize` instead of reading a role string.
 *
 * Uses the actor's resolved (assignment-derived) `permissions` when present —
 * real request actors set it via policyActorFromAuth, so custom roles are
 * honoured here. The role fallback covers the inline actor fixtures the policy
 * layer builds without threading a permission set through every one; those are
 * preset-shaped by construction, so the legacy expansion is exact for them.
 *
 * This is a capability-level guard only: deciding WHICH rows an actor may act on
 * ('own' / 'team' / 'all') is the job of the SQL `xFilter(actor)` predicates (see
 * policy/tickets.ts `ticketFilter`, policy/conversations.ts `conversationFilter`),
 * never this guard.
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
