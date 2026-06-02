import { db, principal, inArray } from '@/lib/server/db'
import { isTeamMember } from '@/lib/shared/roles'
import { listOnlineAgentIds } from '@/lib/server/realtime/presence'
import type { RoutingContext, RoutingResult, RoutingStrategy } from '../routing.types'

export const AUTO_ASSIGN_ACTIVE = 'auto_assign_active'

/**
 * Assign to an agent who currently has a live inbox stream. Picks the
 * lexicographically-first online team member (deterministic tie-break — no
 * load-balancing yet). Returns a null assignment when no agent is online, so
 * the conversation simply stays unassigned for someone to pick up.
 */
export const autoAssignActiveStrategy: RoutingStrategy = {
  id: AUTO_ASSIGN_ACTIVE,
  async route(_ctx: RoutingContext): Promise<RoutingResult> {
    const onlineIds = await listOnlineAgentIds()
    if (onlineIds.length === 0) {
      return { assignedPrincipalId: null, strategyId: AUTO_ASSIGN_ACTIVE }
    }
    // The agents zset only holds principals marked as agents on stream open, but
    // filter by role defensively so we never assign a conversation to a visitor.
    const rows = await db
      .select({ id: principal.id, role: principal.role })
      .from(principal)
      .where(inArray(principal.id, onlineIds))
    const agents = rows
      .filter((r) => isTeamMember(r.role))
      .map((r) => r.id)
      .sort()
    return { assignedPrincipalId: agents[0] ?? null, strategyId: AUTO_ASSIGN_ACTIVE }
  },
}
