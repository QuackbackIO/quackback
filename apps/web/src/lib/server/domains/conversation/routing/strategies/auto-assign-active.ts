import { db, principal, conversations, inArray, eq, and } from '@/lib/server/db'
import { isTeamMember } from '@/lib/shared/roles'
import { listOnlineAgentIds } from '@/lib/server/realtime/presence'
import type { PrincipalId } from '@quackback/ids'
import type { RoutingContext, RoutingResult, RoutingStrategy } from '../routing.types'

export const AUTO_ASSIGN_ACTIVE = 'auto_assign_active'

/**
 * Choose the candidate carrying the fewest open conversations, so a burst of
 * new (or re-queued) conversations spreads across the team instead of piling
 * onto one agent. Ties break lexicographically for determinism. Pure, so the
 * balancing rule is unit-tested directly.
 */
export function pickLeastLoaded(
  candidates: PrincipalId[],
  openLoad: Map<PrincipalId, number>
): PrincipalId | null {
  if (candidates.length === 0) return null
  return [...candidates].sort((a, b) => {
    const byLoad = (openLoad.get(a) ?? 0) - (openLoad.get(b) ?? 0)
    return byLoad !== 0 ? byLoad : a < b ? -1 : a > b ? 1 : 0
  })[0]
}

/**
 * Assign to an agent who currently has a live inbox stream, preferring the
 * least-loaded so work spreads across the online team. Returns a null
 * assignment when no agent is online, so the conversation simply stays
 * unassigned for someone to pick up.
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
      // Exclude agents who manually set themselves "away" — connected but opted
      // out of routing.
      .where(and(inArray(principal.id, onlineIds), eq(principal.chatAvailability, 'online')))
    const candidates = rows.filter((r) => isTeamMember(r.role)).map((r) => r.id)
    if (candidates.length === 0) {
      return { assignedPrincipalId: null, strategyId: AUTO_ASSIGN_ACTIVE }
    }
    // Current open-conversation load per candidate (rows counted in app code;
    // chat volume is low). A candidate with no open conversations is absent → 0.
    const loadRows = await db
      .select({ agent: conversations.assignedAgentPrincipalId })
      .from(conversations)
      .where(
        and(
          inArray(conversations.assignedAgentPrincipalId, candidates),
          eq(conversations.status, 'open')
        )
      )
    const openLoad = new Map<PrincipalId, number>()
    for (const r of loadRows) {
      if (r.agent) openLoad.set(r.agent, (openLoad.get(r.agent) ?? 0) + 1)
    }
    return {
      assignedPrincipalId: pickLeastLoaded(candidates, openLoad),
      strategyId: AUTO_ASSIGN_ACTIVE,
    }
  },
}
