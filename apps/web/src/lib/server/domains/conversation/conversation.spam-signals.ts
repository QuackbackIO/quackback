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
 *   - the sender_auth_*   → what the receiving MTA's Authentication-Results
 *     family                said about the sender, mapped by
 *                           `senderAuthSpamSignal` below.
 *   - burst_rate          → one sender opening threads faster than a person
 *                           types (a tighter window than the hard cold-inbound
 *                           cap, which drops rather than files).
 *
 * Every signal fails open: a store error, a missing header, or any thrown
 * error resolves to "no signal", leaving the thread in triage — the same
 * failure contract as the AI filter, whose trust-list bypass the caller also
 * applies before any of these run.
 *
 * The one exception to that bypass is `sender_auth_reject`, and it is
 * deliberate: see `senderAuthSpamSignal`.
 */
import { logger } from '@/lib/server/logger'
import type { InboundAuthResult } from './email-auth'

const log = logger.child({ component: 'spam-signals' })

export const SPAM_SIGNALS = [
  'auto_responder',
  'sender_auth_failure',
  'sender_auth_reject',
  'sender_auth_arc_rescued',
  'burst_rate',
] as const
export type SpamSignal = (typeof SPAM_SIGNALS)[number]

export interface SpamSignalHints {
  /** The mail carried auto-generated/bulk headers (cold email path only). */
  autoResponder?: boolean
  /** What the Authentication-Results header said, already mapped through
   *  `senderAuthSpamSignal` (cold email path only); null when it said nothing
   *  worth filing on. */
  senderAuthSignal?: SpamSignal | null
}

/**
 * Map an inbound authentication verdict onto the signal it files under, or
 * null when the verdict is not a filing reason at all.
 *
 * Three outcomes rather than one boolean, because "DMARC failed" alone does
 * not tell an agent what to do. A message that failed under `p=none` is weak
 * evidence; one that failed under `p=reject` is the author domain telling us
 * to refuse it; one that failed under `p=reject` but arrived on a validated
 * ARC chain is the forwarding-gateway shape, where a real customer's mail
 * loses SPF/DKIM alignment through no fault of their own. The first two look
 * identical through `dmarc === 'fail'`, which is why that boolean was not
 * enough to carry the decision.
 *
 * `arcRescued` is read rather than re-derived from (dmarc, policy, arc):
 * email-auth.ts computes it precisely so the condition is not re-spelled at
 * each call site, where it would drift.
 */
export function senderAuthSpamSignal(verdict: InboundAuthResult): SpamSignal | null {
  if (verdict.verdict === 'reject') return 'sender_auth_reject'
  if (verdict.arcRescued) return 'sender_auth_arc_rescued'
  return verdict.dmarc === 'fail' ? 'sender_auth_failure' : null
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
  if (input.senderAuthSignal) return input.senderAuthSignal
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
