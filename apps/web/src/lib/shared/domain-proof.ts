/**
 * Where a workspace's proof that it controls a domain came from, in words a
 * settings page can show. The proofs themselves are read on the server (see
 * `domains/domain-proof/proven-zones.ts`).
 */

/**
 * - `email-sending`: a verified sending domain, proven by its own ownership
 *   record or its own signing key.
 * - `sso`: a verified single sign-on domain, proven by its TXT record.
 * - `web-address`: an operator-managed hostname that is ready. It proves that
 *   exact hostname and nothing under or above it.
 */
export type ProvenZoneSource = 'email-sending' | 'sso' | 'web-address'

const SOURCE_LABEL: Record<ProvenZoneSource, string> = {
  'email-sending': 'email sending',
  sso: 'single sign-on',
  'web-address': 'a web address',
}

/** The source in words: "email sending", "a web address". */
export function proofSourceName(source: ProvenZoneSource): string {
  return SOURCE_LABEL[source]
}

/** "Verified through email sending" and the like. */
export function verifiedThroughLabel(source: ProvenZoneSource): string {
  return `Verified through ${proofSourceName(source)}`
}
