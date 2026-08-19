/**
 * Team distribution: when a conversation is assigned to a team, pick which
 * member (if any) it should land on, per the team's assignment_method (§4.12).
 *
 * - manual      — assign the team only; no member pick.
 * - round_robin — rotate over the team's currently-online members, persisting a
 *                 cursor on the team so arrivals spread evenly.
 * - balanced    — the existing least-loaded strategy, scoped to online members.
 *
 * Fires once, on team-assignment. Fails soft: any presence/DB error yields a
 * null pick, so the conversation is simply assigned to the team with no member.
 */
import type { Team } from '@/lib/server/db'
import type { PrincipalId } from '@quackback/ids'
import { listOnlineAgentIds, listAvailableAgentIds } from '@/lib/server/realtime/presence'
import { pickLeastLoaded, countOpenConversationLoad } from './strategies/auto-assign-active'
import { listTeamMemberPrincipalIds, setRoundRobinCursor } from '@/lib/server/domains/teams'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'team-distribution' })

/**
 * Rotate to the next member after the cursor in a stable (lexicographic) order.
 * A cursor no longer in the candidate set (member went offline / was removed)
 * restarts the rotation from the top.
 */
export function pickRoundRobin(
  candidates: PrincipalId[],
  cursor: PrincipalId | null
): PrincipalId | null {
  if (candidates.length === 0) return null
  const sorted = [...candidates].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
  if (!cursor) return sorted[0]
  const idx = sorted.indexOf(cursor)
  if (idx === -1) return sorted[0]
  return sorted[(idx + 1) % sorted.length]
}

/**
 * Pick a member for a team-assigned conversation, or null (manual method, no
 * online members, or a soft failure). Persists the round-robin cursor.
 */
export async function distributeToTeamMember(team: Team): Promise<PrincipalId | null> {
  if (team.assignmentMethod === 'manual') return null
  try {
    const memberIds = await listTeamMemberPrincipalIds(team.id)
    if (memberIds.length === 0) return null
    // Online AND available (not manually "away"), intersected with the roster.
    const available = await listAvailableAgentIds(await listOnlineAgentIds())
    const memberSet = new Set(memberIds)
    const candidates = available.filter((id) => memberSet.has(id))
    if (candidates.length === 0) return null

    if (team.assignmentMethod === 'round_robin') {
      const picked = pickRoundRobin(candidates, team.rrCursorPrincipalId)
      if (picked) await setRoundRobinCursor(team.id, picked)
      return picked
    }
    // balanced
    const load = await countOpenConversationLoad(candidates)
    return pickLeastLoaded(candidates, load)
  } catch (err) {
    log.warn({ err, team_id: team.id }, 'team distribution failed')
    return null
  }
}
