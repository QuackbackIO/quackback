/**
 * What counts as an address this system is willing to send to.
 *
 * Someone signed in through a provider that released no email holds a
 * placeholder in the reserved anonymous domain, which is undeliverable by
 * design. They fix that through `functions/contact-email.ts`, which writes
 * `user.email` after a code proves control of the address.
 *
 * This module used to own a link-based challenge for writing
 * `principal.contactEmail` instead. That is gone: an address someone proves is
 * their identity, so it belongs on the account, not beside it. What remains is
 * `principal.contactEmail`'s honest meaning — an address for someone with no
 * account, written by an agent in the inbox or a visitor in a pre-chat form,
 * with NO proof of control behind either. `lib/server/email/recipient.ts` is
 * built on that fact: capability-bearing mail must never follow it.
 */

import { isSyntheticAnonEmail } from '@/lib/shared/anonymous-email'

/** Deliberately conservative; the address has to survive a real mail send. */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/

/** RFC 5321 caps the whole address at 254 characters. */
const MAX_EMAIL_LENGTH = 254

/**
 * The address in the form it should be stored, or null if it is not one we are
 * willing to send to.
 */
export function acceptableContactEmail(input: string | null | undefined): string | null {
  if (!input) return null
  const normalised = input.trim().toLowerCase()
  if (normalised.length === 0 || normalised.length > MAX_EMAIL_LENGTH) return null
  if (!EMAIL_PATTERN.test(normalised)) return null
  // Accepting a placeholder would let someone re-enter the undeliverable state
  // this exists to escape, and would put a synthetic-looking address on
  // `user.email` where the rest of the system reads it as "no address".
  if (isSyntheticAnonEmail(normalised)) return null
  return normalised
}
