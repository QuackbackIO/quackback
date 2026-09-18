/** Compatibility entrypoint; runtime scheduling and execution share conversation.inactivity. */
import type { ConversationId, PrincipalId } from '@quackback/ids'
import { getChannelDescriptor } from '@/lib/shared/channels'
import {
  inactivityPolicy,
  type ConversationInactivitySettings,
} from '@/lib/shared/conversation-inactivity'

export type IdleChannelGroup = 'messenger' | 'email'

export interface IdleCandidate {
  id: ConversationId
  channel: string
  lastMessageAt: Date
  inactivityCheckInAt: Date | null
  visitorPrincipalId: PrincipalId
}

export function idleChannelGroup(channel: string): IdleChannelGroup | null {
  const descriptor = getChannelDescriptor(channel)
  if (!descriptor || descriptor.closeSurface === 'native') return null
  if (descriptor.surface === 'ours') return 'messenger'
  if (descriptor.surface === 'theirs' && descriptor.addressing === 'email') return 'email'
  return null
}

export function idleActionFor(
  candidate: Pick<IdleCandidate, 'channel' | 'lastMessageAt' | 'inactivityCheckInAt'>,
  settings: ConversationInactivitySettings,
  now: Date,
  visitorOnline: boolean
): 'check_in' | 'close' | null {
  const group = idleChannelGroup(candidate.channel)
  if (!group) return null

  const p = inactivityPolicy(settings, 'team', group)
  if (p.mode !== 'built_in') return null
  const elapsed = now.getTime() - candidate.lastMessageAt.getTime()
  if (p.closeEnabled && elapsed >= p.closeMs) return 'close'
  if (
    p.followUpEnabled &&
    !candidate.inactivityCheckInAt &&
    elapsed >= p.followUpMs &&
    (group === 'email' || visitorOnline)
  )
    return 'check_in'
  return null
}

export async function sweepIdleTeamConversations(
  now = new Date()
): Promise<{ checkedIn: number; closed: number }> {
  const { sweepInactivity } = await import('./conversation.inactivity')
  const result = await sweepInactivity({ now, owner: 'team' })
  return { checkedIn: result.followedUp, closed: result.closed }
}
