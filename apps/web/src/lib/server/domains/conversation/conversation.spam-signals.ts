/**
 * Deterministic (non-AI) inbound spam signals. These run BEFORE the AI
 * classifier on every new-conversation ingest path: a matching signal files
 * the conversation to Spam on its own, so an obvious case never spends a
 * completion. The classifier remains the fallback for everything the signals
 * don't catch.
 *
 * Three signals, cheapest first:
 *   - auto_responder      → RFC 3834 / bulk-precedence headers on a cold
 *                           inbound email (no thread context — replies and
 *                           loops are still hard-dropped upstream).
 *   - sender_auth_failure → the receiving MTA reported DMARC fail, short of
 *                           the p=reject policy that drops the mail outright.
 *   - burst_rate          → one sender opening threads faster than a person
 *                           types (a tighter window than the hard cold-inbound
 *                           cap, which drops rather than files).
 *
 * Every signal fails open: a store error, a missing header, or any thrown
 * error resolves to "no signal", leaving the thread in triage — the same
 * failure contract as the AI filter, whose trust-list bypass the caller also
 * applies before any of these run.
 */
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'spam-signals' })

export const SPAM_SIGNALS = ['auto_responder', 'sender_auth_failure', 'burst_rate'] as const
export type SpamSignal = (typeof SPAM_SIGNALS)[number]

export interface SpamSignalHints {
  /** The mail carried auto-generated/bulk headers (cold email path only). */
  autoResponder?: boolean
  /** The Authentication-Results verdict was DMARC fail (cold email path only). */
  senderAuthFailed?: boolean
}

export interface DetectSpamSignalInput extends SpamSignalHints {
  /** Canonical sender address, or null when the channel has none — a null
   *  sender skips the burst signal (there is no key to count on). */
  senderEmail: string | null
}

/**
 * Evaluate the deterministic spam signals for a new conversation's first
 * inbound message. Returns the first matching signal, or null when nothing
 * matches. Never throws.
 */
export async function detectSpamSignal(input: DetectSpamSignalInput): Promise<SpamSignal | null> {
  if (input.autoResponder) return 'auto_responder'
  if (input.senderAuthFailed) return 'sender_auth_failure'
  if (input.senderEmail) {
    try {
      const { isColdInboundBurst } = await import('./conversation.ratelimit')
      if (await isColdInboundBurst(input.senderEmail)) return 'burst_rate'
    } catch (err) {
      log.warn({ err }, 'spam signals: burst check failed, failing open')
    }
  }
  return null
}
