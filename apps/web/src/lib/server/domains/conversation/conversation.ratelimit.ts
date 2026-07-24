/**
 * Per-principal rate limiting for visitor conversation actions. Backed by the shared
 * Redis fixed-window primitive, which fails open on Redis errors so an outage
 * never blocks legitimate messaging. Agent (team) actions are not throttled here.
 */
import type { PrincipalId } from '@quackback/ids'
import { incrementBucket, bucketRetryAfter } from '@/lib/server/utils/redis-rate-bucket'

// Generous enough for fast back-and-forth typing, tight enough to stop a script
// from flooding writes, conversation creation, and offline-notification fanout.
const SEND_WINDOW_SECONDS = 30
const SEND_MAX = 20

/** Thrown when a visitor exceeds the conversation send rate. Carries a retry hint. */
export class ConversationRateLimitError extends Error {
  readonly code = 'RATE_LIMITED'
  readonly retryAfter: number
  constructor(retryAfter: number) {
    super('You are sending messages too quickly. Please wait a moment.')
    this.name = 'ConversationRateLimitError'
    this.retryAfter = retryAfter
  }
}

/**
 * Throttle a visitor's message sends (which also gate conversation creation and
 * offline notifications). Throws ConversationRateLimitError when the window is exceeded.
 */
export async function assertConversationSendRate(principalId: PrincipalId): Promise<void> {
  const spec = { key: `conversation:send:${principalId}`, windowSeconds: SEND_WINDOW_SECONDS }
  const { count } = await incrementBucket(spec)
  // count === null means Redis errored — fail open.
  if (count !== null && count > SEND_MAX) {
    throw new ConversationRateLimitError(await bucketRetryAfter(spec))
  }
}

// Cold inbound is the one ingress with no principal to key on yet — the sender
// is a stranger and the throttle's whole job is to bound how many strangers can
// mint themselves. So it gets its own, far tighter budget: the send limit above
// is a TYPING throttle (20 per 30s is generous for a person mid-conversation),
// which as a ceiling on creating new people and new conversations is no limit
// at all. Ten new threads an hour from one address is already well past what a
// real customer does.
const COLD_WINDOW_SECONDS = 3600
const COLD_MAX = 10

/**
 * Throttle cold inbound email by SENDER ADDRESS — the gate on the only path
 * that creates a principal and a conversation for an unauthenticated stranger.
 * Without it, mailing the support address is an unbounded way to mint rows that
 * nothing reclaims (the anonymous sweep deliberately skips anything owning a
 * conversation, and every cold lead owns one).
 *
 * `senderEmail` must be the normalized bare address, not a raw From header:
 * keying on the header would make the limit evadable by varying the display
 * name. Throws the same ConversationRateLimitError the reply path throws, so
 * the caller's existing catch handles it unchanged.
 */
export async function assertColdInboundRate(senderEmail: string): Promise<void> {
  const spec = { key: `conversation:cold:${senderEmail}`, windowSeconds: COLD_WINDOW_SECONDS }
  const { count } = await incrementBucket(spec)
  if (count !== null && count > COLD_MAX) {
    throw new ConversationRateLimitError(await bucketRetryAfter(spec))
  }
}
