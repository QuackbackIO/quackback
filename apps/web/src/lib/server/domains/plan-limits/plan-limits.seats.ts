/**
 * The paused-seat check as the auth gates ask it.
 *
 * A paused seat is a human team member past the plan's seat cap after the
 * grace who is not a seat holder (see `isSeatPaused`). The gates treat them as
 * a portal user: no admin, no team authority, no personal API keys and no MCP
 * as themselves. Their portal access, assignments and history are untouched.
 *
 * Only a dashboard audience carries team authority, so only a dashboard
 * session for a human teammate is ever checked; every other caller costs
 * nothing. The answer is shared with the rest of the request.
 */
import { memoizePerRequest } from '@/lib/server/request-memo'
import { IDENTITY_MEMO_PREFIX } from '@/lib/server/auth/request-session'
import { isTeamMember } from '@/lib/shared/roles'
import { isSeatPaused, seatHolders } from './plan-limits.service'

export interface SeatCandidate {
  id: string
  role: string
  type: string
}

/** Whether `principal` is a human teammate whose seat is paused. Fails open. */
export async function isPausedTeamSeat(principal: SeatCandidate): Promise<boolean> {
  if (principal.type !== 'user' || !isTeamMember(principal.role)) return false
  return memoizePerRequest(`${IDENTITY_MEMO_PREFIX}seat-paused:${principal.id}`, () =>
    isSeatPaused(principal.id)
  )
}

/**
 * The role a teammate acts with: `user` when their seat is paused, else the
 * role given. For the paths that read a principal's role straight from the
 * row rather than through the session gates.
 */
export async function roleUnlessPaused<R extends string>(
  principal: SeatCandidate,
  role: R
): Promise<R | 'user'> {
  return (await isPausedTeamSeat(principal)) ? 'user' : role
}

/**
 * `ids` without the teammates whose seats are paused, for routing and
 * availability: a paused seat is never online for the team. Fails open.
 */
export async function withoutPausedSeats<T extends string>(ids: readonly T[]): Promise<T[]> {
  if (ids.length === 0 || (await seatHolders()) === null) return [...ids]
  const paused = await Promise.all(ids.map((id) => isSeatPaused(id)))
  return ids.filter((_, i) => !paused[i])
}
