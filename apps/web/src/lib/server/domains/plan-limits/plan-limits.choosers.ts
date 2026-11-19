/**
 * The Plan limits choosers: the admin's choice of the board that stays open,
 * who keeps a seat, the status components that stay public and the sending
 * domains that keep sending. Each validates against the current candidates
 * and stores the choice in the plan limits state.
 */
import type { StoredPlanLimitsState } from '@/lib/shared/db-types'
import { updatePlanLimitsState } from '@/lib/server/domains/settings/settings.plan-limits'
import { invalidatePlanLimits } from './plan-limits.cache'
import {
  guaranteedSeatHolders,
  parsePlanLimitsState,
  type PlanLimitIssueKey,
  type PlanLimitsState,
} from './plan-limits.rules'
import { evaluate, type PlanLimitsSnapshot } from './plan-limits.service'

type SnapshotPart = keyof PlanLimitsSnapshot

export type PlanLimitsChoiceResult =
  { ok: true } | { ok: false; reason: 'not_over' | 'unknown' | 'too_many' }

type ChoiceField =
  'keptBoardId' | 'seatHolderIds' | 'visibleStatusComponentIds' | 'sendingDomainIds'

async function choose(
  key: PlanLimitIssueKey,
  part: SnapshotPart,
  ids: readonly string[],
  write: (state: PlanLimitsState) => PlanLimitsState
): Promise<PlanLimitsChoiceResult> {
  await invalidatePlanLimits()
  const { view, snapshot } = await evaluate({ now: new Date(), persist: true })
  const issue = view.issues.find((i) => i.key === key)
  if (!view.enabled || !issue) return { ok: false, reason: 'not_over' }
  const known = new Set((snapshot[part] as { id: string }[] | undefined)?.map((c) => c.id) ?? [])
  if (ids.some((id) => !known.has(id))) return { ok: false, reason: 'unknown' }
  // The owner and a billing manager always hold a seat and count toward it.
  const always = part === 'members' ? guaranteedSeatHolders(snapshot.members ?? []) : []
  if (new Set([...always, ...ids]).size > Math.max(issue.cap, always.length)) {
    return { ok: false, reason: 'too_many' }
  }
  const wrote = await updatePlanLimitsState((current) => {
    const state = parsePlanLimitsState(current)
    if (!state) return undefined
    return write(state) as unknown as StoredPlanLimitsState
  })
  if (!wrote) return { ok: false, reason: 'not_over' }
  await invalidatePlanLimits()
  return { ok: true }
}

function withChoice<K extends ChoiceField>(
  field: K,
  value: PlanLimitsState[K]
): (state: PlanLimitsState) => PlanLimitsState {
  return (state) => ({ ...state, [field]: value })
}

/** Keep `boardId` open after grace. */
export function setKeptBoard(boardId: string): Promise<PlanLimitsChoiceResult> {
  return choose('maxBoards', 'boards', [boardId], withChoice('keptBoardId', boardId))
}

/**
 * Who keeps a seat after grace. The owner and one billing manager always keep
 * theirs and count toward the cap (see `guaranteedSeatHolders`), so the choice
 * plus them must fit it.
 */
export function setSeatHolders(principalIds: readonly string[]): Promise<PlanLimitsChoiceResult> {
  const ids = [...new Set(principalIds)]
  return choose('maxTeamSeats', 'members', ids, withChoice('seatHolderIds', ids))
}

/** Status components that stay on the public page after grace, up to the cap. */
export function setVisibleStatusComponents(
  componentIds: readonly string[]
): Promise<PlanLimitsChoiceResult> {
  const ids = [...new Set(componentIds)]
  return choose(
    'maxStatusComponents',
    'statusComponents',
    ids,
    withChoice('visibleStatusComponentIds', ids)
  )
}

/** Sending domains that keep sending after grace, up to the cap. */
export function setKeptSendingDomains(
  domainIds: readonly string[]
): Promise<PlanLimitsChoiceResult> {
  const ids = [...new Set(domainIds)]
  return choose('maxSendingDomains', 'sendingDomains', ids, withChoice('sendingDomainIds', ids))
}
