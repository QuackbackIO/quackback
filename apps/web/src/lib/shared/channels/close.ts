/**
 * Close/Reopen copy and policy derived from the channel descriptor.
 * GitHub's issue is the thread: Close means close the issue, and a comment
 * does not reopen it. Messenger and email keep their existing verbs.
 */
import type { Channel } from './types'
import { getChannelDescriptor } from './registry'

export function channelCloseActionLabel(
  channel: Channel | null | undefined,
  closed: boolean
): string {
  if (getChannelDescriptor(channel ?? '')?.nativeObject === 'issue') {
    return closed ? 'Reopen issue' : 'Close issue'
  }
  return closed ? 'Reopen' : 'Close'
}

export function channelCloseToast(channel: Channel | null | undefined, closed: boolean): string {
  if (getChannelDescriptor(channel ?? '')?.nativeObject === 'issue') {
    return closed ? 'Issue closed' : 'Issue reopened'
  }
  return closed ? 'Conversation closed' : 'Conversation reopened'
}

export function channelCloseFailureToast(
  channel: Channel | null | undefined,
  closed: boolean
): string {
  if (getChannelDescriptor(channel ?? '')?.nativeObject === 'issue') {
    return closed ? 'Failed to close issue' : 'Failed to reopen issue'
  }
  return closed ? 'Failed to close conversation' : 'Failed to reopen conversation'
}

export function channelShowsEndConversation(channel: Channel | null | undefined): boolean {
  return getChannelDescriptor(channel ?? '')?.closeSurface !== 'native'
}

export function isNativeIssueChannel(channel: Channel | null | undefined): boolean {
  return getChannelDescriptor(channel ?? '')?.nativeObject === 'issue'
}

export function channelCloseSystemCopy(channel: Channel | null | undefined): {
  ended: string
  reopened: string
} {
  if (getChannelDescriptor(channel ?? '')?.nativeObject === 'issue') {
    return { ended: 'Issue closed', reopened: 'Issue reopened' }
  }
  return { ended: 'Conversation ended', reopened: 'Conversation reopened' }
}

export function channelReplyPlaceholder(
  channel: Channel | null | undefined,
  opts: { closed: boolean; isTicket: boolean }
): string {
  if (opts.isTicket) return 'Reply to the requester…'
  if (opts.closed && getChannelDescriptor(channel ?? '')?.nativeObject === 'issue') {
    return 'Comment on the closed issue…'
  }
  return 'Type your reply…'
}
