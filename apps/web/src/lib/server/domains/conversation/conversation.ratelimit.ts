/**
 * Per-principal rate limiting for visitor chat actions. Backed by the shared
 * Redis fixed-window primitive, which fails open on Redis errors so an outage
 * never blocks legitimate chatting. Agent (team) actions are not throttled here.
 */
import type { PrincipalId } from '@quackback/ids'
import { incrementBucket, bucketRetryAfter } from '@/lib/server/utils/redis-rate-bucket'

// Generous enough for fast back-and-forth typing, tight enough to stop a script
// from flooding writes, conversation creation, and offline-notification fanout.
const SEND_WINDOW_SECONDS = 30
const SEND_MAX = 20

/** Thrown when a visitor exceeds the chat send rate. Carries a retry hint. */
export class ChatRateLimitError extends Error {
  readonly code = 'RATE_LIMITED'
  readonly retryAfter: number
  constructor(retryAfter: number) {
    super('You are sending messages too quickly. Please wait a moment.')
    this.name = 'ChatRateLimitError'
    this.retryAfter = retryAfter
  }
}

/**
 * Throttle a visitor's message sends (which also gate conversation creation and
 * offline notifications). Throws ChatRateLimitError when the window is exceeded.
 */
export async function assertChatSendRate(principalId: PrincipalId): Promise<void> {
  const spec = { key: `chat:send:${principalId}`, windowSeconds: SEND_WINDOW_SECONDS }
  const { count } = await incrementBucket(spec)
  // count === null means Redis errored — fail open.
  if (count !== null && count > SEND_MAX) {
    throw new ChatRateLimitError(await bucketRetryAfter(spec))
  }
}
