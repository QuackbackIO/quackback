/**
 * Whether a provider may AUTO-LINK: attach an incoming identity to an existing
 * local account purely because the email addresses match.
 *
 * Every OIDC provider was previously trusted for this unconditionally. That is
 * defensible for a corporate IdP, where the workspace controls who can hold an
 * identity, and much weaker for a public consumer one, where anyone in the
 * world can register — including the address of somebody who already has a
 * local account here.
 *
 * Derived rather than exposed as a switch. A per-provider toggle is a setting
 * no admin has the context to answer, and defaulting it off would break the
 * common case: a corporate IdP's existing password users would stop linking on
 * first SSO sign-in and start seeing "account not linked", which is a
 * regression from today. Deriving it keeps that behaviour for providers that
 * have earned it and denies it to the ones that have not, with no new control
 * to reason about.
 *
 * Note this governs AUTO-linking only. Deliberate linking, where someone
 * already signed in asks to attach a provider, is authorised by the session
 * rather than by the address and is unaffected.
 */

export interface ProviderTrustInputs {
  /** ISO-8601, or null when the provider has never passed its test. */
  lastSuccessfulTestAt: string | null
  /** ISO-8601 of the last connection-affecting change, or null. */
  detailsChangedAt: string | null
  /** Whether the last resolution took the address from a source that also
   *  asserted it verified. */
  assertsVerifiedEmail: boolean
  /** Explicit admin decision, in either direction. Null to derive. */
  trustOverride: boolean | null
}

function hasFreshPass(input: ProviderTrustInputs): boolean {
  if (!input.lastSuccessfulTestAt) return false
  const testedMs = new Date(input.lastSuccessfulTestAt).getTime()
  if (Number.isNaN(testedMs)) return false
  if (!input.detailsChangedAt) return true
  const changedMs = new Date(input.detailsChangedAt).getTime()
  if (Number.isNaN(changedMs)) return true
  // A test at exactly the change time proves nothing about the new config.
  return testedMs > changedMs
}

export function allowsAutoLinking(input: ProviderTrustInputs): boolean {
  if (input.trustOverride !== null) return input.trustOverride
  return hasFreshPass(input) && input.assertsVerifiedEmail
}
