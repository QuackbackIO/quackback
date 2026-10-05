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

/** The provider fields the observation reads. */
export interface ObservedProviderRow {
  id: string
  registrationId: string
  lastSuccessfulTestAt: string | null
  detailsChangedAt: string | null
}

/** Sink for the observation; the auth builder passes the pino logger. */
export interface TrustObservationLogger {
  info: (ctx: Record<string, unknown>, msg: string) => void
}

/**
 * The last test state this process reported for each provider row. The auth
 * instance is rebuilt on every auth_config_version change, so without this the
 * same line repeats on each rebuild. One entry per row id (unique across
 * workspaces), holding that row's two timestamps: a provider is reported again
 * only when its state differs from the one stored, and its entry is dropped
 * once it is trusted, so the map never holds more than the untested providers.
 */
const reportedObservations = new Map<string, string>()

/** Test seam: forget what has been reported. */
export function resetTrustObservations(): void {
  reportedObservations.clear()
}

/**
 * The OIDC registration ids trusted for auto-linking.
 *
 * Every registered OIDC provider is trusted, whatever its connection-test
 * state. Withholding trust from untested providers would refuse first-time SSO
 * sign-ins by existing password and magic-link users ("account not linked") on
 * providers that have always linked them, and most existing providers have
 * never recorded a test.
 *
 * Observed, not enforced: providers the derived predicate would not trust are
 * reported at info level, once per provider state, so the real population is
 * known before any enforcement. The line names the action that earns the trust
 * (a passing connection test) and states that nothing is withheld.
 */
export function oidcTrustedProviderIds(
  registrationIds: readonly string[],
  rows: readonly ObservedProviderRow[],
  log: TrustObservationLogger
): string[] {
  for (const registrationId of registrationIds) {
    const row = rows.find((p) => p.registrationId === registrationId)
    if (!row) continue
    const trusted = allowsAutoLinking({
      lastSuccessfulTestAt: row.lastSuccessfulTestAt,
      detailsChangedAt: row.detailsChangedAt,
      // Not yet persisted; assumed true so the observation isolates the
      // connection-test signal rather than flagging every provider.
      assertsVerifiedEmail: true,
      trustOverride: null,
    })
    if (trusted) {
      reportedObservations.delete(row.id)
      continue
    }
    const state = `${row.lastSuccessfulTestAt ?? ''}|${row.detailsChangedAt ?? ''}`
    if (reportedObservations.get(row.id) === state) continue
    reportedObservations.set(row.id, state)
    log.info(
      {
        registrationId,
        identityProviderId: row.id,
        testState: row.lastSuccessfulTestAt ? 'stale' : 'untested',
      },
      'identity provider has no connection test newer than its last change; sign-in and email auto-linking are unaffected. Run the connection test on the provider (Settings > Security > Single sign-on) to record one'
    )
  }
  return [...registrationIds]
}
