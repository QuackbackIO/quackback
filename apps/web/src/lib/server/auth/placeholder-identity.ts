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

export { synthesizeName } from '@/lib/shared/sso-profile-outcome'

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
