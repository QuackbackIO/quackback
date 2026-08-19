/**
 * The two workflow actor permission sets, co-located for one shared
 * provenance: `AUTOMATION_PERMISSIONS` is the base ceiling every workflow
 * action runs under (workflow.engine.ts's workflowActor), and
 * `TICKET_ACTION_PERMISSIONS` is a deliberate, narrow widening of that
 * ceiling for exactly the two ticket actions that need it
 * (action.executor.ts's ticketActionActor). Neither set changes semantics by
 * moving here — this is a least-privilege scoping decision (a shared base
 * ceiling, widened only where a specific action needs more), now readable in
 * one place instead of split across the engine and the executor.
 */
import { PERMISSIONS, type PermissionKey } from '@/lib/shared/permissions'

/**
 * The bounded authority a workflow acts with: exactly the support actions the v1
 * catalogue applies, named explicitly rather than inheriting the whole admin role
 * — so the ceiling stays intentional and can't silently widen as admin grows. A
 * workflow can act on conversations but nothing outside support.
 */
export const AUTOMATION_PERMISSIONS: ReadonlySet<PermissionKey> = new Set([
  PERMISSIONS.CONVERSATION_VIEW,
  PERMISSIONS.CONVERSATION_VIEW_ALL,
  PERMISSIONS.CONVERSATION_REPLY, // the canActAsAgent gate every action passes
  PERMISSIONS.CONVERSATION_ASSIGN,
  PERMISSIONS.CONVERSATION_SET_STATUS,
  PERMISSIONS.CONVERSATION_SET_TAGS,
  PERMISSIONS.CONVERSATION_SET_ATTRIBUTES,
  PERMISSIONS.SLA_MANAGE,
])

/**
 * Ticket action permissions (set_ticket_status / convert_to_ticket): the
 * engine's own bounded service actor (AUTOMATION_PERMISSIONS above) predates
 * ticket actions and carries no `ticket.*` keys — rather than widen that
 * shared ceiling for every other workflow action too, these two actions
 * widen ONLY their own actor, locally, to add exactly the two ticket
 * permissions they need. A human actor (a macro calling applyAction
 * directly) already carries its real permission set via role and passes
 * through unchanged — neither action is in the macro catalogue today
 * (workflow.schemas.ts's actionSchema is workflows-only, like `reopen`
 * before it), so in practice this only ever widens the engine's own service
 * actor.
 */
export const TICKET_ACTION_PERMISSIONS: ReadonlySet<PermissionKey> = new Set([
  PERMISSIONS.TICKET_SET_STATUS,
  PERMISSIONS.TICKET_CREATE,
])
