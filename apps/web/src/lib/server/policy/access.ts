/**
 * Per-action access tier predicate.
 *
 * Single source of truth for "does this actor satisfy this tier on this
 * board?" — used by canViewBoard / canCreatePost / canCreateComment so
 * the tier interpretation lives in one place.
 *
 * Tier ordering (least → most restrictive):
 *   anonymous (0) ⊂ authenticated (1) ⊂ segments (2) ⊂ team (3)
 *
 * Team actors (admin/member) bypass every tier. The segments tier requires
 * the actor to be a portal user (not anonymous, not service) AND to have
 * at least one matching segment id. An empty board segment list fails
 * closed for non-team actors.
 */
import type { AccessTier } from '@/lib/server/db'
import { isTeamActor, type Actor } from './types'

export function tierAllows(actor: Actor, tier: AccessTier, segmentIds: readonly string[]): boolean {
  if (isTeamActor(actor)) return true
  switch (tier) {
    case 'anonymous':
      return true
    case 'authenticated':
      return actor.principalType === 'user'
    case 'segments':
      return (
        actor.principalType === 'user' && segmentIds.some((id) => actor.segmentIds.has(id as never))
      )
    case 'team':
      return false // team handled by the isTeamActor early-return
  }
}
