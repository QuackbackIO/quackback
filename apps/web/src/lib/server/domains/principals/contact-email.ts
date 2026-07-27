/**
 * Letting someone supply a real address when their provider released none.
 *
 * A sign-in through such a provider mints a placeholder into the reserved
 * anonymous domain, which is undeliverable by design. The account works, but
 * nothing can reach the person: no reply notification, no changelog, nothing.
 * This is how they fix that, and it is the first writer of
 * `principal.contactEmail` driven by the person rather than by an agent
 * capturing an address in the messenger.
 *
 * Verified before it counts, because `contactEmail` is a delivery target —
 * `resolveReplyRecipient` places it second, above the per-conversation capture.
 * An unverified value there would be a way to point somebody else's replies at
 * an address they do not own.
 *
 * The challenge lives in the shared `verification` table under its own
 * namespace, so it can never satisfy a magic-link or OTP lookup.
 */

import { randomBytes } from 'crypto'
import { isSyntheticAnonEmail } from '@/lib/shared/anonymous-email'

/** Long enough to survive a mail round trip, short enough to limit exposure. */
export const CONTACT_EMAIL_TTL_MS = 60 * 60 * 1000

const IDENTIFIER_PREFIX = 'contact-email:'

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
  // Accepting a placeholder would let someone set an undeliverable address as
  // their contact address, which is the state this feature exists to escape.
  if (isSyntheticAnonEmail(normalised)) return null
  return normalised
}

export interface ContactEmailChallenge {
  /** Row key in the shared verification table. */
  identifier: string
  /** Row payload: who asked, and for which address. */
  value: string
  expiresAt: Date
  /** Sent in the link. Never stored anywhere else. */
  token: string
}

/**
 * Mint a challenge for `principalId` to prove control of `email`.
 *
 * The token is random rather than derived: it is the only thing standing
 * between a guess and a write to a delivery target.
 */
export function buildContactEmailChallenge(
  principalId: string,
  email: string
): ContactEmailChallenge {
  const token = randomBytes(32).toString('base64url')
  return {
    token,
    identifier: `${IDENTIFIER_PREFIX}${token}`,
    value: JSON.stringify({ principalId, email }),
    expiresAt: new Date(Date.now() + CONTACT_EMAIL_TTL_MS),
  }
}

/** The identifier a confirmation token maps to. */
export function contactEmailIdentifier(token: string): string {
  return `${IDENTIFIER_PREFIX}${token}`
}

/**
 * Read back a stored challenge, or null for anything we did not write.
 *
 * The address is re-validated rather than trusted: it was checked when issued,
 * but this row outlives that check and its contents are what actually get
 * written to the principal.
 */
export function readContactEmailChallenge(
  value: string
): { principalId: string; email: string } | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null
  const { principalId, email } = parsed as Record<string, unknown>
  if (typeof principalId !== 'string' || principalId.length === 0) return null
  if (typeof email !== 'string') return null
  const acceptable = acceptableContactEmail(email)
  if (!acceptable) return null
  return { principalId, email: acceptable }
}
