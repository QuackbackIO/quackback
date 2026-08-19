/**
 * Standing in for identity a provider does not release.
 *
 * Some providers hand back a subject and nothing else. Steam's OpenID response
 * carries a SteamID with no email and no name; gaming and community IdPs
 * routinely do the same. Every comparable product answers this by requiring an
 * email and therefore declining to support such a provider, which is a policy
 * we cannot adopt when the provider is the customer's own community login.
 *
 * So an account gets a placeholder address and, if needed, a synthesised name.
 * Two rules govern both:
 *
 *   The address is MINTED ONCE and stored, never re-derived. Derivation cannot
 *   be both stable and unguessable — subjects are public and this file is open
 *   source, so a deterministic address can be registered by someone else first,
 *   after which the real person is permanently unlinkable and neither party can
 *   clear it.
 *
 *   It lives in the reserved anonymous domain, so the ~110 call sites already
 *   routing through realEmail() treat it as undeliverable, and the transport
 *   refuses to send there even if one slips past them.
 */

import { randomBytes } from 'crypto'
import { ANON_EMAIL_DOMAIN } from '@/lib/shared/anonymous-email'

/**
 * The anonymous plugin owns `temp-` in this domain. A separate prefix keeps the
 * two populations distinguishable: one is a visitor who never signed in, the
 * other is an authenticated person whose provider withheld an address.
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
  // Kept only so an operator reading the users table can tell which provider an
  // account came from. It is not an identity key and nothing looks it up.
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
 * Turn a subject into something printable. Subjects are opaque and often
 * structured (`ACCOUNT:REGION:2119123456`), and some providers put an email
 * address there — which must not become a display name, because display names
 * are published on posts and comments.
 */
function readableFromSubject(subject: string): string {
  const withoutAddress = subject.includes('@') ? subject.split('@')[0] : subject
  // Hyphens survive: they are legitimate in handles and names, and turning
  // `some-handle` into `some handle` is a worse result than the structure it
  // removes. Everything else separating the parts becomes a space.
  const cleaned = withoutAddress
    .replace(/[^\p{L}\p{N}-]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[-\s]+|[-\s]+$/g, '')
    .slice(0, 60)
  // Never empty: a name is required to create the account, and returning ''
  // would move the failure to a database constraint at the worst moment.
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
