/**
 * Standing in for identity a provider does not release.
 *
 * An account gets a placeholder address and, if needed, a synthesised name.
 * The address is MINTED ONCE and stored, never re-derived — subjects are
 * public, so a deterministic address can be registered by someone else first.
 * It lives in the reserved anonymous domain so existing guards treat it as
 * undeliverable.
 */

import { randomBytes } from 'crypto'
import { ANON_EMAIL_DOMAIN } from '@/lib/shared/anonymous-email'

/**
 * The anonymous plugin owns `temp-` in this domain. A separate prefix keeps
 * the two populations distinguishable.
 */
const SSO_PLACEHOLDER_PREFIX = 'sso-'

/** Local-part safe: lowercase alphanumerics and single hyphens. */
function sanitiseForLocalPart(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
}

/**
 * A placeholder address for `registrationId`. Call once, at account creation,
 * and store the result — calling again yields a different address, by design.
 */
export function mintPlaceholderEmail(registrationId: string): string {
  const provider = sanitiseForLocalPart(registrationId) || 'idp'
  const unique = randomBytes(12).toString('hex')
  return `${SSO_PLACEHOLDER_PREFIX}${provider}-${unique}@${ANON_EMAIL_DOMAIN}`
}

function usableClaim(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

/**
 * Turn a subject into something printable. Structured subjects
 * (`ACCOUNT:REGION:2119123456`) and addresses-as-subjects must not become
 * display names as-is, because display names are published on posts.
 */
function readableFromSubject(subject: string): string {
  const withoutAddress = subject.includes('@') ? subject.split('@')[0] : subject
  const cleaned = withoutAddress
    .replace(/[^\p{L}\p{N}-]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[-\s]+|[-\s]+$/g, '')
    .slice(0, 60)
  return cleaned || 'Member'
}

/**
 * A display name from the claims, falling back to the subject. Ordered by how
 * deliberately the person chose it: a handle they set, then a nickname, then
 * whatever can be read out of the identifier.
 */
export function synthesizeName(claims: Record<string, unknown>, subject: string): string {
  return (
    usableClaim(claims.preferred_username) ??
    usableClaim(claims.nickname) ??
    readableFromSubject(usableClaim(subject) ?? '')
  )
}
