import { planRank } from './plan-action'

/**
 * Whether a stored pending downgrade still has a switch to wait for. One to a
 * plan the workspace already sits on or below is stale, except after an ended
 * trial: that workspace already resolves to Free limits but has not switched
 * until the choice closes the trial, so its pending Free downgrade still holds.
 */
export function pendingDowngradeIsLive(input: {
  currentPlan: string
  pendingPlan: string
  trialUndecided: boolean
}): boolean {
  if (input.trialUndecided) return true
  return planRank(input.currentPlan) > planRank(input.pendingPlan)
}
