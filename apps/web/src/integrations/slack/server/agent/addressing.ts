export function stripSlackMention(text: string, botUserId: string): string {
  return text
    .replace(new RegExp(`<@${botUserId}>`, 'gi'), '')
    .replace(/<@[A-Z0-9]+>/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Channel/mpim `message` events that also mention the bot duplicate `app_mention`. DMs do not. */
export function isDuplicateSlackMentionEvent(
  event: { type?: string; channel_type?: string; text?: string } | null,
  botUserId: string | undefined
): boolean {
  if (!event || event.type !== 'message' || event.channel_type === 'im' || !botUserId) return false
  return typeof event.text === 'string' && event.text.includes(`<@${botUserId}>`)
}

/** Subscribed non-message events the worker acts on (revocation, feedback, App Home, Stop). */
const LIFECYCLE_EVENTS = new Set([
  'app_mention',
  'app_uninstalled',
  'tokens_revoked',
  'reaction_added',
  'app_home_opened',
  'agent_session_stopped',
])

export function shouldEnqueueSlackEvent(
  event: {
    type?: string
    bot_id?: string
    bot_profile?: unknown
    subtype?: string
    user?: string
    channel_type?: string
    thread_ts?: string
  } | null
): boolean {
  if (!event || event.bot_id || event.subtype || event.bot_profile) return false
  if (typeof event.type === 'string' && LIFECYCLE_EVENTS.has(event.type)) return true
  if (event.type !== 'message') return false
  if (event.channel_type === 'im') return true
  return typeof event.thread_ts === 'string' && event.thread_ts.length > 0
}
