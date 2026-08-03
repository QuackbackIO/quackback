/**
 * Feature-level support surface authorization.
 *
 * Covers whether a visitor may use a Conversations surface at all (widget chat
 * or portal Support). Conversation ownership remains in chat.ts.
 */
import type { SupportAccessConfig } from '@/lib/server/domains/settings/settings.types'
import { allowDecision, denyDecision, isTeamActor, type Actor, type Decision } from './types'

function denyMessage(mode: SupportAccessConfig['mode']): string {
  switch (mode) {
    case 'anonymous':
      return 'Support is not available'
    case 'authenticated':
      return 'Sign in to contact support'
    case 'selected':
      return 'Support is restricted'
    case 'team':
      return 'Support is internal'
  }
}

export function canAccessSupportSurface(actor: Actor, access: SupportAccessConfig): Decision {
  if (isTeamActor(actor)) return allowDecision()
  if (actor.principalType === 'service')
    return denyDecision('Service principals cannot use support')

  switch (access.mode) {
    case 'anonymous':
      return allowDecision()
    case 'authenticated':
      return actor.principalType === 'user'
        ? allowDecision()
        : denyDecision(denyMessage(access.mode))
    case 'selected': {
      const principalAllowed =
        !!actor.principalId && access.principalIds.some((id) => id === actor.principalId)
      const segmentAllowed =
        actor.principalType === 'user' && access.segmentIds.some((id) => actor.segmentIds.has(id))
      return principalAllowed || segmentAllowed
        ? allowDecision()
        : denyDecision(denyMessage(access.mode))
    }
    case 'team':
      return denyDecision(denyMessage(access.mode))
  }
}
