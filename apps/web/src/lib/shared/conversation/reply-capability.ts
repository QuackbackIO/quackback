import type { PreChatEmailMode } from './types'

/**
 * Whether the team can actually email a reply to this visitor — drives the
 * widget's offline copy so it never promises "we'll get back to you by email"
 * when it structurally can't. True only when email transport is configured AND
 * we'll have an address: capture is on (optional/required), or one is already
 * on file for this visitor.
 */
export function canEmailVisitor(args: {
  emailConfigured: boolean
  preChatEmail: PreChatEmailMode
  visitorHasEmail: boolean
}): boolean {
  if (!args.emailConfigured) return false
  return args.preChatEmail !== 'off' || args.visitorHasEmail
}
